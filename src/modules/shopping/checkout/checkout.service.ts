import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CheckoutPlan,
  CheckoutPlanner,
  StorePlan,
} from './checkout-planner.service';
import { CheckoutDto } from './dto/checkout.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  OrderGroup,
  AddressSnapshot,
} from '../orders/entities/order-group.entity';
import { StoreOrder } from '../orders/entities/store-order.entity';
import { StoreOrderItem } from '../orders/entities/store-order-item.entity';
import { StoreOrderEvent } from '../orders/entities/store-order-event.entity';
import { CouponRedemption } from '../coupons/entities/coupon-redemption.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { newGroupCode, storeOrderCode } from '../orders/order-codes';
import { OrderViewsService } from '../orders/order-views.service';

/**
 * A seam for tests to fail checkout at its riskiest point — after stock has
 * been decremented — and prove the transaction leaves nothing behind. The
 * real provider does nothing; there is no debug route anywhere.
 */
export const CHECKOUT_FAULT_INJECTOR = 'CHECKOUT_FAULT_INJECTOR';
export interface CheckoutFaultInjector {
  afterStockDecrement(m: EntityManager): Promise<void> | void;
}
export const noCheckoutFaults: CheckoutFaultInjector = {
  afterStockDecrement: () => undefined,
};

/** How long a customer has to pay a transfer order. */
export const TRANSFER_WINDOW_MS = 24 * 60 * 60 * 1000;

const STATUS_FOR: Record<string, HttpStatus> = {
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.OUT_OF_STOCK]: HttpStatus.CONFLICT,
  [ErrorCode.STORE_UNAVAILABLE]: HttpStatus.CONFLICT,
  [ErrorCode.COUPON_LIMIT_REACHED]: HttpStatus.CONFLICT,
};

/** The first problem as the error, every problem in details. */
function planError(plan: CheckoutPlan): HttpException {
  const all = [...plan.issues, ...plan.stores.flatMap((s) => s.issues)];
  const first = all[0];
  return new HttpException(
    {
      code: first.code,
      message: first.message,
      details: {
        ...first.details,
        issues: plan.issues,
        stores: plan.stores
          .filter((s) => s.issues.length)
          .map((s) => ({ storeId: s.store.id, issues: s.issues })),
      },
    },
    STATUS_FOR[first.code] ?? HttpStatus.BAD_REQUEST,
  );
}

const snapshotAddress = (
  a: NonNullable<CheckoutPlan['address']>,
): AddressSnapshot => ({
  label: a.label,
  fullName: a.fullName,
  phone: a.phone,
  city: a.city,
  area: a.area,
  line1: a.line1,
  landmark: a.landmark ?? null,
  lat: a.lat ?? null,
  lng: a.lng ?? null,
});

