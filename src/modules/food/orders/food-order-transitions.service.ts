import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FoodOrder } from './entities/food-order.entity';
import { FoodOrderItem } from './entities/food-order-item.entity';
import {
  FoodEventKind,
  FoodOrderEvent,
} from './entities/food-order-event.entity';
import {
  FoodActorRole,
  FoodOrderStatus,
  NEGATIVE_END,
  STATUS_TIMESTAMP,
  assertFoodTransition,
} from './food-order-status';
import {
  FoodPaymentStatus,
  PAYMENT_ON_CANCEL,
  PAYMENT_ON_HANDOVER,
  assertFoodPaymentTransition,
} from './food-payment-status';
import { invalidTransition } from '../../../common/state/transitions';
import { ErrorCode } from '../../../common/errors/codes';
import { todayIn } from '../../../common/time/time.util';

export interface FoodActor {
  role: FoodActorRole;
  userId: string | null;
}

export const SYSTEM: FoodActor = { role: 'system', userId: null };

export const orderNotFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Order not found.',
  });

/**
 * The only code that changes a food order's status, payment status or rider
 * steps. Each move is checked against its state machine for the actor (and
 * the order's fulfilment), applied with a conditional UPDATE (… WHERE
 * status = :from), and recorded as an event — all in the caller's
 * transaction. A move to rejected / auto_rejected / cancelled gives back
 * today's portions and the promotion use, settles the payment and frees the
 * rider; handing the food over settles cash.
 */
export type StatusHook = (
  m: EntityManager,
  order: FoodOrder,
  from: FoodOrderStatus,
  to: FoodOrderStatus,
  actor: FoodActor,
) => Promise<void>;

@Injectable()
export class FoodOrderTransitionsService {
  /**
   * Other sub-domains react to a move inside the same transaction, without
   * Food importing them (Chunk 5): `beforeStatus` may refuse it (packing
   * photo), `afterStatus` follows it (stock deducted on accept, put back on
   * cancel).
   */
  readonly beforeStatus: StatusHook[] = [];
  readonly afterStatus: StatusHook[] = [];

  /** Lock one order for this transaction, scoped to its branch, customer or rider. */
  async lock(
    m: EntityManager,
    where: {
      id?: string;
      code?: string;
      branchId?: string;
      userId?: string;
      riderId?: string;
    },
  ): Promise<FoodOrder> {
    const order = await m.findOne(FoodOrder, {
      where,
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) throw orderNotFound();
    return order;
  }

  async moveStatus(
    m: EntityManager,
    order: FoodOrder,
    to: FoodOrderStatus,
    actor: FoodActor,
    opts: {
      note?: string | null;
      patch?: Partial<FoodOrder>;
      message?: string;
      data?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    const from = order.status;
    assertFoodTransition(from, to, actor.role, order.fulfilment, opts.message);
    for (const hook of this.beforeStatus) await hook(m, order, from, to, actor);
    const patch: Partial<FoodOrder> = { ...opts.patch, status: to };
    const stamp = STATUS_TIMESTAMP[to] as keyof FoodOrder | undefined;
    if (stamp) (patch as Record<string, unknown>)[stamp] = new Date();
    if (NEGATIVE_END.includes(to)) patch.cancelledBy = actor.role;
    await this.conditionalUpdate(m, order, patch, { status: from }, from, to);
    await this.event(
      m,
      order.id,
      'status',
      from,
      to,
      actor,
      opts.note ?? null,
      opts.data,
    );
    if (NEGATIVE_END.includes(to)) await this.afterCancel(m, order, actor);
    if (to === 'delivered' || to === 'picked_up') {
      const next = PAYMENT_ON_HANDOVER[order.paymentStatus];
      if (next) await this.movePayment(m, order, next, actor);
      if (order.riderId) await this.releaseRider(m, order.riderId);
    }
    for (const hook of this.afterStatus) await hook(m, order, from, to, actor);
  }

  async movePayment(
    m: EntityManager,
    order: FoodOrder,
    to: FoodPaymentStatus,
    actor: FoodActor,
    opts: {
      note?: string | null;
      patch?: Partial<FoodOrder>;
      message?: string;
    } = {},
  ): Promise<void> {
    const from = order.paymentStatus;
    assertFoodPaymentTransition(from, to, actor.role, opts.message);
    const patch: Partial<FoodOrder> = { ...opts.patch, paymentStatus: to };
    if (to === 'paid') patch.paidAt = new Date();
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

  /** A rider step (assigned, accepted_by_rider, arrived_at_branch, …): an event, kind = rider. */
  async riderEvent(
    m: EntityManager,
    orderId: string,
    step: string,
    actor: FoodActor,
    note: string | null = null,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.event(m, orderId, 'rider', null, step, actor, note, data);
  }

  async note(
    m: EntityManager,
    orderId: string,
    actor: FoodActor,
    note: string,
  ): Promise<void> {
    await this.event(m, orderId, 'note', null, null, actor, note);
  }

  private async conditionalUpdate(
    m: EntityManager,
    order: FoodOrder,
    patch: Partial<FoodOrder>,
    guard: Partial<Pick<FoodOrder, 'status' | 'paymentStatus'>>,
    from: string,
    to: string,
  ) {
    const res = await m
      .createQueryBuilder()
      .update(FoodOrder)
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
    orderId: string,
    kind: FoodEventKind,
    from: string | null,
    to: string | null,
    actor: FoodActor,
    note: string | null,
    data?: Record<string, unknown>,
  ) {
    await m.save(
      m.create(FoodOrderEvent, {
        orderId,
        kind,
        from,
        to,
        actorRole: actor.role,
        actorUserId: actor.userId,
        note,
        data: data ?? null,
      }),
    );
  }

  /** Portions back (same day), promotion use back, payment settled, rider freed. */
  private async afterCancel(
    m: EntityManager,
    order: FoodOrder,
    actor: FoodActor,
  ) {
    if (order.portionDate) {
      const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
        order.branchId,
      ]);
      if (order.portionDate === todayIn(b.timezone)) {
        const items = await m.find(FoodOrderItem, {
          where: { orderId: order.id },
        });
        const back = new Map<string, number>();
        for (const i of items)
          if (i.itemId && i.portionsTaken > 0)
            back.set(i.itemId, (back.get(i.itemId) ?? 0) + i.portionsTaken);
        for (const [itemId, n] of back)
          await m.query(
            `UPDATE branch_item_overrides
                SET remaining_today = LEAST(remaining_today + $3, COALESCE(daily_limit, remaining_today + $3)),
                    updated_at = now()
              WHERE branch_id = $1 AND item_id = $2 AND remaining_today IS NOT NULL`,
            [order.branchId, itemId, n],
          );
      }
    }
    if (order.promotionId)
      await m.query(
        `UPDATE food_promotions SET used_count = used_count - 1, updated_at = now()
          WHERE id = $1 AND used_count > 0`,
        [order.promotionId],
      );
    const next = PAYMENT_ON_CANCEL[order.paymentStatus];
    if (next) await this.movePayment(m, order, next, actor);
    if (order.riderId) await this.releaseRider(m, order.riderId);
  }

  private async releaseRider(m: EntityManager, riderId: string) {
    await m.query(
      `UPDATE riders SET active_order_count = GREATEST(active_order_count - 1, 0), updated_at = now() WHERE id = $1`,
      [riderId],
    );
  }
}
