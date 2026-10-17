import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FoodCheckoutPlanner, FoodPlan } from './food-checkout-planner.service';
import { FoodCheckoutDto } from './dto/checkout.dto';
import { FoodCart } from '../cart/entities/food-cart.entity';
import { FoodOrder } from '../orders/entities/food-order.entity';
import { FoodOrderItem } from '../orders/entities/food-order-item.entity';
import { FoodOrderEvent } from '../orders/entities/food-order-event.entity';
import {
  INITIAL_PAYMENT,
  TRANSFER_WINDOW_MINUTES,
} from '../orders/food-payment-status';
import { FoodOrderViewsService } from '../orders/food-order-views.service';
import { FoodNotifier } from '../orders/food-notifier.service';
import { ErrorCode } from '../../../common/errors/codes';
import { newCode } from '../../../common/utils/codes';
import { formatTime12, todayIn } from '../../../common/time/time.util';

/**
 * A seam for tests to fail checkout at its riskiest point — after portions
 * and the promotion use have been taken — and prove the transaction leaves
 * nothing behind. The real provider does nothing; there is no debug route.
 */
export const FOOD_CHECKOUT_FAULT_INJECTOR = 'FOOD_CHECKOUT_FAULT_INJECTOR';
export interface FoodCheckoutFaultInjector {
  afterDecrements(m: EntityManager): Promise<void> | void;
}
export const noFoodCheckoutFaults: FoodCheckoutFaultInjector = {
  afterDecrements: () => undefined,
};

const STATUS_FOR: Record<string, HttpStatus> = {
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CART_OTHER_VENDOR]: HttpStatus.CONFLICT,
  [ErrorCode.ITEM_UNAVAILABLE]: HttpStatus.CONFLICT,
  [ErrorCode.PORTIONS_SOLD_OUT]: HttpStatus.CONFLICT,
  [ErrorCode.SLOT_FULL]: HttpStatus.CONFLICT,
  [ErrorCode.PROMO_LIMIT_REACHED]: HttpStatus.CONFLICT,
  [ErrorCode.VENDOR_CLOSED]: HttpStatus.CONFLICT,
  [ErrorCode.VENDOR_PAUSED]: HttpStatus.CONFLICT,
};

/** The first problem as the error; every problem in details. */
export function planError(plan: FoodPlan): HttpException {
  const first = plan.issues[0];
  return new HttpException(
    {
      code: first.code,
      message: first.message,
      details: { ...first.details, issues: plan.issues },
    },
    STATUS_FOR[first.code] ?? HttpStatus.BAD_REQUEST,
  );
}

/**
 * Checkout — ONE Postgres transaction:
 *   lock the cart → plan (the same validation and pricing the preview ran)
 *   → take a place in the pre-order slot (row lock, recount) → take today's
 *   portions with conditional UPDATEs → take one promotion use → write the
 *   order, its snapshot lines and the `placed` event → clear the cart →
 *   commit.
 * A failure anywhere rolls all of it back. The vendor is told after the
 * commit (high-priority push, and order.new on the socket).
 */
