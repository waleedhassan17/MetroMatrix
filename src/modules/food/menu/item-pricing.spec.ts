import {
  ItemSnapshot,
  LineError,
  daysOf,
  fromPrice,
  inWindow,
  maskOf,
  priceChoice,
  unavailableReason,
} from './item-pricing';

const TZ = 'Asia/Karachi';
const pkt = (date: string, hhmm: string) =>
  new Date(`${date}T${hhmm}:00+05:00`);

/** A zinger burger: Regular/Large; a required drink (1/1); optional extras (max 3); Large-only "Make it a meal". */
const burger = (over: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  id: 'i1',
  name: 'Zinger Burger',
  basePrice: 0,
  isActive: true,
  daysMask: 127,
  photoUrl: null,
  category: {
    id: 'c1',
    name: 'Burgers',
    isActive: true,
    availableFrom: null,
    availableTo: null,
  },
  variants: [
    { id: 'reg', name: 'Regular', price: 550 },
    { id: 'lg', name: 'Large', price: 750 },
  ],
  groups: [
    {
      id: 'g-drink',
      name: 'Your drink',
      minSelect: 1,
      maxSelect: 1,
      variantId: null,
      options: [
        {
          id: 'cola',
          name: 'Cola',
          priceDelta: 0,
          isActive: true,
          isDefault: true,
        },
        {
          id: 'lassi',
          name: 'Lassi',
          priceDelta: 80,
          isActive: true,
          isDefault: false,
        },
      ],
    },
    {
      id: 'g-extras',
      name: 'Extras',
      minSelect: 0,
      maxSelect: 3,
      variantId: null,
      options: ['cheese', 'jalapeno', 'egg', 'patty'].map((id, i) => ({
        id,
        name: id,
        priceDelta: 50 + i * 10,
        isActive: true,
        isDefault: false,
      })),
    },
    {
      id: 'g-meal',
      name: 'Make it a meal',
      minSelect: 0,
      maxSelect: 1,
      variantId: 'lg',
      options: [
        {
          id: 'fries',
          name: 'Fries',
          priceDelta: 150,
          isActive: true,
          isDefault: false,
        },
      ],
    },
  ],
  available: true,
  unavailableUntil: null,
  remainingToday: null,
  unavailableOptionIds: [],
  ...over,
});

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as LineError;
  }
  throw new Error('expected a LineError');
};

describe('item pricing and validation', () => {
  it('variant price + option deltas', () => {
    expect(
      priceChoice(burger(), {
        variantId: 'reg',
        optionIds: ['lassi', 'cheese'],
      }),
    ).toMatchObject({
      unitPrice: 550 + 80 + 50,
      variant: { name: 'Regular' },
      options: [
        { name: 'Lassi', group: 'Your drink' },
        { name: 'cheese', group: 'Extras' },
      ],
    });
    expect(
      priceChoice(burger(), { variantId: 'lg', optionIds: ['cola', 'fries'] })
        .unitPrice,
    ).toBe(900);
    expect(fromPrice(burger())).toBe(550);
  });

  it('errors name the item and the group', () => {
    expect(
      err(() => priceChoice(burger(), { variantId: 'reg' })),
    ).toMatchObject({
      code: 'OPTION_REQUIRED',
      details: { item: 'Zinger Burger', group: 'Your drink' },
    });
    expect(
      err(() =>
        priceChoice(burger(), {
          variantId: 'reg',
          optionIds: ['cola', 'cheese', 'jalapeno', 'egg', 'patty'],
        }),
      ),
    ).toMatchObject({
      code: 'OPTION_LIMIT',
      details: { group: 'Extras', max: 3 },
    });
    expect(
      err(() =>
        priceChoice(burger(), {
          variantId: 'reg',
          optionIds: ['cola', 'lassi'],
        }),
      ).code,
    ).toBe('OPTION_LIMIT');
    // A Large-only group can't be used on a Regular.
    expect(
      err(() =>
        priceChoice(burger(), {
          variantId: 'reg',
          optionIds: ['cola', 'fries'],
        }),
      ),
    ).toMatchObject({
      code: 'OPTION_INVALID',
    });
    expect(
      err(() => priceChoice(burger(), { optionIds: ['cola'] })),
    ).toMatchObject({ code: 'OPTION_REQUIRED', details: { group: 'Size' } });
    expect(
      err(() =>
        priceChoice(burger({ unavailableOptionIds: ['lassi'] }), {
          variantId: 'reg',
          optionIds: ['lassi'],
        }),
      ).message,
    ).toMatch(/run out/);
  });

  it('availability: 86, until, weekday mask, category window, portions', () => {
    const fri = pkt('2026-10-16', '13:00');
    const sat = pkt('2026-10-17', '13:00');
    expect(unavailableReason(burger(), TZ, fri)).toBeNull();
    expect(unavailableReason(burger({ available: false }), TZ, fri)).toBe(
      'unavailable',
    );
    expect(
      unavailableReason(
        burger({ unavailableUntil: pkt('2026-10-16', '14:00') }),
        TZ,
        fri,
      ),
    ).toBe('unavailable');
    expect(
      unavailableReason(
        burger({ unavailableUntil: pkt('2026-10-16', '12:00') }),
        TZ,
        fri,
      ),
    ).toBeNull();
    const fridaySpecial = burger({ daysMask: maskOf([5]) });
    expect(unavailableReason(fridaySpecial, TZ, fri)).toBeNull();
    expect(unavailableReason(fridaySpecial, TZ, sat)).toBe('not_today');
    const breakfast = burger({
      category: {
        id: 'b',
        name: 'Breakfast',
        isActive: true,
        availableFrom: '07:00',
        availableTo: '11:00',
      },
    });
    expect(
      unavailableReason(breakfast, TZ, pkt('2026-10-16', '08:00')),
    ).toBeNull();
    expect(unavailableReason(breakfast, TZ, fri)).toBe('outside_hours');
    expect(unavailableReason(burger({ remainingToday: 0 }), TZ, fri)).toBe(
      'sold_out',
    );
    expect(
      unavailableReason(burger({ remainingToday: 6 }), TZ, fri),
    ).toBeNull();
    expect(inWindow('22:00', '02:00', 60)).toBe(true);
    expect(daysOf(maskOf([1, 5]))).toEqual([1, 5]);
  });
});
