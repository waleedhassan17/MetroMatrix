import {
  couponDiscount,
  groupTotals,
  shippingFee,
  storeTotals,
} from './pricing';

describe('shopping pricing', () => {
  const policy = { shippingFlatFee: 250, freeShippingOver: 5000 };

  it('percent coupons round down and respect max_discount and the subtotal', () => {
    expect(
      couponDiscount({ type: 'percent', value: 15, maxDiscount: null }, 3333),
    ).toBe(499); // 499.95
    expect(
      couponDiscount({ type: 'percent', value: 50, maxDiscount: 300 }, 1000),
    ).toBe(300);
    expect(
      couponDiscount({ type: 'fixed', value: 800, maxDiscount: null }, 500),
    ).toBe(500);
    expect(
      couponDiscount({ type: 'percent', value: 100, maxDiscount: null }, 1999),
    ).toBe(1999);
  });

  it('free shipping is judged on subtotal minus discount', () => {
    expect(shippingFee(policy, 5000)).toBe(0);
    expect(shippingFee(policy, 4999)).toBe(250);
    expect(
      shippingFee({ shippingFlatFee: 0, freeShippingOver: null }, 10),
    ).toBe(0);

    const t = storeTotals([{ unitPrice: 2600, quantity: 2 }], policy, {
      type: 'fixed',
      value: 300,
      maxDiscount: null,
    });
    // 5200 − 300 = 4900 < 5000 → shipping charged.
    expect(t).toEqual({
      subtotal: 5200,
      discount: 300,
      shippingFee: 250,
      total: 5150,
    });
  });

  it('a group is exactly the sum of its stores', () => {
    const stores = [
      storeTotals([{ unitPrice: 1299, quantity: 3 }], policy, {
        type: 'percent',
        value: 7,
        maxDiscount: null,
      }),
      storeTotals([{ unitPrice: 5100, quantity: 1 }], policy, null),
      storeTotals(
        [
          { unitPrice: 333, quantity: 7 },
          { unitPrice: 1, quantity: 1 },
        ],
        { shippingFlatFee: 99, freeShippingOver: null },
        null,
      ),
    ];
    const g = groupTotals(stores);
    expect(g.grandTotal).toBe(stores.reduce((n, s) => n + s.total, 0));
    expect(g.grandTotal).toBe(g.itemsTotal - g.discountTotal + g.shippingTotal);
    stores.forEach((s) =>
      expect(s.total).toBe(s.subtotal - s.discount + s.shippingFee),
    );
  });

  it('refuses non-integer money', () => {
    expect(() =>
      storeTotals([{ unitPrice: 10.5, quantity: 1 }], policy, null),
    ).toThrow(/whole number/);
  });
});
