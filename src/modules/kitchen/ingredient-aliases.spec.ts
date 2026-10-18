import { INGREDIENT_ALIASES } from '../../database/migrations/1792362400000-KitchenAliasesSeed';

describe('ingredient aliases seed', () => {
  const all = INGREDIENT_ALIASES.flatMap(([c, en, roman, ur]) => [
    c,
    ...en,
    ...roman,
    ...ur,
  ]);

  it('has no alias twice (they are unique, case-insensitively)', () => {
    const seen = new Set<string>();
    const dups = all.filter((a) => {
      const k = a.toLowerCase();
      const d = seen.has(k);
      seen.add(k);
      return d;
    });
    expect(dups).toEqual([]);
  });

  it('covers 100 ingredients in English, Roman Urdu and Urdu script', () => {
    expect(INGREDIENT_ALIASES.length).toBeGreaterThanOrEqual(100);
    expect(all.length).toBeGreaterThanOrEqual(400);
    const urdu = INGREDIENT_ALIASES.filter(
      ([, , , ur]) => ur.length > 0,
    ).length;
    expect(urdu).toBe(INGREDIENT_ALIASES.length);
    for (const [, , , ur] of INGREDIENT_ALIASES)
      for (const a of ur) expect(a).toMatch(/[؀-ۿ]/);
  });
});
