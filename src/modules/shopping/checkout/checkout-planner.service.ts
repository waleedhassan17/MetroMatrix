import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { Address } from '../../addresses/entities/address.entity';
import { StorePaymentAccount } from '../stores/entities/store-payment-account.entity';
import { Coupon } from '../coupons/entities/coupon.entity';
import { CouponsService } from '../coupons/coupons.service';
import {
  CartLine,
  CartStore,
  deliversTo,
  groupByStore,
  loadCartLines,
} from '../cart/cart-lines';
import { CartService } from '../cart/cart.service';
import { CheckoutDto, PaymentMethod } from './dto/checkout.dto';
import { GroupTotals, StoreTotals, groupTotals, storeTotals } from './pricing';

export interface PlanIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface StorePlan extends StoreTotals {
  store: CartStore;
  paymentMethod: PaymentMethod;
  couponCode: string | null;
  coupon: Coupon | null;
  note: string | null;
  lines: CartLine[];
  /** Active accounts, loaded for transfer orders (snapshotted by checkout). */
  accounts: StorePaymentAccount[];
  issues: PlanIssue[];
  warnings: PlanIssue[];
}

export interface CheckoutPlan {
  ok: boolean;
  cartId: string | null;
  address: Address | null;
  issues: PlanIssue[];
  stores: StorePlan[];
  totals: GroupTotals;
}

const issue = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): PlanIssue => (details ? { code, message, details } : { code, message });

/**
 * Validates and prices a checkout without writing anything. Preview calls it
 * as-is; checkout calls it with `lock: true` inside its transaction and then
 * writes exactly what the plan says — so the two can never disagree.
 */
@Injectable()
export class CheckoutPlanner {
  constructor(
    private readonly cart: CartService,
    private readonly coupons: CouponsService,
  ) {}

  async plan(
    m: EntityManager,
    userId: string,
    input: CheckoutDto,
    opts: { lock?: boolean; now?: Date } = {},
  ): Promise<CheckoutPlan> {
    const now = opts.now ?? new Date();
    const issues: PlanIssue[] = [];

    const cartId = opts.lock
      ? await this.cart.lockCart(m, userId)
      : await this.cart.cartIdOf(m, userId);
    const lines = cartId
      ? await loadCartLines(m, cartId, { lock: opts.lock })
      : [];
    if (!lines.length)
      issues.push(issue(ErrorCode.CART_EMPTY, 'Your cart is empty.'));

    const address = await m.findOne(Address, {
      where: { id: input.addressId, userId },
    });
    if (!address) issues.push(issue(ErrorCode.NOT_FOUND, 'Address not found.'));

    const groups = groupByStore(lines);
    const inCart = new Set(groups.map((g) => g.store.id));
    const asked = input.stores.map((s) => s.storeId);
    const missing = [...inCart].filter((id) => !asked.includes(id));
    const unexpected = asked.filter((id) => !inCart.has(id));
    const repeated = asked.filter((id, i) => asked.indexOf(id) !== i);
    if (
      lines.length &&
      (missing.length || unexpected.length || repeated.length)
    ) {
      issues.push(
        issue(
          ErrorCode.CHECKOUT_MISMATCH,
          'Your cart changed — choose a payment method for each store in it.',
          { missing, unexpected: [...new Set([...unexpected, ...repeated])] },
        ),
      );
    }

    const stores: StorePlan[] = [];
    for (const g of groups) {
      const choice = input.stores.find((s) => s.storeId === g.store.id);
      if (!choice) continue;
      stores.push(
        await this.planStore(m, userId, g.store, g.lines, choice, address, now),
      );
    }
    const totals = groupTotals(stores);
    const ok = !issues.length && stores.every((s) => !s.issues.length);
    return { ok, cartId, address, issues, stores, totals };
  }

