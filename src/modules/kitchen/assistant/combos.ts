/**
 * Dishes ordered together — deterministic co-occurrence over real orders.
 * The AI only names the combos; which dishes go together is counted here.
 */
export interface PairStat {
  items: [string, string];
  /** Orders with both. */
  together: number;
  /** together ÷ all orders, %. */
  supportPct: number;
  /** P(a and b) ÷ (P(a) × P(b)); > 1 means they go together more than by chance. */
  lift: number;
}

export const COMBO_MIN_ORDERS = 3;

/** `orders`: the distinct dish ids of each order. Pairs seen in at least `minTogether` orders, best first. */
export function topPairs(
  orders: string[][],
  minTogether = COMBO_MIN_ORDERS,
  limit = 5,
): PairStat[] {
  const n = orders.length;
  if (!n) return [];
  const single = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const raw of orders) {
    const items = [...new Set(raw)].sort();
    for (const i of items) single.set(i, (single.get(i) ?? 0) + 1);
    for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++) {
        const k = `${items[a]}|${items[b]}`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
  }
  const out: PairStat[] = [];
  for (const [k, together] of pairs) {
    if (together < minTogether) continue;
    const [a, b] = k.split('|') as [string, string];
    const lift = together / n / ((single.get(a)! / n) * (single.get(b)! / n));
    out.push({
      items: [a, b],
      together,
      supportPct: Math.round((together / n) * 1000) / 10,
      lift: Math.round(lift * 100) / 100,
    });
  }
  return out
    .sort(
      (x, y) =>
        y.together - x.together ||
        y.lift - x.lift ||
        x.items.join().localeCompare(y.items.join()),
    )
    .slice(0, limit);
}

/** A bundle price: 10% off the dishes' prices, rounded down to Rs 10. */
export const bundlePrice = (prices: number[]) =>
  Math.floor((prices.reduce((s, p) => s + p, 0) * 0.9) / 10) * 10;
