import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { FoodOrder } from '../orders/entities/food-order.entity';
import {
  FoodOrderTransitionsService,
  SYSTEM,
} from '../orders/food-order-transitions.service';
import { FoodNotice, FoodNotifier } from '../orders/food-notifier.service';

const BATCH = 200;
export const AUTO_REJECT_REASON = 'The restaurant didn’t respond in time.';
export const UNPAID_REASON = 'The transfer wasn’t received in time.';

type Work = (m: EntityManager) => Promise<{
  counts: Record<string, number>;
  notices: FoodNotice[];
  changed: string[];
}>;

/**
 * Food's scheduled work. Every job takes a transaction-scoped advisory lock
 * (a second dyno skips), changes orders only through the transitions
 * service with row locks (SKIP LOCKED), so a second run finds nothing left,
 * and notifies after commit. Each is a plain method too — tests call them
 * with a fixed `now`.
 */
@Injectable()
export class FoodJobsService {
  private readonly logger = new Logger(FoodJobsService.name);
  /** Later phases add their own nightly work here. */
  readonly nightly: Array<(now: Date) => Promise<unknown>> = [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: FoodOrderTransitionsService,
    private readonly notifier: FoodNotifier,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('*/30 * * * * *', { name: 'food-order-deadlines' })
  async cronDeadlines() {
    if (!this.enabled) return;
    await this.autoReject();
    await this.cancelUnpaidTransfers();
  }

  /** Placed and unanswered past accept_by → auto_rejected; portions and promotion back; both sides told. */
  async autoReject(now = new Date()) {
    return this.run('food:auto-reject', async (m) => {
      const due = await this.due(m, (qb) =>
        qb
          .where(`o.status = 'placed'`)
          .andWhere('o.accept_by < :now', { now })
          .orderBy('o.acceptBy', 'ASC'),
      );
      const notices: FoodNotice[] = [];
      for (const o of due) {
        await this.transitions.moveStatus(m, o, 'auto_rejected', SYSTEM, {
          note: AUTO_REJECT_REASON,
          patch: { cancelReason: AUTO_REJECT_REASON },
        });
        const name = await this.vendorName(m, o.brandId);
        const data = { orderId: o.id, code: o.code };
        notices.push(
          {
            userId: o.userId,
            payload: {
              type: 'food.order.auto_rejected',
              title: `${name} couldn’t take your order`,
              body: `${o.code} wasn’t accepted in time, so it was cancelled. You haven’t been charged.`,
              data,
            },
          },
          {
            userId: await this.notifier.ownerOf(o.branchId),
            payload: {
              type: 'food.order.auto_rejected',
              title: `${o.code} auto-rejected`,
              body: 'You didn’t accept it in time, so the customer was told it’s cancelled.',
              data,
            },
          },
        );
      }
      return {
        counts: { autoRejected: due.length },
        notices,
        changed: due.map((o) => o.id),
      };
    });
  }

  /** Transfer orders not paid by pay_by → cancelled by the system. */
  async cancelUnpaidTransfers(now = new Date()) {
    return this.run('food:cancel-unpaid-transfers', async (m) => {
      const due = await this.due(m, (qb) =>
        qb
          .where(`o.payment_method = 'transfer'`)
          .andWhere(`o.payment_status = 'awaiting_transfer'`)
          .andWhere(`o.status IN ('placed', 'accepted')`)
          .andWhere('o.pay_by < :now', { now })
          .orderBy('o.payBy', 'ASC'),
      );
      const notices: FoodNotice[] = [];
      for (const o of due) {
        await this.transitions.moveStatus(m, o, 'cancelled', SYSTEM, {
          note: UNPAID_REASON,
          patch: { cancelReason: UNPAID_REASON },
        });
        const data = { orderId: o.id, code: o.code };
        notices.push(
          {
            userId: o.userId,
            payload: {
              type: 'food.order.cancelled',
              title: `${o.code} cancelled`,
              body: 'We didn’t see your transfer in time, so the order was cancelled.',
              data,
            },
          },
          {
            userId: await this.notifier.ownerOf(o.branchId),
            payload: {
              type: 'food.order.cancelled',
              title: `${o.code} cancelled — unpaid`,
              body: 'The transfer deadline passed. Don’t cook this one.',
              data,
            },
          },
        );
      }
      return {
        counts: { cancelled: due.length },
        notices,
        changed: due.map((o) => o.id),
      };
    });
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private due(
    m: EntityManager,
    build: (
      qb: ReturnType<EntityManager['createQueryBuilder']>,
    ) => ReturnType<EntityManager['createQueryBuilder']>,
  ): Promise<FoodOrder[]> {
    return build(
      m
        .createQueryBuilder(FoodOrder, 'o')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked'),
    )
      .limit(BATCH)
      .getMany() as Promise<FoodOrder[]>;
  }

  private async vendorName(m: EntityManager, brandId: string) {
    const [b] = await m.query(`SELECT name FROM food_brands WHERE id = $1`, [
      brandId,
    ]);
    return b?.name ?? 'The restaurant';
  }

  private async run(
    name: string,
    work: Work,
  ): Promise<Record<string, number | boolean>> {
    const result = await this.dataSource.transaction(async (m) => {
      const [{ locked }] = await m.query(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
        [name],
      );
      return locked ? work(m) : null;
    });
    if (!result) {
      this.logger.log(`${name}: another instance is running it; skipped`);
      return { skipped: true };
    }
    await this.notifier.send(result.notices);
    for (const id of result.changed) await this.notifier.changed(id);
    this.logger.log(`${name}: ${JSON.stringify(result.counts)}`);
    return result.counts;
  }
}
