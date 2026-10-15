import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { StoreOrder } from './entities/store-order.entity';
import { OrderTransitionsService, SYSTEM } from './order-transitions.service';
import {
  NotificationsService,
  NotifyPayload,
} from '../../notifications/notifications.service';
import { LOW_STOCK_THRESHOLD } from '../common/catalog-sql';

const HOUR_MS = 60 * 60 * 1000;
const BATCH = 200;
const UNPAID_REASON = 'Payment was not received by the deadline.';

type Notice = { userId: string; payload: NotifyPayload };

/**
 * Shopping's scheduled work. Every job:
 *  - takes a transaction-scoped advisory lock, so two dynos never run it at
 *    once (the second simply skips);
 *  - changes rows only through conditional updates / the transitions
 *    service, so a second run finds nothing left to do;
 *  - notifies after its transaction commits, and logs what it did.
 * Each is a plain method too: tests (and ops) call them directly.
 */
@Injectable()
export class OrderJobsService {
  private readonly logger = new Logger(OrderJobsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transitions: OrderTransitionsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<boolean>('jobs.enabled') ?? true;
  }

  @Cron('*/10 * * * *', { name: 'shop-cancel-unpaid-transfers' })
  async cronCancelUnpaid() {
    if (this.enabled) await this.cancelUnpaidTransfers();
  }

  @Cron('5 * * * *', { name: 'shop-order-reminders' })
  async cronReminders() {
    if (this.enabled) await this.remindStalePlaced();
  }

  @Cron('0 3 * * *', {
    name: 'shop-complete-delivered',
    timeZone: 'Asia/Karachi',
  })
  async cronComplete() {
    if (this.enabled) await this.completeDelivered();
  }

  @Cron('0 9 * * *', {
    name: 'shop-low-stock-digest',
    timeZone: 'Asia/Karachi',
  })
  async cronLowStock() {
    if (this.enabled) await this.lowStockDigest();
  }

  /** Transfer orders still unpaid at pay_by: cancelled by the system, restocked, both sides told. */
  async cancelUnpaidTransfers(now = new Date()) {
    return this.run('shop:cancel-unpaid-transfers', async (m) => {
      const due = await m
        .createQueryBuilder(StoreOrder, 'o')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where(`o.payment_method = 'transfer'`)
        .andWhere(`o.payment_status = 'awaiting_transfer'`)
        .andWhere(`o.status IN ('placed', 'confirmed', 'packed')`)
        .andWhere('o.pay_by < :now', { now })
        .orderBy('o.payBy', 'ASC')
        .limit(BATCH)
        .getMany();
      const notices: Notice[] = [];
      for (const o of due) {
        await this.transitions.moveStatus(m, o, 'cancelled', SYSTEM, {
          note: UNPAID_REASON,
          patch: { cancelReason: UNPAID_REASON, cancelledBy: 'system' },
        });
        const data = { storeOrderId: o.id, code: o.code };
        notices.push(
          {
            userId: o.userId,
            payload: {
              type: 'shop.order.cancelled',
              title: `${o.code} cancelled`,
              body: 'We didn’t receive confirmation of your transfer in time, so the order was cancelled.',
              data,
            },
          },
          {
            userId: await this.owner(m, o.storeId),
            payload: {
              type: 'shop.order.cancelled',
              title: `${o.code} cancelled — unpaid`,
              body: 'The transfer deadline passed. The items are back in stock.',
              data,
            },
          },
        );
      }
      return { counts: { cancelled: due.length }, notices };
    });
  }

