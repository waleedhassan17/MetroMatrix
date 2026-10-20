import { RECIPE_LIBRARY, rankLibrary, STAPLES } from './recipe-library';
import { INGREDIENT_ALIASES } from '../../database/migrations/1792362400000-KitchenAliasesSeed';

describe('recipe library ranking', () => {
  it('every ingredient is a known canonical name', () => {
    const canon = new Set(INGREDIENT_ALIASES.map((a) => a[0]));
    for (const r of RECIPE_LIBRARY)
      for (const n of r.needs) expect(canon.has(n)).toBe(true);
    for (const s of STAPLES) expect(canon.has(s)).toBe(true);
  });

  it('prefers recipes that use what expires soon, and marks what is missing (QA #34 basis)', () => {
    const ranked = rankLibrary([
      { id: 'a', name: 'Palak', canonical: 'spinach', daysLeft: 1 },
      { id: 'b', name: 'Paneer', canonical: 'paneer', daysLeft: 2 },
      { id: 'c', name: 'Aloo', canonical: 'potato', daysLeft: 20 },
      { id: 'd', name: 'Pyaz', canonical: 'onion', daysLeft: null },
      { id: 'e', name: 'Anday', canonical: 'egg', daysLeft: 10 },
    ]);
    expect(ranked[0].recipe.key).toBe('palak-paneer');
    expect(ranked[0].expiring).toBe(2);
    expect(ranked[0].missing).toEqual(['garlic', 'cream']);
    expect(ranked.every((r) => r.uses.length > 0)).toBe(true);
    // Staples are never missing.
    expect(ranked.flatMap((r) => r.missing)).not.toContain('salt');
  });

  it('nothing in the pantry → nothing to suggest', () => {
    expect(rankLibrary([])).toEqual([]);
  });
});
