import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  NotificationsService,
  NotifyPayload,
} from '../../notifications/notifications.service';
import { FoodOrder } from './entities/food-order.entity';

export interface FoodNotice {
  userId: string;
  payload: NotifyPayload;
}

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/**
 * Tells people about orders, always after the transaction commits. Push and
 * in-app notifications here; the realtime gateway adds its fan-out through
 * `onOrderChanged` (P5). Never throws: a failed notice is logged, the order
 * stands.
 */
@Injectable()
export class FoodNotifier {
  private readonly logger = new Logger(FoodNotifier.name);
  /** Filled in by the realtime gateway: emit order.new / order.updated. */
  onOrderChanged: (orderId: string, kind: 'new' | 'updated') => Promise<void> =
    async () => undefined;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async ownerOf(branchId: string): Promise<string> {
    const [row] = await this.dataSource.query(
      `SELECT b.owner_user_id FROM branches br JOIN businesses b ON b.id = br.business_id WHERE br.id = $1`,
      [branchId],
    );
    return row.owner_user_id;
  }

  /** A new order: the vendor's phone rings (high priority). */
  async placed(order: FoodOrder) {
    const [{ n }] = await this.dataSource.query(
      `SELECT coalesce(sum(quantity), 0)::int AS n FROM food_order_items WHERE order_id = $1`,
      [order.id],
    );
    await this.send([
      {
        userId: await this.ownerOf(order.branchId),
        payload: {
          type: 'food.order.new',
          title: `New order ${order.code}`,
          body: `${n} item${n === 1 ? '' : 's'} · ${rs(order.total)} · ${order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}${order.scheduledFor ? ' · scheduled' : ''}`,
          data: {
            orderId: order.id,
            code: order.code,
            screen: 'food.vendor.order',
          },
          priority: 'high',
        },
      },
    ]);
    await this.changed(order.id, 'new');
  }

  async changed(orderId: string, kind: 'new' | 'updated' = 'updated') {
    try {
      await this.onOrderChanged(orderId, kind);
    } catch (err) {
      this.logger.warn(`realtime emit failed: ${(err as Error).message}`);
    }
  }

  async send(notices: FoodNotice[]) {
    for (const n of notices) {
      try {
        await this.notifications.notify(n.userId, n.payload);
      } catch (err) {
        this.logger.warn(`notification failed: ${(err as Error).message}`);
      }
    }
  }
}
