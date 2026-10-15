/**
 * The money maths for cart, preview and checkout — one pure module, so the
 * preview a customer sees and the order checkout writes cannot disagree.
 *
 * All amounts are integer rupees. Percent discounts round DOWN. A discount
 * never exceeds `max_discount` or the subtotal. Free shipping is judged on
 * what the customer pays for the goods (subtotal − discount).
 */

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface ShippingPolicy {
  shippingFlatFee: number;
  freeShippingOver: number | null;
}

export interface CouponTerms {
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount: number | null;
}

export interface StoreTotals {
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
}

export interface GroupTotals {
  itemsTotal: number;
  discountTotal: number;
  shippingTotal: number;
  grandTotal: number;
}

const rupees = (n: number, what: string): number => {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(
      `${what} must be a non-negative whole number of rupees, got ${n}`,
    );
  }
  return n;
};

export const lineTotal = (l: PricedLine): number =>
  rupees(l.unitPrice * l.quantity, 'line total');

export const subtotalOf = (lines: PricedLine[]): number =>
  lines.reduce((sum, l) => sum + lineTotal(l), 0);

/** The discount a coupon gives on this subtotal (eligibility is checked elsewhere). */
export function couponDiscount(terms: CouponTerms, subtotal: number): number {
  rupees(subtotal, 'subtotal');
  let d =
    terms.type === 'percent'
      ? Math.floor((subtotal * terms.value) / 100)
      : terms.value;
  if (terms.maxDiscount !== null) d = Math.min(d, terms.maxDiscount);
  return rupees(Math.min(d, subtotal), 'discount');
}

export function shippingFee(
  policy: ShippingPolicy,
  goodsTotal: number,
): number {
  if (
    policy.freeShippingOver !== null &&
    goodsTotal >= policy.freeShippingOver
  ) {
    return 0;
  }
  return rupees(policy.shippingFlatFee, 'shipping fee');
}

export function storeTotals(
  lines: PricedLine[],
  policy: ShippingPolicy,
  coupon: CouponTerms | null,
): StoreTotals {
  const subtotal = subtotalOf(lines);
  const discount = coupon ? couponDiscount(coupon, subtotal) : 0;
  const fee = lines.length ? shippingFee(policy, subtotal - discount) : 0;
  return {
    subtotal,
    discount,
    shippingFee: fee,
    total: rupees(subtotal - discount + fee, 'total'),
  };
}

/** The group is the plain sum of its store orders — a difference of 0 by construction. */
export function groupTotals(stores: StoreTotals[]): GroupTotals {
  const sum = (k: keyof StoreTotals) => stores.reduce((n, s) => n + s[k], 0);
  return {
    itemsTotal: sum('subtotal'),
    discountTotal: sum('discount'),
    shippingTotal: sum('shippingFee'),
    grandTotal: sum('total'),
  };
}
