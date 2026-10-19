/**
 * Nutrition maths — pure, so every number is checked against a hand
 * calculation. Reference values are per 100 g (USDA SR Legacy).
 */
export interface Per100 {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number;
  sodiumMg: number;
}

export type Nutrients = Per100;

export interface RecipeLineInput {
  name: string;
  /** Base-unit quantity of the whole card (before dividing by the yield). */
  qtyBase: number;
  baseUnit: 'g' | 'ml' | 'piece';
  /** The mapped reference food, or null. */
  food: Per100 | null;
  /** Grams per piece (ingredient override, else the food's typical weight). */
  pieceGrams: number | null;
}

/** A recipe is used once this share of its weight is mapped. */
export const MIN_MAPPED_SHARE = 0.8;
/** An unmapped piece of unknown weight is counted as this many grams. */
export const UNKNOWN_PIECE_GRAMS = 50;
export const HIGH_PROTEIN_G = 25;
export const LOW_KCAL = 600;

const ZERO: Nutrients = {
  kcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fibreG: 0,
  sodiumMg: 0,
};
const KEYS = Object.keys(ZERO) as Array<keyof Nutrients>;

/** Grams of a line: g as is, ml as grams (≈ water), pieces by their weight. */
export function gramsOf(l: RecipeLineInput): { grams: number; known: boolean } {
  if (l.baseUnit === 'piece') {
    if (l.pieceGrams && l.pieceGrams > 0)
      return { grams: l.qtyBase * l.pieceGrams, known: true };
    return { grams: l.qtyBase * UNKNOWN_PIECE_GRAMS, known: false };
  }
  return { grams: l.qtyBase, known: true };
}

export function round(n: Nutrients): Nutrients {
  return {
    kcal: Math.round(n.kcal),
    proteinG: Math.round(n.proteinG * 10) / 10,
    carbsG: Math.round(n.carbsG * 10) / 10,
    fatG: Math.round(n.fatG * 10) / 10,
    fibreG: Math.round(n.fibreG * 10) / 10,
    sodiumMg: Math.round(n.sodiumMg),
  };
}

/**
 * Per serving from a recipe card: Σ grams × value / 100, over the mapped
 * lines, ÷ yield. `mappedShare` is the mapped weight ÷ all weight; under
 * MIN_MAPPED_SHARE the recipe isn't used (`usable: false`).
 */
export function fromRecipe(lines: RecipeLineInput[], yieldServings: number) {
  let total = 0;
  let mapped = 0;
  const sum: Nutrients = { ...ZERO };
  const unmapped: string[] = [];
  for (const l of lines) {
    const { grams, known } = gramsOf(l);
    total += grams;
    if (!l.food || !known) {
      unmapped.push(l.name);
      continue;
    }
    mapped += grams;
    for (const k of KEYS) sum[k] += (grams * l.food[k]) / 100;
  }
  const per: Nutrients = { ...ZERO };
  for (const k of KEYS) per[k] = sum[k] / Math.max(1, yieldServings);
  const mappedShare = total ? Math.round((mapped / total) * 1000) / 1000 : 0;
  return {
    perServing: round(per),
    servingGrams: Math.round(total / Math.max(1, yieldServings)),
    mappedShare,
    usable: total > 0 && mappedShare >= MIN_MAPPED_SHARE,
    unmapped,
  };
}

export function badges(n: Nutrients, tags: string[]): string[] {
  const out: string[] = [];
  if (n.kcal > 0 && n.kcal < LOW_KCAL) out.push('under_600_kcal');
  if (n.proteinG >= HIGH_PROTEIN_G) out.push('high_protein');
  if (tags.includes('veg')) out.push('veg');
  return out;
}

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;
export type Activity = keyof typeof ACTIVITY_FACTORS;
export const GOAL_ADJUST = { maintain: 0, lose: -500, gain: 300 } as const;
export type Goal = keyof typeof GOAL_ADJUST;

export const MIFFLIN = {
  name: 'Mifflin-St Jeor',
  source:
    'Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr. 1990;51(2):241–247.',
  formula:
    'BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (y) + 5 (male) or − 161 (female); × activity factor; ± goal',
};

/**
 * A daily target by Mifflin-St Jeor: BMR × activity, then −500 kcal to lose
 * or +300 to gain; never below 1,200 (female) / 1,500 (male). Rounded to 10.
 */
export function mifflinTarget(p: {
  sex: 'male' | 'female';
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
}) {
  const bmr =
    10 * p.weightKg +
    6.25 * p.heightCm -
    5 * p.age +
    (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * ACTIVITY_FACTORS[p.activity];
  const floor = p.sex === 'male' ? 1500 : 1200;
  const target = Math.max(floor, tdee + GOAL_ADJUST[p.goal]);
  return {
    bmr: Math.round(bmr),
    maintenance: Math.round(tdee),
    targetKcal: Math.round(target / 10) * 10,
  };
}
