import {
  PromotionContext,
  PromotionRule,
  bestPromotion,
  dealLabel,
  discountOf,
  isLive,
  promotionIssue,
} from './best-promotion';

const TZ = 'Asia/Karachi';
// Friday 2026-10-16 15:00 PKT.
const NOW = new Date('2026-10-16T10:00:00Z');

const promo = (p: Partial<PromotionRule>): PromotionRule => ({
  id: p.id ?? 'p1',
  title: 'Deal',
  kind: 'percent_off_order',
  value: 10,
  itemIds: [],
  minOrder: 0,
  maxDiscount: null,
  code: null,
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: null,
  weekdaysMask: 127,
  timeFrom: null,
  timeTo: null,
  usageLimit: null,
  perUserLimit: null,
  usedCount: 0,
  firstOrderOnly: false,
  isActive: true,
  ...p,
});

const ctx = (c: Partial<PromotionContext> = {}): PromotionContext => ({
  now: NOW,
  tz: TZ,
  subtotal: 1999,
  lines: [
    { itemId: 'karahi', lineTotal: 1600 },
    { itemId: 'naan', lineTotal: 399 },
  ],
  deliveryFee: 99,
  userUses: new Map(),
  isFirstOrder: true,
  signedIn: true,
  ...c,
});

describe('best-promotion', () => {
  it('percent discounts round down; caps and the subtotal bound the discount', () => {
    expect(discountOf(promo({ value: 15 }), ctx())).toBe(299); // 299.85
    expect(discountOf(promo({ value: 50, maxDiscount: 400 }), ctx())).toBe(400);
    expect(discountOf(promo({ kind: 'flat_off', value: 5000 }), ctx())).toBe(
      1999,
    );
    expect(
      discountOf(
        promo({ kind: 'percent_off_items', value: 25, itemIds: ['naan'] }),
        ctx(),
      ),
    ).toBe(99); // 99.75
    expect(discountOf(promo({ kind: 'free_delivery' }), ctx())).toBe(99);
    expect(
      discountOf(promo({ kind: 'free_delivery' }), ctx({ deliveryFee: 0 })),
    ).toBe(0);
  });

  it('picks the best deal for the customer', () => {
    const { applied } = bestPromotion(
      [
        promo({ id: 'pct', value: 10 }), // 199
        promo({ id: 'flat', kind: 'flat_off', value: 250 }), // 250
        promo({ id: 'free', kind: 'free_delivery' }), // 99
      ],
      ctx(),
    );
    expect(applied).toMatchObject({ promotion: { id: 'flat' }, discount: 250 });
  });

  it('a happy-hour deal outside its window is not applied (QA #8)', () => {
    const happy = promo({
      id: 'hh',
      value: 20,
      timeFrom: '17:00',
      timeTo: '19:00',
    });
    expect(isLive(happy, NOW, TZ)).toBe(false);
    expect(bestPromotion([happy], ctx()).applied).toBeNull();
    const at6 = new Date('2026-10-16T13:00:00Z'); // 18:00 PKT
    expect(bestPromotion([happy], ctx({ now: at6 })).applied?.discount).toBe(
      399,
    );
  });

  it('weekday mask, dates, limits, first order and minimum', () => {
    const notFriday = promo({ weekdaysMask: 0b0011111 }); // Sun–Thu
    expect(promotionIssue(notFriday, ctx())?.code).toBe('PROMO_INVALID');
    expect(
      promotionIssue(promo({ endsAt: new Date('2026-10-01T00:00:00Z') }), ctx())
        ?.code,
    ).toBe('PROMO_EXPIRED');
    expect(
      promotionIssue(promo({ usageLimit: 5, usedCount: 5 }), ctx())?.code,
    ).toBe('PROMO_LIMIT_REACHED');
    expect(
      promotionIssue(
        promo({ id: 'u', perUserLimit: 1 }),
        ctx({ userUses: new Map([['u', 1]]) }),
      )?.code,
    ).toBe('PROMO_LIMIT_REACHED');
    expect(
      promotionIssue(
        promo({ firstOrderOnly: true }),
        ctx({ isFirstOrder: false }),
      )?.code,
    ).toBe('PROMO_INVALID');
    expect(promotionIssue(promo({ minOrder: 2000 }), ctx())?.message).toMatch(
      /Rs 2000/,
    );
    expect(
      promotionIssue(promo({ firstOrderOnly: true }), ctx({ signedIn: false }))
        ?.message,
    ).toMatch(/Sign in/);
  });

  it('codes: only when typed; unknown or unusable codes are reported', () => {
    const coded = promo({ id: 'c', code: 'KARAHI20', value: 20 });
    expect(bestPromotion([coded], ctx()).applied).toBeNull();
    expect(bestPromotion([coded], ctx(), 'karahi20').applied?.discount).toBe(
      399,
    );
    expect(bestPromotion([coded], ctx(), 'NOPE').codeIssue?.code).toBe(
      'PROMO_INVALID',
    );
    const used = promo({ id: 'c', code: 'ONCE', usageLimit: 1, usedCount: 1 });
    const res = bestPromotion(
      [used, promo({ id: 'auto', value: 5 })],
      ctx(),
      'ONCE',
    );
    expect(res.codeIssue?.code).toBe('PROMO_LIMIT_REACHED');
    expect(res.applied?.promotion.id).toBe('auto');
    // A tie goes to the typed code.
    const tie = bestPromotion(
      [
        promo({ id: 'auto', value: 10 }),
        promo({ id: 'c', code: 'TEN', value: 10 }),
      ],
      ctx(),
      'TEN',
    );
    expect(tie.applied?.promotion.id).toBe('c');
  });

  it('card labels', () => {
    expect(dealLabel(promo({ value: 20 }))).toBe('20% off');
    expect(
      dealLabel(promo({ kind: 'flat_off', value: 150, minOrder: 1000 })),
    ).toBe('Rs 150 off over Rs 1,000');
    expect(dealLabel(promo({ kind: 'free_delivery' }))).toBe('Free delivery');
  });
});
