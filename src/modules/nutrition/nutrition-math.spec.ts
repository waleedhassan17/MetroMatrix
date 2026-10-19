import {
  badges,
  fromRecipe,
  mifflinTarget,
  MIN_MAPPED_SHARE,
} from './nutrition-math';
import { NUTRITION_FOODS } from '../../database/seeds/nutrition/nutrition-foods.data';

const food = (key: string) => {
  const f = NUTRITION_FOODS.find((x) => x.key === key)!;
  return {
    kcal: f.kcal,
    proteinG: f.proteinG,
    carbsG: f.carbsG,
    fatG: f.fatG,
    fibreG: f.fibreG,
    sodiumMg: f.sodiumMg,
  };
};

describe('nutrition from a recipe card', () => {
  it('equals the hand calculation (QA #31 seed)', () => {
    // Chicken karahi for 4: 1000 g chicken (119 kcal, 21.39 g protein /100 g),
    // 300 g tomato (18 kcal, 0.88 g), 100 g ghee (900 kcal, 0 g protein).
    const r = fromRecipe(
      [
        {
          name: 'Chicken',
          qtyBase: 1000,
          baseUnit: 'g',
          food: food('chicken'),
          pieceGrams: null,
        },
        {
          name: 'Tomato',
          qtyBase: 300,
          baseUnit: 'g',
          food: food('tomato'),
          pieceGrams: null,
        },
        {
          name: 'Ghee',
          qtyBase: 100,
          baseUnit: 'g',
          food: food('ghee'),
          pieceGrams: null,
        },
      ],
      4,
    );
    // kcal: (1190 + 54 + 900) / 4 = 536; protein: (213.9 + 2.64) / 4 = 54.135 → 54.1
    expect(r.perServing.kcal).toBe(536);
    expect(r.perServing.proteinG).toBe(54.1);
    expect(r.mappedShare).toBe(1);
    expect(r.usable).toBe(true);
    expect(r.servingGrams).toBe(350);
    expect(badges(r.perServing, ['spicy'])).toEqual([
      'under_600_kcal',
      'high_protein',
    ]);
  });

  it('pieces count by their weight; under 80% mapped is not used', () => {
    const egg = food('egg');
    const r = fromRecipe(
      [
        {
          name: 'Egg',
          qtyBase: 2,
          baseUnit: 'piece',
          food: egg,
          pieceGrams: 50,
        },
      ],
      1,
    );
    expect(r.perServing.kcal).toBe(143);
    const partial = fromRecipe(
      [
        {
          name: 'Rice',
          qtyBase: 700,
          baseUnit: 'g',
          food: food('rice'),
          pieceGrams: null,
        },
        {
          name: 'Secret masala',
          qtyBase: 300,
          baseUnit: 'g',
          food: null,
          pieceGrams: null,
        },
      ],
      2,
    );
    expect(partial.mappedShare).toBe(0.7);
    expect(partial.mappedShare).toBeLessThan(MIN_MAPPED_SHARE);
    expect(partial.usable).toBe(false);
    expect(partial.unmapped).toEqual(['Secret masala']);
  });
});

describe('Mifflin-St Jeor', () => {
  it('matches the formula by hand', () => {
    // Male, 30 y, 175 cm, 70 kg: 700 + 1093.75 − 150 + 5 = 1648.75; × 1.55 = 2555.6
    expect(
      mifflinTarget({
        sex: 'male',
        age: 30,
        heightCm: 175,
        weightKg: 70,
        activity: 'moderate',
        goal: 'maintain',
      }),
    ).toEqual({ bmr: 1649, maintenance: 2556, targetKcal: 2560 });
    // Female, 25 y, 160 cm, 55 kg, sedentary, lose: (550 + 1000 − 125 − 161) × 1.2 − 500 = 1016.8 → floor 1200
    expect(
      mifflinTarget({
        sex: 'female',
        age: 25,
        heightCm: 160,
        weightKg: 55,
        activity: 'sedentary',
        goal: 'lose',
      }).targetKcal,
    ).toBe(1200);
  });
});

describe('the reference table', () => {
  it('about 400 foods, every canonical food mapped once, values per 100 g in range', () => {
    expect(NUTRITION_FOODS.length).toBeGreaterThanOrEqual(400);
    expect(new Set(NUTRITION_FOODS.map((f) => f.key)).size).toBe(
      NUTRITION_FOODS.length,
    );
    const canon = NUTRITION_FOODS.flatMap((f) => f.canonicals);
    expect(new Set(canon).size).toBe(canon.length);
    for (const f of NUTRITION_FOODS) {
      expect(f.kcal).toBeGreaterThanOrEqual(0);
      expect(f.kcal).toBeLessThanOrEqual(902);
      expect(f.proteinG + f.carbsG + f.fatG).toBeLessThanOrEqual(101);
      expect(f.usdaDescription).not.toMatch(/pork|bacon|lard|wine|beer/i);
    }
  });
});
