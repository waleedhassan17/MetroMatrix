import { readFileSync } from 'fs';
import { join } from 'path';
import { DEMO_VENDORS, FOOD_PHOTOS, FoodPhoto } from './food-data';
import { ITEM_TAGS } from '../../../modules/food/menu/entities/menu-item.entity';

const CUISINES = [
  'pakistani',
  'bbq',
  'fast-food',
  'burgers',
  'pizza',
  'chinese',
  'biryani',
  'karahi',
  'desserts',
  'bakery',
  'cafe',
  'healthy',
  'breakfast',
  'shawarma',
  'rolls',
  'ice-cream',
  'home-food',
  'beverages',
];

describe('Food demo data', () => {
  const items = DEMO_VENDORS.flatMap((v) =>
    v.menu.flatMap((c) => c.items.map((i) => ({ v, i }))),
  );

  it('is the spec’s mix: 3 restaurants, a cloud kitchen, 2 home kitchens (one pre-order only, one with portions), 2 cities', () => {
    const kinds = DEMO_VENDORS.map((v) => v.subType).sort();
    expect(kinds).toEqual([
      'cloud_kitchen',
      'home_kitchen',
      'home_kitchen',
      'restaurant',
      'restaurant',
      'restaurant',
    ]);
    const homes = DEMO_VENDORS.filter((v) => v.subType === 'home_kitchen');
    expect(homes.filter((h) => h.preorderOnly && h.slots?.length)).toHaveLength(
      1,
    );
    expect(
      homes.filter((h) => h.menu.some((c) => c.items.some((i) => i.portions))),
    ).toHaveLength(1);
    expect(new Set(DEMO_VENDORS.map((v) => v.city))).toEqual(
      new Set(['Lahore', 'Karachi']),
    );
    expect(DEMO_VENDORS.filter((v) => v.riders?.length)).toHaveLength(3);
    expect(
      DEMO_VENDORS.find((v) => v.subType === 'cloud_kitchen')!.acceptsPickup,
    ).toBe(false);
  });

  it('has 40–80 dishes, with sizes and option groups that make sense', () => {
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(items.length).toBeLessThanOrEqual(80);
    expect(items.some(({ i }) => i.variants?.length)).toBe(true);
    for (const v of DEMO_VENDORS) {
      for (const g of v.groups) {
        expect([
          v.key,
          g.key,
          g.min <= g.max && g.max <= g.options.length,
        ]).toEqual([v.key, g.key, true]);
        expect(g.options.filter((o) => o[2]).length).toBeLessThanOrEqual(1);
      }
      for (const c of v.menu)
        for (const i of c.items) {
          for (const k of i.groups ?? [])
            expect([i.name, v.groups.some((g) => g.key === k)]).toEqual([
              i.name,
              true,
            ]);
          for (const t of i.tags ?? []) expect(ITEM_TAGS).toContain(t);
          expect(i.price).toBeGreaterThan(0);
        }
      for (const c of v.cuisines) expect(CUISINES).toContain(c);
      expect(v.bands[0].fromKm).toBe(0);
      expect(v.bands[v.bands.length - 1].toKm).toBeLessThanOrEqual(
        v.maxRadiusKm,
      );
    }
  });

  it('every vendor is fictional and says so', () => {
    for (const v of DEMO_VENDORS)
      expect(v.tagline).toMatch(/demo vendor \(fictional\)/);
  });

  it('every photo is credited, and every credited photo is used', () => {
    const credits = readFileSync(join(__dirname, 'CREDITS.md'), 'utf8');
    for (const key of Object.keys(FOOD_PHOTOS))
      expect([key, credits.includes(`| \`${key}\` |`)]).toEqual([key, true]);
    const used = new Set<FoodPhoto>([
      ...DEMO_VENDORS.map((v) => v.cover),
      ...items.map(({ i }) => i.photo).filter((p): p is FoodPhoto => !!p),
      'chickenKarahi',
      'biryani',
      'doubleBurger', // banners
    ]);
    for (const key of Object.keys(FOOD_PHOTOS) as FoodPhoto[])
      expect([key, used.has(key)]).toEqual([key, true]);
  });
});