  /** Placed for 12 h → nudge the store; for 48 h → tell the customer they may cancel. Once each. */
  async remindStalePlaced(now = new Date()) {
    return this.run('shop:order-reminders', async (m) => {
      const [stores] = await m.query(
        `UPDATE store_orders SET store_reminded_at = now()
          WHERE status = 'placed' AND store_reminded_at IS NULL AND created_at < $1
          RETURNING id, code, store_id`,
        [new Date(now.getTime() - 12 * HOUR_MS)],
      );
      const [customers] = await m.query(
        `UPDATE store_orders SET customer_cancel_hint_at = now()
          WHERE status = 'placed' AND customer_cancel_hint_at IS NULL AND created_at < $1
          RETURNING id, code, user_id`,
        [new Date(now.getTime() - 48 * HOUR_MS)],
      );
      const notices: Notice[] = [];
      for (const r of stores) {
        notices.push({
          userId: await this.owner(m, r.store_id),
          payload: {
            type: 'shop.order.reminder',
            title: `${r.code} is waiting`,
            body: 'This order was placed over 12 hours ago — confirm or decline it.',
            data: { storeOrderId: r.id, code: r.code },
          },
        });
      }
      for (const r of customers) {
        notices.push({
          userId: r.user_id,
          payload: {
            type: 'shop.order.stale',
            title: `${r.code} not confirmed yet`,
            body: 'The store hasn’t confirmed your order in 48 hours. You can cancel it if you like.',
            data: { storeOrderId: r.id, code: r.code },
          },
        });
      }
      return {
        counts: {
          storeReminders: stores.length,
          customerHints: customers.length,
        },
        notices,
      };
    });
  }

  /**
   * Delivered orders past their return window with no open return become
   * completed. (The return check joins return_requests once returns exist.)
   */
  async completeDelivered(now = new Date()) {
    return this.run('shop:complete-delivered', async (m) => {
      const due = await m
        .createQueryBuilder(StoreOrder, 'o')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where(`o.status = 'delivered'`)
        .andWhere(
          `o.delivered_at + make_interval(days => o.return_window_days) <= :now`,
          { now },
        )
        .andWhere(OPEN_RETURN_GUARD)
        .orderBy('o.deliveredAt', 'ASC')
        .limit(BATCH)
        .getMany();
      for (const o of due)
        await this.transitions.moveStatus(m, o, 'completed', SYSTEM);
      return { counts: { completed: due.length }, notices: [] };
    });
  }

  /** Once a day per store: how many active variants are at ≤ 3. */
  async lowStockDigest() {
    return this.run('shop:low-stock-digest', async (m) => {
      const rows: Array<{
        store_id: string;
        owner_user_id: string;
        low: number;
      }> = await m.query(
        `SELECT s.id AS store_id, b.owner_user_id, count(*)::int AS low
           FROM stores s
           JOIN businesses b ON b.id = s.business_id
           JOIN products p ON p.store_id = s.id AND p.status = 'active'
           JOIN product_variants v ON v.product_id = p.id AND v.is_active AND v.stock <= ${LOW_STOCK_THRESHOLD}
          WHERE b.status = 'approved'
            AND (s.low_stock_digest_on IS NULL OR s.low_stock_digest_on < (now() AT TIME ZONE 'Asia/Karachi')::date)
          GROUP BY s.id, b.owner_user_id`,
      );
      if (rows.length) {
        await m.query(
          `UPDATE stores SET low_stock_digest_on = (now() AT TIME ZONE 'Asia/Karachi')::date
            WHERE id = ANY($1::uuid[])`,
          [rows.map((r) => r.store_id)],
        );
      }
      const notices: Notice[] = rows.map((r) => ({
        userId: r.owner_user_id,
        payload: {
          type: 'shop.inventory.low_stock',
          title: 'Low stock',
          body: `${r.low} variant${r.low === 1 ? ' is' : 's are'} at ${LOW_STOCK_THRESHOLD} or fewer.`,
          data: { screen: 'inventory', lowStock: true },
        },
      }));
      return { counts: { stores: rows.length }, notices };
    });
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private async owner(m: EntityManager, storeId: string): Promise<string> {
    const [row] = await m.query(
      `SELECT b.owner_user_id FROM stores s JOIN businesses b ON b.id = s.business_id WHERE s.id = $1`,
      [storeId],
    );
    return row.owner_user_id;
  }

  private async run(
    name: string,
    work: (
      m: EntityManager,
    ) => Promise<{ counts: Record<string, number>; notices: Notice[] }>,
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
    for (const n of result.notices) {
      try {
        await this.notifications.notify(n.userId, n.payload);
      } catch (err) {
        this.logger.warn(
          `${name}: notification failed: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(`${name}: ${JSON.stringify(result.counts)}`);
    return result.counts;
  }
}

/** Replaced by a NOT EXISTS on return_requests once returns ship (P5). */
const OPEN_RETURN_GUARD = 'TRUE';
