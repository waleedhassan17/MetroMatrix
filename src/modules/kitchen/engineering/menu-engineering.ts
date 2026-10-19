/**
 * Menu engineering and menu experiments — pure, so the rules are unit-tested
 * against hand calculations.
 *
 * Quadrants (Kasavana & Smith, with medians): a dish is *popular* when its
 * 30-day quantity is at least the median, *profitable* when its contribution
 * margin (price − cost per serving) is at least the median. Medians are over
 * the dishes with a cost (a recipe card); the others are listed apart.
 */
export type Quadrant = 'star' | 'plowhorse' | 'puzzle' | 'dog';

export const QUADRANT_ACTION: Record<
  Quadrant,
  { action: string; label: string; advice: string }
> = {
  star: {
    action: 'feature',
    label: 'Star',
    advice: 'Popular and profitable — keep it prominent and feature it.',
  },
  plowhorse: {
    action: 'reprice',
    label: 'Plowhorse',
    advice: 'Popular, low margin — reprice a little or trim the recipe cost.',
  },
  puzzle: {
    action: 'redescribe_or_bundle',
    label: 'Puzzle',
    advice:
      'Profitable, rarely ordered — a better photo and description, or bundle it.',
  },
  dog: {
    action: 'remove',
    label: 'Dog',
    advice: 'Neither popular nor profitable — consider removing it.',
  },
};

export interface EngineeringInput {
  itemId: string;
  name: string;
  /** Servings sold in the last 30 days. */
  qty: number;
  /** Rupees per serving; null without a recipe card. */
  margin: number | null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function classifyMenu(items: EngineeringInput[]) {
  const costed = items.filter((i) => i.margin !== null);
  const medianQty = median(costed.map((i) => i.qty));
  const medianMargin = median(costed.map((i) => i.margin!));
  return {
    medianQty,
    medianMargin,
    items: costed.map((i) => {
      const popular = i.qty >= medianQty!;
      const profitable = i.margin! >= medianMargin!;
      const quadrant: Quadrant = popular
        ? profitable
          ? 'star'
          : 'plowhorse'
        : profitable
          ? 'puzzle'
          : 'dog';
      return {
        ...i,
        popular,
        profitable,
        quadrant,
        ...QUADRANT_ACTION[quadrant],
      };
    }),
    /** "Add a recipe card to analyse". */
    needsRecipe: items
      .filter((i) => i.margin === null)
      .map((i) => ({ itemId: i.itemId, name: i.name, qty: i.qty })),
  };
}

export type ExperimentRecommendation = 'keep' | 'adjust' | 'drop';

export interface ExperimentInput {
  /** Days of the experiment so far (or in all, when it ended). */
  days: number;
  /** The dish's average servings a day over those days. */
  itemDaily: number;
  /** The median of the same category's other dishes, same days. */
  categoryMedianDaily: number | null;
  /** Sold ÷ forecast over the same days (null without forecasts). */
  vsForecast: number | null;
  foodCostPct: number | null;
  targetFoodCostPct: number;
}

/** Fewer days than this and there's no verdict yet. */
export const EXPERIMENT_MIN_DAYS = 3;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * keep — sells at least as well as the category's median dish and its food
 * cost is on target; drop — under half the median (and not beating its
 * forecast); adjust — anything in between, with the reasons.
 */
export function experimentVerdict(x: ExperimentInput): {
  salesIndex: number | null;
  recommendation: ExperimentRecommendation | null;
  reasons: string[];
} {
  const salesIndex =
    x.categoryMedianDaily === null
      ? null
      : x.categoryMedianDaily > 0
        ? r2(x.itemDaily / x.categoryMedianDaily)
        : x.itemDaily > 0
          ? 1
          : 0;
  if (x.days < EXPERIMENT_MIN_DAYS)
    return {
      salesIndex,
      recommendation: null,
      reasons: [`Too early — at least ${EXPERIMENT_MIN_DAYS} days are needed.`],
    };
  const reasons: string[] = [];
  const costOk = x.foodCostPct === null || x.foodCostPct <= x.targetFoodCostPct;
  const index = salesIndex ?? (x.vsForecast !== null ? x.vsForecast : 1);
  if (index < 0.5 && (x.vsForecast === null || x.vsForecast < 0.8)) {
    reasons.push('Sells under half as much as a typical dish in its category.');
    if (!costOk) reasons.push('Its food cost is above your target too.');
    return { salesIndex, recommendation: 'drop', reasons };
  }
  if (index >= 1 && costOk) {
    reasons.push('Sells at least as well as a typical dish in its category.');
    if (x.foodCostPct !== null) reasons.push('Food cost is on target.');
    return { salesIndex, recommendation: 'keep', reasons };
  }
  if (index < 1)
    reasons.push(
      'Sells below the category median — try a better photo, description or price.',
    );
  if (!costOk)
    reasons.push(
      `Food cost ${x.foodCostPct}% is above your ${x.targetFoodCostPct}% target — reprice or adjust the recipe.`,
    );
  return { salesIndex, recommendation: 'adjust', reasons };
}
