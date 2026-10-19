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
import { FoodAggregatesService } from '../reviews/food-aggregates.service';
import { RiderLocationService } from '../riders/rider-location.service';
import { LOCATION_RETENTION_DAYS } from '../riders/presence';
import { formatTime12 } from '../../../common/time/time.util';
import { PrepStatsService } from '../availability/prep-stats.service';

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
    private readonly aggregates: FoodAggregatesService,
    private readonly locations: RiderLocationService,
    private readonly prepStats: PrepStatsService,
  ) {
    this.nightly.push((now) => this.recomputePrepStats(now));
  }

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('*/30 * * * * *', { name: 'food-order-deadlines' })
  async cronDeadlines() {
    if (!this.enabled) return;
    await this.autoReject();
    await this.cancelUnpaidTransfers();
  }

  @Cron('0 * * * * *', { name: 'food-reminders' })
  async cronReminders() {
    if (!this.enabled) return;
    await this.kitchenReminders();
    await this.acceptNudges();
    await this.autoResume();
  }

  /** Timed pauses (outage quick-pause) end by themselves. Idempotent. */
  async autoResume(now = new Date()) {
    return this.run('food:auto-resume', async (m) => {
      const rows = await m.query(
        `UPDATE branches SET is_paused = false, pause_message = NULL, pause_reason = NULL,
                auto_resume_at = NULL, updated_at = now()
          WHERE is_paused AND auto_resume_at IS NOT NULL AND auto_resume_at <= $1
        RETURNING id`,
        [now],
      );
      return {
        counts: { resumed: rows[0]?.length ?? rows.length ?? 0 },
        notices: [],
        changed: [],
      };
    });
  }

  /** Smart ETA: real prep times per hour and order size (last 30 days). */
  async recomputePrepStats(now = new Date()) {
    return this.run('food:prep-stats', async (m) => ({
      counts: await this.prepStats.recompute(m, now),
      notices: [],
      changed: [],
    }));
  }

  @Cron('5 0 * * *', { name: 'food-daily-reset', timeZone: 'Asia/Karachi' })
  async cronDaily() {
    if (this.enabled) await this.dailyReset();
  }

  @Cron('30 3 * * *', { name: 'food-nightly', timeZone: 'Asia/Karachi' })
  async cronNightly() {
    if (this.enabled) await this.nightlyWork();
  }

  /** Scheduled orders: tell the kitchen to start at scheduled_for − prep − 10 min. Once. */
  async kitchenReminders(now = new Date()) {
    return this.run('food:kitchen-reminders', async (m) => {
      const rows = await m.query(
        `UPDATE food_orders o SET kitchen_reminded_at = $1
           FROM branches br
          WHERE br.id = o.branch_id AND o.scheduled_for IS NOT NULL AND o.kitchen_reminded_at IS NULL
            AND o.status = 'accepted'
            AND o.scheduled_for - make_interval(mins => br.prep_minutes + 10) <= $1
          RETURNING o.id, o.code, o.branch_id, o.scheduled_for, br.timezone`,
        [now],
      );
      const due = rows[0] ?? [];
      const notices: FoodNotice[] = [];
      for (const r of due)
        notices.push({
          userId: await this.notifier.ownerOf(r.branch_id),
          payload: {
            type: 'food.order.start_cooking',
            title: `Start ${r.code}`,
            body: `Scheduled for ${formatTime12(new Date(r.scheduled_for), r.timezone)}.`,
            data: { orderId: r.id, code: r.code },
            priority: 'high',
          },
        });
      return { counts: { reminded: due.length }, notices, changed: [] };
    });
  }

  /** Two minutes before an unanswered order auto-rejects, ring the kitchen again. Once. */
  async acceptNudges(now = new Date()) {
    return this.run('food:accept-nudges', async (m) => {
      const [rows] = await m.query(
        `UPDATE food_orders SET accept_nudged_at = $1
          WHERE status = 'placed' AND accept_nudged_at IS NULL
            AND accept_by - interval '2 minutes' <= $1 AND accept_by > $1
          RETURNING id, code, branch_id`,
        [now],
      );
      const notices: FoodNotice[] = [];
      for (const r of rows)
        notices.push({
          userId: await this.notifier.ownerOf(r.branch_id),
          payload: {
            type: 'food.order.accept_soon',
            title: `${r.code} is waiting`,
            body: 'Accept or reject it — it auto-rejects in 2 minutes.',
            data: { orderId: r.id, code: r.code },
            priority: 'high',
          },
        });
      return { counts: { nudged: rows.length }, notices, changed: [] };
    });
  }

  /**
   * 00:05 local: today's portions back to each dish's daily limit, and stale
   * busy mode cleared. A branch is reset once per local day
   * (portions_reset_on), so a second run changes nothing.
   */
  async dailyReset(now = new Date()) {
    return this.run('food:daily-reset', async (m) => {
      const [branches] = await m.query(
        `UPDATE branches SET portions_reset_on = (($1::timestamptz) AT TIME ZONE timezone)::date
          WHERE portions_reset_on IS DISTINCT FROM (($1::timestamptz) AT TIME ZONE timezone)::date
          RETURNING id`,
        [now],
      );
      const ids = branches.map((b: any) => b.id);
      const [, portions] = ids.length
        ? await m.query(
            `UPDATE branch_item_overrides SET remaining_today = daily_limit, updated_at = now()
              WHERE branch_id = ANY($1::uuid[]) AND daily_limit IS NOT NULL
                AND remaining_today IS DISTINCT FROM daily_limit`,
            [ids],
          )
        : [[], 0];
      const [, busy] = await m.query(
        `UPDATE branches SET busy_until = NULL, busy_extra_minutes = 0, updated_at = now()
          WHERE busy_until IS NOT NULL AND busy_until <= $1`,
        [now],
      );
      return {
        counts: {
          branches: ids.length,
          portions: portions ?? 0,
          busyCleared: busy ?? 0,
        },
        notices: [],
        changed: [],
      };
    });
  }

  /** Ratings and sold_30d recomputed (changed rows only); location history past 14 days purged. */
  async nightlyWork(now = new Date()) {
    return this.run('food:nightly', async (m) => {
      const ratings = await this.aggregates.ratings(m);
      const sold = await this.aggregates.sold30d(now);
      const purged = await this.locations.purge(
        new Date(now.getTime() - LOCATION_RETENTION_DAYS * 86_400_000),
      );
      for (const work of this.nightly) await work(now);
      return { counts: { ratings, sold, purged }, notices: [], changed: [] };
    });
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
