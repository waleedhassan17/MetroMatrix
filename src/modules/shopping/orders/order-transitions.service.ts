import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { StoreOrder } from './entities/store-order.entity';
import { StoreOrderItem } from './entities/store-order-item.entity';
import {
  OrderEventKind,
  StoreOrderEvent,
} from './entities/store-order-event.entity';
import {
  ActorRole,
  OrderStatus,
  STATUS_TIMESTAMP,
  assertOrderTransition,
} from './order-status';
import {
  PAYMENT_ON_CANCEL,
  PaymentStatus,
  assertPaymentTransition,
} from './payment-status';
import { CouponRedemption } from '../coupons/entities/coupon-redemption.entity';
import { InventoryService } from '../inventory/inventory.service';
import { invalidTransition } from '../../../common/state/transitions';
import { ErrorCode } from '../../../common/errors/codes';

export interface Actor {
  role: ActorRole;
  userId: string | null;
}

export const SYSTEM: Actor = { role: 'system', userId: null };

/**
 * The only code that changes a store order's status or payment status.
 * Each move is checked against the state machine for its actor, applied with
 * a conditional UPDATE (… WHERE status = :from), recorded as an event, and
 * — for a cancel — followed by its side effects (stock back, coupon use
 * back, payment voided or marked refund_due), all in the caller's
 * transaction.
 */
@Injectable()
export class OrderTransitionsService {
  constructor(private readonly inventory: InventoryService) {}

  /** Lock one store order for this transaction, scoped to its store or customer. */
  async lock(
    m: EntityManager,
    where: { id: string; storeId?: string; userId?: string },
  ): Promise<StoreOrder> {
    const order = await m.findOne(StoreOrder, {
      where,
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Order not found.',
      });
    }
    return order;
  }

  async moveStatus(
    m: EntityManager,
    order: StoreOrder,
    to: OrderStatus,
    actor: Actor,
    opts: {
      note?: string | null;
      patch?: Partial<StoreOrder>;
      message?: string;
    } = {},
  ): Promise<void> {
    const from = order.status;
    assertOrderTransition(from, to, actor.role, opts.message);
    const patch: Partial<StoreOrder> = { ...opts.patch, status: to };
    const stamp = STATUS_TIMESTAMP[to] as keyof StoreOrder | undefined;
    if (stamp) (patch as Record<string, unknown>)[stamp] = new Date();
    await this.conditionalUpdate(m, order, patch, { status: from }, from, to);
    await this.event(m, order.id, 'status', from, to, actor, opts.note ?? null);
    if (to === 'cancelled') await this.afterCancel(m, order, actor);
  }

  async movePayment(
    m: EntityManager,
    order: StoreOrder,
    to: PaymentStatus,
    actor: Actor,
    opts: {
      note?: string | null;
      patch?: Partial<StoreOrder>;
      message?: string;
    } = {},
  ): Promise<void> {
    const from = order.paymentStatus;
    assertPaymentTransition(from, to, actor.role, opts.message);
    const patch: Partial<StoreOrder> = { ...opts.patch, paymentStatus: to };
    if (to === 'paid') patch.paidAt = new Date();
    if (to === 'refunded') patch.refundedAt = new Date();
    await this.conditionalUpdate(
      m,
      order,
      patch,
      { paymentStatus: from },
      from,
      to,
    );
    await this.event(
      m,
      order.id,
      'payment',
      from,
      to,
      actor,
      opts.note ?? null,
    );
  }

  async note(
    m: EntityManager,
    orderId: string,
    actor: Actor,
    note: string,
  ): Promise<void> {
    await this.event(m, orderId, 'note', null, null, actor, note);
  }

  private async conditionalUpdate(
    m: EntityManager,
    order: StoreOrder,
    patch: Partial<StoreOrder>,
    guard: Partial<Pick<StoreOrder, 'status' | 'paymentStatus'>>,
    from: string,
    to: string,
  ) {
    const res = await m
      .createQueryBuilder()
      .update(StoreOrder)
      .set(patch)
      .where({ id: order.id, ...guard })
      .execute();
    if (res.affected !== 1) {
      throw invalidTransition(
        from,
        to,
        [],
        'This order just changed — refresh and try again.',
      );
    }
    Object.assign(order, patch);
  }

  private async event(
    m: EntityManager,
    storeOrderId: string,
    kind: OrderEventKind,
    from: string | null,
    to: string | null,
    actor: Actor,
    note: string | null,
  ) {
    await m.insert(StoreOrderEvent, {
      storeOrderId,
      kind,
      from,
      to,
      actorRole: actor.role,
      actorUserId: actor.userId,
      note,
    });
  }

  /** Stock back, sold count back, coupon use back, payment settled. */
  private async afterCancel(m: EntityManager, order: StoreOrder, actor: Actor) {
    const items = await m.find(StoreOrderItem, {
      where: { storeOrderId: order.id },
    });
    if (items.length) {
      await this.inventory.apply(
        m,
        items.map((i) => ({ variantId: i.variantId, delta: i.quantity })),
        {
          reason: 'cancel',
          refType: 'store_order',
          refId: order.id,
          actorUserId: actor.userId,
        },
      );
      for (const i of items) {
        await m.query(
          `UPDATE products SET sold_count = GREATEST(sold_count - $2, 0) WHERE id = $1`,
          [i.productId, i.quantity],
        );
      }
    }
    const redemption = await m.findOne(CouponRedemption, {
      where: { storeOrderId: order.id },
    });
    if (redemption) {
      await m.delete(CouponRedemption, { id: redemption.id });
      await m.query(
        `UPDATE coupons SET used_count = used_count - 1 WHERE id = $1 AND used_count > 0`,
        [redemption.couponId],
      );
    }
    const next = PAYMENT_ON_CANCEL[order.paymentStatus];
    if (next) await this.movePayment(m, order, next, actor);
  }
}
