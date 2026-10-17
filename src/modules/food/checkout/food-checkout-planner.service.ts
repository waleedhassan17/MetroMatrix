import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import {
  formatTime12,
  localDate,
  shortDateLabel,
} from '../../../common/time/time.util';
import { Address } from '../../addresses/entities/address.entity';
import { FoodCart } from '../cart/entities/food-cart.entity';
import { FoodCartItem } from '../cart/entities/food-cart-item.entity';
import { MenuReadService } from '../menu/menu-read.service';
import {
  LineError,
  PricedChoice,
  priceChoice,
  unavailableReason,
} from '../menu/item-pricing';
import { BranchStateService } from '../availability/branch-state.service';
import {
  BranchRow,
  Quote,
  ServiceabilityService,
} from '../availability/serviceability.service';
import { VISIBLE_VENDOR_SQL } from '../discovery/discovery.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PromotionRule, bestPromotion } from '../promotions/best-promotion';
import { VendorSettingsService } from '../vendor/vendor-settings.service';
import { FoodScheduleService, SlotChoice } from './food-schedule.service';
import type { FoodPaymentMethod, Fulfilment } from '../common/food-types';

export interface PlanIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PlannedLine {
  id: string;
  itemId: string;
  name: string;
  photoUrl: string | null;
  variant: { id: string; name: string } | null;
  options: PricedChoice['options'];
  optionIds: string[];
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
  priceChanged: boolean;
  /** Draws on today's portions. */
  portioned: boolean;
  error: PlanIssue | null;
}

export interface PlanInput {
  addressId?: string;
  promoCode?: string | null;
  paymentMethod?: FoodPaymentMethod;
}

export interface FoodPlan {
  ok: boolean;
  /** Blocking problems, the first one first. */
  issues: PlanIssue[];
  /** Worth telling the customer, never blocking. */
  warnings: PlanIssue[];
  cart: Pick<
    FoodCart,
    'id' | 'brandId' | 'branchId' | 'fulfilment' | 'scheduledFor'
  > | null;
  vendor: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    businessId: string;
  } | null;
  branch: BranchRow | null;
  quote: Quote | null;
  address: Address | null;
  lines: PlannedLine[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  minOrder: number;
  shortfall: number;
  promotion: (PromotionRule & { discount: number }) | null;
  paymentMethod: FoodPaymentMethod | null;
  paymentMethods: Record<FoodPaymentMethod, boolean>;
  accounts: Array<{
    kind: string;
    accountTitle: string;
    accountNumber: string;
    bankName: string | null;
  }>;
  slot: SlotChoice | null;
  /** Portions come from today's count (ASAP, or scheduled for later today). */
  forToday: boolean;
  scheduledLabel: string | null;
}

const issue = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): PlanIssue => (details ? { code, message, details } : { code, message });

const REASON_TEXT: Record<string, (name: string, later: boolean) => string> = {
  not_on_menu: (n) => `${n} is no longer on the menu.`,
  unavailable: (n, later) =>
    `${n} isn’t available ${later ? 'at that time' : 'right now'}.`,
  not_today: (n, later) =>
    `${n} isn’t on the menu ${later ? 'that day' : 'today'}.`,
  outside_hours: (n, later) =>
    `${n} isn’t served ${later ? 'at that time' : 'at this time of day'}.`,
  sold_out: (n) => `${n} is sold out today.`,
};

/**
 * Validates and prices the customer's cart without writing anything. The
 * cart view, preview and checkout all call it — checkout with `lock: true`
 * inside its transaction — so what the customer was shown is what they are
 * charged. Prices come from the menu, never from the client.
 */
@Injectable()
export class FoodCheckoutPlanner {
  constructor(
    private readonly menu: MenuReadService,
    private readonly state: BranchStateService,
    private readonly serviceability: ServiceabilityService,
    private readonly promotions: PromotionsService,
    private readonly settings: VendorSettingsService,
    private readonly schedule: FoodScheduleService,
  ) {}