@Injectable()
export class FoodCheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly planner: FoodCheckoutPlanner,
    private readonly views: FoodOrderViewsService,
    private readonly notifier: FoodNotifier,
    @Inject(FOOD_CHECKOUT_FAULT_INJECTOR)
    private readonly faults: FoodCheckoutFaultInjector,
  ) {}

  async checkout(userId: string, dto: FoodCheckoutDto) {
    const order = await this.dataSource.transaction(async (m) => {
      const now = new Date();
      const plan = await this.planner.plan(m, userId, dto, { lock: true, now });
      if (!plan.ok) throw planError(plan);
      if (plan.slot) await this.claimSlot(m, plan);
      const portionDate = await this.takePortions(m, plan, now);
      if (plan.promotion) await this.claimPromotion(m, plan);
      await this.faults.afterDecrements(m);
      const order = await this.insertOrder(
        m,
        userId,
        plan,
        dto,
        now,
        portionDate,
      );
      await m.delete(FoodCart, { id: plan.cart!.id });
      return order;
    });
    await this.notifier.placed(order);
    return this.views.customer(userId, order.code);
  }

  /** The slot row is locked, so two checkouts for its last place are serialised. */
  private async claimSlot(m: EntityManager, plan: FoodPlan) {
    const s = plan.slot!;
    await m.query(`SELECT id FROM preorder_slots WHERE id = $1 FOR UPDATE`, [
      s.slotId,
    ]);
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM food_orders
        WHERE slot_id = $1 AND scheduled_for = $2 AND status NOT IN ('rejected', 'auto_rejected', 'cancelled')`,
      [s.slotId, s.startsAt],
    );
    if (n >= s.maxOrders)
      throw new ConflictException({
        code: ErrorCode.SLOT_FULL,
        message: `The ${formatTime12(s.startsAt, plan.branch!.timezone)} slot has just filled up — choose another.`,
        details: { slotId: s.slotId },
      });
  }

  /** remaining_today − q only where at least q are left: the last portion goes to one checkout. */
  private async takePortions(m: EntityManager, plan: FoodPlan, now: Date) {
    const wanted = new Map<string, { name: string; qty: number }>();
    for (const l of plan.lines)
      if (l.portioned) {
        const w = wanted.get(l.itemId) ?? { name: l.name, qty: 0 };
        w.qty += l.quantity;
        wanted.set(l.itemId, w);
      }
    if (!wanted.size) return null;
    for (const [itemId, w] of [...wanted].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const [rows] = await m.query(
        `UPDATE branch_item_overrides SET remaining_today = remaining_today - $3, updated_at = now()
          WHERE branch_id = $1 AND item_id = $2 AND remaining_today >= $3
          RETURNING remaining_today`,
        [plan.branch!.id, itemId, w.qty],
      );
      if (!rows.length) {
        const [left] = await m.query(
          `SELECT remaining_today FROM branch_item_overrides WHERE branch_id = $1 AND item_id = $2`,
          [plan.branch!.id, itemId],
        );
        const remaining = left?.remaining_today ?? 0;
        throw new ConflictException({
          code: ErrorCode.PORTIONS_SOLD_OUT,
          message:
            remaining > 0
              ? `Only ${remaining} ${w.name} left today.`
              : `${w.name} has just sold out for today.`,
          details: { item: w.name, itemId, remaining },
        });
      }
    }
    return todayIn(plan.branch!.timezone, now);
  }

  private async claimPromotion(m: EntityManager, plan: FoodPlan) {
    const p = plan.promotion!;
    const [, claimed] = await m.query(
      `UPDATE food_promotions SET used_count = used_count + 1, updated_at = now()
        WHERE id = $1 AND is_active AND (usage_limit IS NULL OR used_count < usage_limit)`,
      [p.id],
    );
    if (claimed !== 1)
      throw new ConflictException({
        code: ErrorCode.PROMO_LIMIT_REACHED,
        message: `${p.code ? `“${p.code}”` : p.title} has just been used up.`,
        details: { promotionId: p.id, code: p.code },
      });
  }

  private async insertOrder(
    m: EntityManager,
    userId: string,
    plan: FoodPlan,
    dto: FoodCheckoutDto,
    now: Date,
    portionDate: string | null,
  ): Promise<FoodOrder> {
    const branch = plan.branch!;
    const quote = plan.quote!;
    const a = plan.address;
    const transfer = dto.paymentMethod === 'transfer';
    const scheduledFor = plan.cart!.scheduledFor;
    const values: Partial<FoodOrder> = {
      userId,
      brandId: plan.vendor!.id,
      branchId: branch.id,
      fulfilment: plan.cart!.fulfilment,
      scheduledFor,
      slotId: plan.slot?.slotId ?? null,
      status: 'placed',
      paymentMethod: dto.paymentMethod,
      paymentStatus: INITIAL_PAYMENT[dto.paymentMethod],
      paymentAccountSnapshot: transfer ? plan.accounts : null,
      payBy: transfer
        ? new Date(now.getTime() + TRANSFER_WINDOW_MINUTES * 60_000)
        : null,
      addressSnapshot: a
        ? {
            label: a.label,
            fullName: a.fullName,
            phone: a.phone,
            city: a.city,
            area: a.area,
            line1: a.line1,
            landmark: a.landmark ?? null,
            building: dto.building ?? null,
            floor: dto.floor ?? null,
            riderInstructions: dto.riderInstructions ?? null,
            lat: a.lat!,
            lng: a.lng!,
          }
        : null,
      distanceM:
        a && branch.distance_m !== null ? Math.round(branch.distance_m) : null,
      subtotal: plan.subtotal,
      discount: plan.discount,
      promotionId: plan.promotion?.id ?? null,
      promotionSnapshot: plan.promotion
        ? {
            id: plan.promotion.id,
            title: plan.promotion.title,
            kind: plan.promotion.kind,
            code: plan.promotion.code,
          }
        : null,
      deliveryFee: plan.deliveryFee,
      total: plan.total,
      cutlery: dto.cutlery ?? false,
      customerNote: dto.note ?? null,
      etaMinutes: scheduledFor ? null : quote.eta.max,
      promisedAt:
        scheduledFor ?? new Date(now.getTime() + quote.eta.max * 60_000),
      acceptBy: new Date(now.getTime() + branch.auto_reject_minutes * 60_000),
      portionDate,
    };
    let orderId: string | null = null;
    for (let attempt = 0; attempt < 5 && !orderId; attempt++) {
      // ON CONFLICT DO NOTHING on the code: a collision leaves the transaction usable.
      const res = await m
        .createQueryBuilder()
        .insert()
        .into(FoodOrder)
        .values({ ...values, code: newCode('FC') })
        .orIgnore()
        .returning('id')
        .execute();
      if (res.raw.length) orderId = res.raw[0].id;
    }
    if (!orderId)
      throw new Error('Could not allocate an order code after 5 attempts');
    if (a)
      await m.query(
        `UPDATE food_orders SET drop_geo = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography WHERE id = $1`,
        [orderId, a.lng, a.lat],
      );
    await m.insert(
      FoodOrderItem,
      plan.lines.map((l, i) => ({
        orderId: orderId!,
        lineNo: i + 1,
        itemId: l.itemId,
        variantId: l.variant?.id ?? null,
        itemName: l.name,
        variantName: l.variant?.name ?? null,
        options: l.options,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        notes: l.notes,
        portionsTaken: l.portioned ? l.quantity : 0,
      })),
    );
    await m.save(
      m.create(FoodOrderEvent, {
        orderId,
        kind: 'status',
        from: null,
        to: 'placed',
        actorRole: 'customer',
        actorUserId: userId,
        note: null,
        data: plan.promotion ? { promotionId: plan.promotion.id } : null,
      }),
    );
    return m.findOneByOrFail(FoodOrder, { id: orderId });
  }
}
