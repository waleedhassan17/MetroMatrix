import { ErrorCode } from '../../../common/errors/codes';
import {
  localDate,
  localMinutes,
  weekdayOf,
} from '../../../common/time/time.util';
import { inWindow, onDay } from '../menu/item-pricing';
import type { PromotionKind } from './entities/food-promotion.entity';

/** The fields of a promotion the rules read. */
export interface PromotionRule {
  id: string;
  title: string;
  kind: PromotionKind;
  value: number;
  itemIds: string[];
  minOrder: number;
  maxDiscount: number | null;
  code: string | null;
  startsAt: Date;
  endsAt: Date | null;
  weekdaysMask: number;
  timeFrom: string | null;
  timeTo: string | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  usedCount: number;
  firstOrderOnly: boolean;
  isActive: boolean;
}

export interface PromotionContext {
  now: Date;
  tz: string;
  subtotal: number;
  lines: Array<{ itemId: string; lineTotal: number }>;
  deliveryFee: number;
  /** This customer's live orders that used each promotion. */
  userUses: Map<string, number>;
  /** No earlier (non-cancelled) order from this vendor. */
  isFirstOrder: boolean;
  /** Signed out: per-user and first-order rules can't be judged, so those deals don't apply. */
  signedIn: boolean;
}

export interface PromotionIssue {
  code: string;
  message: string;
}

export interface AppliedPromotion {
  promotion: PromotionRule;
  discount: number;
}

/** Inside its dates, weekdays and daily window at `now` (branch time). */
export function isLive(p: PromotionRule, now: Date, tz: string): boolean {
  if (!p.isActive || p.startsAt > now) return false;
  if (p.endsAt && p.endsAt <= now) return false;
  if (!onDay(p.weekdaysMask, weekdayOf(localDate(now, tz)))) return false;
  return inWindow(p.timeFrom, p.timeTo, localMinutes(now, tz));
}

/** Why this promotion can't be used on this order, or null when it can. */
export function promotionIssue(
  p: PromotionRule,
  ctx: PromotionContext,
): PromotionIssue | null {
  const name = p.code ? `“${p.code}”` : p.title;
  if (!p.isActive || p.startsAt > ctx.now)
    return { code: ErrorCode.PROMO_INVALID, message: `${name} isn’t on yet.` };
  if (p.endsAt && p.endsAt <= ctx.now)
    return { code: ErrorCode.PROMO_EXPIRED, message: `${name} has ended.` };
  if (!isLive(p, ctx.now, ctx.tz))
    return {
      code: ErrorCode.PROMO_INVALID,
      message: `${name} isn’t valid at this time.`,
    };
  if (p.usageLimit !== null && p.usedCount >= p.usageLimit)
    return {
      code: ErrorCode.PROMO_LIMIT_REACHED,
      message: `${name} has been fully used.`,
    };
  if (p.perUserLimit !== null || p.firstOrderOnly) {
    if (!ctx.signedIn)
      return {
        code: ErrorCode.PROMO_INVALID,
        message: `Sign in to use ${name}.`,
      };
  }
  if (
    p.perUserLimit !== null &&
    (ctx.userUses.get(p.id) ?? 0) >= p.perUserLimit
  )
    return {
      code: ErrorCode.PROMO_LIMIT_REACHED,
      message: `You’ve already used ${name}.`,
    };
  if (p.firstOrderOnly && !ctx.isFirstOrder)
    return {
      code: ErrorCode.PROMO_INVALID,
      message: `${name} is for your first order from this vendor.`,
    };
  if (ctx.subtotal < p.minOrder)
    return {
      code: ErrorCode.PROMO_INVALID,
      message: `${name} needs an order of Rs ${p.minOrder} or more.`,
    };
  if (discountOf(p, ctx) <= 0)
    return {
      code: ErrorCode.PROMO_INVALID,
      message: `${name} doesn’t apply to this order.`,
    };
  return null;
}

/** The discount in whole rupees, rounded down, never more than the order (or the delivery fee). */
export function discountOf(p: PromotionRule, ctx: PromotionContext): number {
  const cap = (n: number) =>
    Math.max(
      0,
      Math.min(
        n,
        p.maxDiscount ?? Number.MAX_SAFE_INTEGER,
        p.kind === 'free_delivery' ? ctx.deliveryFee : ctx.subtotal,
      ),
    );
  switch (p.kind) {
    case 'percent_off_order':
      return cap(Math.floor((ctx.subtotal * p.value) / 100));
    case 'percent_off_items': {
      const base = ctx.lines
        .filter((l) => p.itemIds.includes(l.itemId))
        .reduce((s, l) => s + l.lineTotal, 0);
      return cap(Math.floor((base * p.value) / 100));
    }
    case 'flat_off':
      return cap(p.value);
    case 'free_delivery':
      return cap(ctx.deliveryFee);
  }
}

/**
 * One promotion per order — the best for the customer. Automatic deals
 * always compete; a coded one only when its code was given. A code that
 * can't be used is reported (the order may still get an automatic deal).
 */
export function bestPromotion(
  promotions: PromotionRule[],
  ctx: PromotionContext,
  code?: string | null,
): { applied: AppliedPromotion | null; codeIssue: PromotionIssue | null } {
  const wanted = code?.trim().toLowerCase() || null;
  let codeIssue: PromotionIssue | null = null;
  const candidates: PromotionRule[] = [];
  for (const p of promotions) {
    if (p.code === null) candidates.push(p);
    else if (wanted && p.code.toLowerCase() === wanted) {
      codeIssue = promotionIssue(p, ctx);
      if (!codeIssue) candidates.push(p);
    }
  }
  if (wanted && !codeIssue && !candidates.some((p) => p.code !== null))
    codeIssue = {
      code: ErrorCode.PROMO_INVALID,
      message: `“${code!.trim()}” isn’t a code for this vendor.`,
    };
  let best: AppliedPromotion | null = null;
  for (const p of candidates) {
    if (p.code === null && promotionIssue(p, ctx)) continue;
    const discount = discountOf(p, ctx);
    if (
      discount > 0 &&
      (!best ||
        discount > best.discount ||
        // A tie goes to the code the customer typed.
        (discount === best.discount && p.code !== null && !best.promotion.code))
    )
      best = { promotion: p, discount };
  }
  return { applied: best, codeIssue };
}

/** The short label on a vendor card. */
export function dealLabel(p: PromotionRule): string {
  const over =
    p.minOrder > 0 ? ` over Rs ${p.minOrder.toLocaleString('en-PK')}` : '';
  switch (p.kind) {
    case 'percent_off_order':
      return `${p.value}% off${over}`;
    case 'percent_off_items':
      return `${p.value}% off selected items`;
    case 'flat_off':
      return `Rs ${p.value.toLocaleString('en-PK')} off${over}`;
    case 'free_delivery':
      return `Free delivery${over}`;
  }
}

/** Which deal leads on a card: percent, then flat, then free delivery; bigger first. */
export function dealRank(a: PromotionRule, b: PromotionRule): number {
  const order: Record<PromotionKind, number> = {
    percent_off_order: 0,
    percent_off_items: 1,
    flat_off: 2,
    free_delivery: 3,
  };
  return (
    order[a.kind] - order[b.kind] ||
    b.value - a.value ||
    a.id.localeCompare(b.id)
  );
}
