/**
 * The demand forecast for one dish on one day — pure, so the formula is
 * unit-tested against hand calculations.
 *
 * - Fewer than 14 days of history → `learning`: the recent daily average
 *   (last 7 days), with a wide band (½× to 1.6×).
 * - Otherwise a weighted average of the last 6 same weekdays (weights 0.3,
 *   0.25, 0.15, 0.12, 0.1, 0.08 — newest first, renormalised when fewer are
 *   known; `weekday_avg` when fewer than 6), × the trend (last 14 days ÷ the
 *   14 before, clamped 0.8–1.2), × the event factor (Ramadan, Eid, public
 *   holidays). low/high = expected ∓ 1.28 × the weighted spread of those
 *   weekdays around their average (an ~80% band), never below 0.
 */
export const WEEKDAY_WEIGHTS = [0.3, 0.25, 0.15, 0.12, 0.1, 0.08] as const;
export const LEARNING_DAYS = 14;
export const TREND_MIN = 0.8;
export const TREND_MAX = 1.2;

export type ForecastMethod = 'learning' | 'weekday_avg' | 'weighted';

export interface ForecastResult {
  expected: number;
  low: number;
  high: number;
  method: ForecastMethod;
  /** The factors used, for the "why" in the app. */
  basis: { base: number; trend: number; event: number; samples: number };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Day number (UTC) of a "YYYY-MM-DD". */
const dayNo = (d: string) =>
  Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * `history`: quantity sold per local date, one entry per day of history
 * (zeros included) — the days the dish could have sold, ending before
 * `forDate`. `eventFactor`: 1 on an ordinary day.
 */
export function forecast(
  history: Array<{ date: string; qty: number }>,
  forDate: string,
  eventFactor = 1,
): ForecastResult {
  const days = [...history]
    .filter((h) => dayNo(h.date) < dayNo(forDate))
    .sort((a, b) => dayNo(a.date) - dayNo(b.date));
  const n = days.length;
  if (n < LEARNING_DAYS) {
    const recent = days.slice(-7);
    const avg = recent.length
      ? recent.reduce((s, d) => s + d.qty, 0) / recent.length
      : 0;
    const expected = avg * eventFactor;
    return {
      expected: r1(expected),
      low: r1(expected * 0.5),
      high: r1(expected * 1.6),
      method: 'learning',
      basis: {
        base: r1(avg),
        trend: 1,
        event: eventFactor,
        samples: recent.length,
      },
    };
  }
  const target = dayNo(forDate);
  const same = days
    .filter((d) => (target - dayNo(d.date)) % 7 === 0)
    .reverse()
    .slice(0, WEEKDAY_WEIGHTS.length);
  const weights = WEEKDAY_WEIGHTS.slice(0, same.length);
  const wSum = weights.reduce((s, w) => s + w, 0);
  const base = same.length
    ? same.reduce((s, d, i) => s + weights[i] * d.qty, 0) / wSum
    : 0;
  const last14 = days.slice(-14).reduce((s, d) => s + d.qty, 0);
  const prev14 = days.slice(-28, -14).reduce((s, d) => s + d.qty, 0);
  const trend =
    days.length >= 28 && prev14 > 0
      ? Math.min(TREND_MAX, Math.max(TREND_MIN, last14 / prev14))
      : 1;
  const expected = base * trend * eventFactor;
  const spread = same.length
    ? Math.sqrt(
        same.reduce((s, d, i) => s + weights[i] * (d.qty - base) ** 2, 0) /
          wSum,
      )
    : 0;
  const band = 1.28 * spread * trend * eventFactor;
  return {
    expected: r1(expected),
    low: r1(Math.max(0, expected - band)),
    high: r1(expected + band),
    method: same.length >= WEEKDAY_WEIGHTS.length ? 'weighted' : 'weekday_avg',
    basis: {
      base: r1(base),
      trend: Math.round(trend * 1000) / 1000,
      event: eventFactor,
      samples: same.length,
    },
  };
}

/** Mean absolute percentage error over the dishes that had a forecast or a sale (actual 0 counts as 1). */
export function mape(
  pairs: Array<{ expected: number; actual: number }>,
): number | null {
  const used = pairs.filter((p) => p.expected > 0 || p.actual > 0);
  if (!used.length) return null;
  const e =
    used.reduce(
      (s, p) => s + Math.abs(p.actual - p.expected) / Math.max(p.actual, 1),
      0,
    ) / used.length;
  return Math.round(e * 1000) / 10;
}

/**
 * The event factor for a day from the dish's own past: sales on earlier
 * days of the same kind of event ÷ ordinary days in the 28 days before it;
 * without that history, a default.
 */
export const DEFAULT_EVENT_FACTOR: Record<string, number> = {
  ramadan: 1,
  eid: 0.7,
  public_holiday: 1.15,
  other: 1,
};

export function eventFactorFrom(
  history: Array<{ date: string; qty: number }>,
  eventDays: Set<string>,
  kind: string,
): number {
  const during = history.filter((h) => eventDays.has(h.date));
  if (during.length < 3) return DEFAULT_EVENT_FACTOR[kind] ?? 1;
  const first = Math.min(...during.map((d) => dayNo(d.date)));
  const before = history.filter(
    (h) =>
      !eventDays.has(h.date) &&
      dayNo(h.date) < first &&
      dayNo(h.date) >= first - 28,
  );
  const avgBefore = before.length
    ? before.reduce((s, d) => s + d.qty, 0) / before.length
    : 0;
  if (avgBefore <= 0) return DEFAULT_EVENT_FACTOR[kind] ?? 1;
  const avgDuring = during.reduce((s, d) => s + d.qty, 0) / during.length;
  return (
    Math.round(Math.min(3, Math.max(0.2, avgDuring / avgBefore)) * 100) / 100
  );
}