/**
 * Checkout (spec §4) — ONE Postgres transaction:
 *   lock the cart row, then the variant rows FOR UPDATE in id order →
 *   validate and price everything (CheckoutPlanner, the same code preview
 *   runs) → claim coupon uses with a conditional UPDATE → write the group,
 *   store orders, snapshotted lines, `placed` events and redemptions →
 *   decrement stock with movements → clear the cart → commit.
 * Any failure rolls all of it back; nothing needs compensating. People are
 * notified only after the commit.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly planner: CheckoutPlanner,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
    private readonly views: OrderViewsService,
    @Inject(CHECKOUT_FAULT_INJECTOR)
    private readonly faults: CheckoutFaultInjector,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const placed = await this.dataSource.transaction(async (m) => {
      const now = new Date();
      const plan = await this.planner.plan(m, userId, dto, { lock: true, now });
      if (!plan.ok) throw planError(plan);

      for (const s of plan.stores) if (s.coupon) await this.claimCoupon(m, s);

      const group = await this.insertGroup(m, userId, plan, now);
      const orders: Array<{ order: StoreOrder; plan: StorePlan }> = [];
      for (const [i, s] of plan.stores.entries()) {
        const order = await this.insertStoreOrder(
          m,
          userId,
          group,
          s,
          i + 1,
          now,
        );
        orders.push({ order, plan: s });
      }
      await this.faults.afterStockDecrement(m);
      await m.delete(CartItem, { cartId: plan.cartId! });
      return { group, orders };
    });

    await this.notifyPlaced(userId, placed.group, placed.orders);
    return this.views.customerGroup(userId, placed.group.code);
  }

  /** Take one use of the coupon — atomically, so the last use goes to one checkout only. */
  private async claimCoupon(m: EntityManager, s: StorePlan) {
    const [, claimed] = await m.query(
      `UPDATE coupons SET used_count = used_count + 1, updated_at = now()
        WHERE id = $1 AND is_active AND (usage_limit IS NULL OR used_count < usage_limit)`,
      [s.coupon!.id],
    );
    if (claimed !== 1) {
      throw new ConflictException({
        code: ErrorCode.COUPON_LIMIT_REACHED,
        message: `"${s.coupon!.code}" has just been used up.`,
        details: { storeId: s.store.id, code: s.coupon!.code, scope: 'coupon' },
      });
    }
  }

  private async insertGroup(
    m: EntityManager,
    userId: string,
    plan: CheckoutPlan,
    now: Date,
  ): Promise<OrderGroup> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newGroupCode();
      // ON CONFLICT DO NOTHING: a code collision leaves the transaction usable.
      const res = await m
        .createQueryBuilder()
        .insert()
        .into(OrderGroup)
        .values({
          userId,
          code,
          addressSnapshot: snapshotAddress(plan.address!),
          itemsTotal: plan.totals.itemsTotal,
          discountTotal: plan.totals.discountTotal,
          shippingTotal: plan.totals.shippingTotal,
          grandTotal: plan.totals.grandTotal,
          placedAt: now,
        })
        .orIgnore()
        .returning('id')
        .execute();
      if (res.raw.length)
        return m.findOneByOrFail(OrderGroup, { id: res.raw[0].id });
    }
    throw new Error('Could not allocate an order code after 5 attempts');
  }

  private async insertStoreOrder(
    m: EntityManager,
    userId: string,
    group: OrderGroup,
    s: StorePlan,
    n: number,
    now: Date,
  ): Promise<StoreOrder> {
    const transfer = s.paymentMethod === 'transfer';
    const order = await m.save(
      m.create(StoreOrder, {
        groupId: group.id,
        storeId: s.store.id,
        userId,
        code: storeOrderCode(group.code, n),
        status: 'placed',
        paymentMethod: s.paymentMethod,
        paymentStatus: transfer ? 'awaiting_transfer' : 'cod_pending',
        paymentAccountSnapshot: transfer
          ? s.accounts.map((a) => ({
              kind: a.kind,
              accountTitle: a.accountTitle,
              accountNumber: a.accountNumber,
              bankName: a.bankName,
            }))
          : null,
        payBy: transfer ? new Date(now.getTime() + TRANSFER_WINDOW_MS) : null,
        subtotal: s.subtotal,
        discount: s.discount,
        couponCode: s.coupon?.code ?? null,
        shippingFee: s.shippingFee,
        total: s.total,
        returnWindowDays: s.store.returnWindowDays,
        customerNote: s.note,
      }),
    );
    await m.insert(
      StoreOrderItem,
      s.lines.map((l) => ({
        storeOrderId: order.id,
        productId: l.productId,
        variantId: l.variantId,
        productName: l.productName,
        variantLabel: l.variantLabel,
        imageUrl: l.imageUrl,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.unitPrice * l.quantity,
      })),
    );
    // The rows are already locked by the plan; this re-checks and decrements.
    await this.inventory.apply(
      m,
      s.lines.map((l) => ({ variantId: l.variantId, delta: -l.quantity })),
      {
        reason: 'order',
        refType: 'store_order',
        refId: order.id,
        actorUserId: userId,
      },
      {
        onShortfall: (lines) =>
          new ConflictException({
            code: ErrorCode.OUT_OF_STOCK,
            message: 'Some items just sold out.',
            details: { storeId: s.store.id, lines },
          }),
      },
    );
    for (const l of s.lines) {
      await m.query(
        `UPDATE products SET sold_count = sold_count + $2 WHERE id = $1`,
        [l.productId, l.quantity],
      );
    }
    await m.insert(StoreOrderEvent, {
      storeOrderId: order.id,
      kind: 'status',
      from: null,
      to: 'placed',
      actorRole: 'customer',
      actorUserId: userId,
      note: null,
    });
    if (s.coupon) {
      await m.insert(CouponRedemption, {
        couponId: s.coupon.id,
        userId,
        storeOrderId: order.id,
        discount: s.discount,
      });
    }
    return order;
  }

  private async notifyPlaced(
    userId: string,
    group: OrderGroup,
    orders: Array<{ order: StoreOrder; plan: StorePlan }>,
  ) {
    try {
      for (const { order, plan } of orders) {
        await this.notifications.notify(plan.store.ownerUserId, {
          type: 'shop.order.new',
          title: `New order ${order.code}`,
          body: `${plan.lines.reduce((n, l) => n + l.quantity, 0)} item(s) · Rs ${order.total} · ${
            order.paymentMethod === 'cod'
              ? 'cash on delivery'
              : 'bank/wallet transfer'
          }`,
          data: { storeOrderId: order.id, code: order.code },
        });
      }
      await this.notifications.notify(userId, {
        type: 'shop.order.placed',
        title: `Order ${group.code} placed`,
        body:
          orders.length > 1
            ? `${orders.length} stores have your order · Rs ${group.grandTotal}`
            : `Rs ${group.grandTotal}`,
        data: { groupCode: group.code },
      });
    } catch (err) {
      // The order is committed; a failed notification must not turn it into an error.
      this.logger.warn(
        `Order ${group.code}: notification failed: ${(err as Error).message}`,
      );
    }
  }
}