  private async planStore(
    m: EntityManager,
    userId: string,
    store: CartStore,
    lines: CartLine[],
    choice: CheckoutDto['stores'][number],
    address: Address | null,
    now: Date,
  ): Promise<StorePlan> {
    const issues: PlanIssue[] = [];
    const warnings: PlanIssue[] = [];

    if (!store.isOpen) {
      issues.push(
        issue(
          ErrorCode.STORE_UNAVAILABLE,
          store.pauseMessage || `${store.name} isn't taking orders right now.`,
          { storeId: store.id },
        ),
      );
    }
    if (address && !deliversTo(store, address.city)) {
      issues.push(
        issue(
          ErrorCode.DELIVERY_UNAVAILABLE,
          `${store.name} doesn't deliver to ${address.city}.`,
          {
            storeId: store.id,
            city: address.city,
            deliveryCities: store.deliveryCities,
          },
        ),
      );
    }

    const short = lines
      .filter((l) => !l.isAvailable || l.stock < l.quantity)
      .map((l) => ({
        cartItemId: l.cartItemId,
        variantId: l.variantId,
        productName: l.productName,
        variantLabel: l.variantLabel,
        requested: l.quantity,
        available: l.isAvailable ? l.stock : 0,
      }));
    if (short.length) {
      issues.push(
        issue(
          ErrorCode.OUT_OF_STOCK,
          short.length === 1
            ? `${short[0].productName} (${short[0].variantLabel}) — only ${short[0].available} left.`
            : `${short.length} items don't have enough stock.`,
          { storeId: store.id, lines: short },
        ),
      );
    }
    const changed = lines.filter((l) => l.unitPrice !== l.priceAtAdd);
    if (changed.length) {
      warnings.push(
        issue(
          ErrorCode.PRICE_CHANGED,
          'Some prices changed since you added them.',
          {
            lines: changed.map((l) => ({
              cartItemId: l.cartItemId,
              variantId: l.variantId,
              was: l.priceAtAdd,
              now: l.unitPrice,
            })),
          },
        ),
      );
    }

    const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    const couponCode = choice.couponCode
      ? choice.couponCode.trim().toUpperCase()
      : null;
    let coupon: Coupon | null = null;
    if (couponCode) {
      const check = await this.coupons.evaluate(
        m,
        store.id,
        couponCode,
        userId,
        subtotal,
        now,
      );
      if (check.ok) coupon = check.coupon;
      else
        issues.push({
          ...check.issue,
          details: { storeId: store.id, ...check.issue.details },
        });
    }
    const totals = storeTotals(
      lines,
      {
        shippingFlatFee: store.shippingFlatFee,
        freeShippingOver: store.freeShippingOver,
      },
      coupon,
    );

    let accounts: StorePaymentAccount[] = [];
    if (choice.paymentMethod === 'cod') {
      if (!store.codEnabled) {
        issues.push(
          issue(
            ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
            `${store.name} doesn't take cash on delivery.`,
            {
              storeId: store.id,
              paymentMethod: 'cod',
            },
          ),
        );
      } else if (totals.total > store.codLimit) {
        issues.push(
          issue(
            ErrorCode.COD_LIMIT_EXCEEDED,
            `Cash on delivery at ${store.name} is limited to Rs ${store.codLimit}; pay by transfer instead.`,
            {
              storeId: store.id,
              codLimit: store.codLimit,
              total: totals.total,
            },
          ),
        );
      }
    } else {
      accounts = await m.find(StorePaymentAccount, {
        where: { storeId: store.id, isActive: true },
        order: { createdAt: 'ASC' },
      });
      if (!accounts.length) {
        issues.push(
          issue(
            ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
            `${store.name} hasn't set up transfer payments.`,
            {
              storeId: store.id,
              paymentMethod: 'transfer',
            },
          ),
        );
      }
    }

    return {
      store,
      paymentMethod: choice.paymentMethod,
      couponCode,
      coupon,
      note: choice.note ?? null,
      lines,
      accounts,
      issues,
      warnings,
      ...totals,
    };
  }
}

/** The public shape of a plan (preview). Never includes account numbers. */
export function planView(plan: CheckoutPlan) {
  return {
    ok: plan.ok,
    issues: plan.issues,
    stores: plan.stores.map((s) => ({
      storeId: s.store.id,
      storeSlug: s.store.slug,
      storeName: s.store.name,
      paymentMethod: s.paymentMethod,
      couponCode: s.couponCode,
      items: s.lines.map((l) => ({
        cartItemId: l.cartItemId,
        variantId: l.variantId,
        productId: l.productId,
        productName: l.productName,
        variantLabel: l.variantLabel,
        imageUrl: l.imageUrl,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.unitPrice * l.quantity,
      })),
      subtotal: s.subtotal,
      discount: s.discount,
      shippingFee: s.shippingFee,
      total: s.total,
      transferVia: [...new Set(s.accounts.map((a) => a.kind))],
      issues: s.issues,
      warnings: s.warnings,
    })),
    totals: plan.totals,
  };
}