  async plan(
    m: EntityManager,
    userId: string,
    input: PlanInput,
    opts: { lock?: boolean; now?: Date; defaultAddress?: boolean } = {},
  ): Promise<FoodPlan> {
    const now = opts.now ?? new Date();
    const plan: FoodPlan = {
      ok: false,
      issues: [],
      warnings: [],
      cart: null,
      vendor: null,
      branch: null,
      quote: null,
      address: null,
      lines: [],
      subtotal: 0,
      discount: 0,
      deliveryFee: 0,
      total: 0,
      minOrder: 0,
      shortfall: 0,
      promotion: null,
      paymentMethod: input.paymentMethod ?? null,
      paymentMethods: { cod: false, transfer: false, pay_at_pickup: false },
      accounts: [],
      slot: null,
      forToday: true,
      scheduledLabel: null,
    };
    const issues = plan.issues;

    const cart = await m.findOne(FoodCart, {
      where: { userId },
      ...(opts.lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    const items = cart
      ? await m.find(FoodCartItem, {
          where: { cartId: cart.id },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];
    if (!cart || !items.length) {
      issues.push(issue(ErrorCode.CART_EMPTY, 'Your cart is empty.'));
      return plan;
    }
    plan.cart = cart;

    const [vendor] = await m.query(
      `SELECT fb.id, fb.name, fb.slug, fb.logo_url, fb.business_id FROM food_brands fb
         JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
        WHERE fb.id = $1 AND ${VISIBLE_VENDOR_SQL}`,
      [cart.brandId],
    );
    if (!vendor) {
      issues.push(
        issue(ErrorCode.NOT_FOUND, 'This vendor is no longer on Food Court.'),
      );
      return plan;
    }
    plan.vendor = {
      id: vendor.id,
      name: vendor.name,
      slug: vendor.slug,
      logoUrl: vendor.logo_url,
      businessId: vendor.business_id,
    };
    const fulfilment: Fulfilment = cart.fulfilment;

    // Where it goes.
    let point: { lat: number; lng: number } | null = null;
    const addressIssues: PlanIssue[] = [];
    if (fulfilment === 'delivery') {
      let addressId = input.addressId;
      if (!addressId && opts.defaultAddress) {
        const def = await m.findOne(Address, {
          where: { userId, isDefault: true },
        });
        addressId = def?.id;
      }
      if (addressId) {
        const a = await m.findOne(Address, {
          where: { id: addressId, userId },
        });
        if (!a)
          addressIssues.push(issue(ErrorCode.NOT_FOUND, 'Address not found.'));
        else if (a.lat === null || a.lng === null)
          addressIssues.push(
            issue(
              ErrorCode.ADDRESS_LOCATION_REQUIRED,
              'Drop a pin on the map for this address so the rider can find you.',
              { addressId: a.id },
            ),
          );
        else {
          plan.address = a;
          point = { lat: a.lat, lng: a.lng };
        }
      } else
        addressIssues.push(
          issue(
            ErrorCode.ADDRESS_LOCATION_REQUIRED,
            'Choose a delivery address.',
          ),
        );
    }

    const branch = (await this.serviceability.branch(cart.branchId, point, m))!;
    plan.branch = branch;
    const schedule = (await this.state.schedules([branch.id], now, m)).get(
      branch.id,
    )!;
    const tz = branch.timezone;
    const at = cart.scheduledFor ?? now;
    const later = !!cart.scheduledFor;
    plan.forToday = localDate(at, tz) === localDate(now, tz);
    if (cart.scheduledFor)
      plan.scheduledLabel = `${shortDateLabel(localDate(at, tz))} · ${formatTime12(at, tz)}`;

    // The lines, priced from the menu.
    const snaps = await this.menu.snapshots(
      branch.id,
      [...new Set(items.map((i) => i.itemId))],
      m,
    );
    for (const it of items) {
      const s = snaps.get(it.itemId);
      const line: PlannedLine = {
        id: it.id,
        itemId: it.itemId,
        name: s?.name ?? 'Dish',
        photoUrl: s?.photoUrl ?? null,
        variant: null,
        options: [],
        optionIds: it.optionIds,
        variantId: it.variantId,
        quantity: it.quantity,
        unitPrice: it.unitPriceSeen,
        lineTotal: it.unitPriceSeen * it.quantity,
        notes: it.notes,
        priceChanged: false,
        portioned: false,
        error: null,
      };
      plan.lines.push(line);
      if (!s) {
        line.error = issue(
          ErrorCode.ITEM_UNAVAILABLE,
          'A dish in your cart is no longer on the menu.',
          { lineId: it.id, reason: 'not_on_menu' },
        );
        continue;
      }
      let reason = unavailableReason(s, tz, at, now);
      if (reason === 'sold_out' && !plan.forToday) reason = null;
      if (reason) {
        line.error = issue(
          ErrorCode.ITEM_UNAVAILABLE,
          REASON_TEXT[reason](s.name, later),
          { lineId: it.id, item: s.name, reason },
        );
        continue;
      }
      try {
        const priced = priceChoice(s, {
          variantId: it.variantId,
          optionIds: it.optionIds,
        });
        line.variant = priced.variant;
        line.options = priced.options;
        line.unitPrice = priced.unitPrice;
        line.lineTotal = priced.unitPrice * it.quantity;
        line.priceChanged = priced.unitPrice !== it.unitPriceSeen;
        line.portioned = plan.forToday && s.remainingToday !== null;
      } catch (e) {
        if (!(e instanceof LineError)) throw e;
        line.error = issue(e.code, e.message, { ...e.details, lineId: it.id });
      }
    }
    // Today's portions, across lines of the same dish.
    const wanted = new Map<string, number>();
    for (const l of plan.lines)
      if (!l.error && l.portioned)
        wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + l.quantity);
    for (const [itemId, qty] of wanted) {
      const remaining = snaps.get(itemId)!.remainingToday!;
      if (qty > remaining)
        for (const l of plan.lines.filter(
          (x) => x.itemId === itemId && !x.error,
        ))
          l.error = issue(
            ErrorCode.PORTIONS_SOLD_OUT,
            remaining === 0
              ? `${l.name} is sold out today.`
              : `Only ${remaining} ${l.name} left today.`,
            { lineId: l.id, item: l.name, remaining },
          );
    }
    for (const l of plan.lines)
      if (!l.error && l.priceChanged)
        plan.warnings.push(
          issue(
            'PRICE_CHANGED',
            `${l.name} is now Rs ${l.unitPrice.toLocaleString('en-PK')}.`,
            { lineId: l.id, unitPrice: l.unitPrice },
          ),
        );
    plan.subtotal = plan.lines
      .filter((l) => !l.error)
      .reduce((s, l) => s + l.lineTotal, 0);

    const quote = this.serviceability.quote(branch, schedule, fulfilment, {
      subtotal: plan.subtotal,
      now,
    });
    plan.quote = quote;

    // Vendor-level problems first, then address, time, lines, money.
    if (branch.is_paused)
      issues.push(
        issue(
          ErrorCode.VENDOR_PAUSED,
          branch.pause_message ||
            `${vendor.name} isn’t taking orders right now.`,
          { message: branch.pause_message },
        ),
      );
    if (fulfilment === 'delivery' && !branch.accepts_delivery)
      issues.push(
        issue(
          ErrorCode.FULFILMENT_UNAVAILABLE,
          `${vendor.name} isn’t delivering right now — switch to pickup.`,
          { fulfilment },
        ),
      );
    if (fulfilment === 'pickup' && !branch.accepts_pickup)
      issues.push(
        issue(
          ErrorCode.FULFILMENT_UNAVAILABLE,
          `${vendor.name} doesn’t offer pickup.`,
          { fulfilment },
        ),
      );
    issues.push(...addressIssues);
    if (
      fulfilment === 'delivery' &&
      branch.accepts_delivery &&
      point &&
      !quote.serviceable
    )
      issues.push(
        issue(
          ErrorCode.OUT_OF_ZONE,
          `${vendor.name} doesn’t deliver to this address.`,
          {
            distanceKm: quote.distanceKm,
            maxRadiusKm: Number(branch.max_radius_km),
          },
        ),
      );
    if (cart.scheduledFor) {
      const r = await this.schedule.check(
        m,
        branch,
        schedule,
        cart.scheduledFor,
        now,
      );
      plan.slot = r.slot;
      if (r.issue) issues.push(r.issue);
    } else if (branch.preorder_only) {
      issues.push(
        issue(
          ErrorCode.SLOT_INVALID,
          `${vendor.name} takes pre-orders only — choose a slot.`,
          { preorderOnly: true },
        ),
      );
    } else if (!quote.open.open && !branch.is_paused) {
      issues.push(
        issue(
          ErrorCode.VENDOR_CLOSED,
          `${vendor.name} is closed. ${quote.open.label} — you can schedule for later.`,
          { opensAt: quote.open.opensAt, label: quote.open.label },
        ),
      );
    }
    for (const l of plan.lines) if (l.error) issues.push(l.error);

    if (fulfilment === 'delivery' && point && quote.serviceable) {
      plan.minOrder = quote.minOrder;
      plan.shortfall = Math.max(0, quote.minOrder - plan.subtotal);
      if (plan.shortfall > 0)
        issues.push(
          issue(
            ErrorCode.BELOW_MIN_ORDER,
            `Add Rs ${plan.shortfall.toLocaleString('en-PK')} more — the minimum order here is Rs ${quote.minOrder.toLocaleString('en-PK')}.`,
            {
              minOrder: quote.minOrder,
              subtotal: plan.subtotal,
              shortfall: plan.shortfall,
            },
          ),
        );
    }
    plan.deliveryFee = fulfilment === 'delivery' ? quote.deliveryFee : 0;

    // One promotion: the best for the customer.
    const rules = await this.promotions.rulesFor(m, cart.brandId);
    if (rules.length && plan.subtotal > 0) {
      const { applied, codeIssue } = bestPromotion(
        rules,
        {
          now,
          tz,
          subtotal: plan.subtotal,
          lines: plan.lines
            .filter((l) => !l.error)
            .map((l) => ({ itemId: l.itemId, lineTotal: l.lineTotal })),
          deliveryFee: plan.deliveryFee,
          userUses: await this.promotions.userUses(
            m,
            userId,
            rules.map((r) => r.id),
          ),
          isFirstOrder: await this.promotions.isFirstOrder(
            m,
            userId,
            cart.brandId,
          ),
          signedIn: true,
        },
        input.promoCode,
      );
      if (codeIssue)
        issues.push({ ...codeIssue, details: { code: input.promoCode } });
      if (applied)
        plan.promotion = { ...applied.promotion, discount: applied.discount };
    } else if (input.promoCode) {
      issues.push(
        issue(
          ErrorCode.PROMO_INVALID,
          `“${input.promoCode}” isn’t a code for this vendor.`,
          { code: input.promoCode },
        ),
      );
    }
    plan.discount = plan.promotion?.discount ?? 0;
    plan.total = plan.subtotal - plan.discount + plan.deliveryFee;

    // How they pay — always the vendor, directly.
    plan.accounts = await this.settings.activeAccounts(m, vendor.business_id);
    plan.paymentMethods = {
      cod: fulfilment === 'delivery' && branch.accepts_cod,
      pay_at_pickup: fulfilment === 'pickup',
      transfer: plan.accounts.length > 0,
    };
    const method = input.paymentMethod;
    if (method && !plan.paymentMethods[method])
      issues.push(
        issue(
          ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
          method === 'transfer'
            ? `${vendor.name} hasn’t added an account for transfers.`
            : method === 'cod'
              ? `${vendor.name} doesn’t take cash on delivery for this order.`
              : 'Pay at pickup is for pickup orders.',
          { paymentMethod: method },
        ),
      );
    if (method === 'cod' && plan.total > branch.cod_limit)
      issues.push(
        issue(
          ErrorCode.COD_LIMIT_EXCEEDED,
          `Cash on delivery is up to Rs ${branch.cod_limit.toLocaleString('en-PK')} — pay by transfer instead.`,
          { limit: branch.cod_limit, total: plan.total },
        ),
      );

    plan.ok = issues.length === 0;
    return plan;
  }
}
