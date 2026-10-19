import {
  DEFAULT_EVENT_FACTOR,
  eventFactorFrom,
  forecast,
  mape,
} from './forecast';

const DAY = 86_400_000;
const date = (n: number) =>
  new Date(Date.UTC(2026, 7, 1) + n * DAY).toISOString().slice(0, 10);
/** n days from 2026-08-01 (a Saturday), qty by function of the day index. */
const days = (n: number, qty: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ date: date(i), qty: qty(i) }));

describe('demand forecast', () => {
  it('learning under 14 days: the last 7 days’ average with a wide band', () => {
    const h = days(10, (i) => (i < 3 ? 0 : 10 + i)); // days 3..9 → 13..19, avg 16
    expect(forecast(h, date(10))).toEqual({
      expected: 16,
      low: 8,
      high: 25.6,
      method: 'learning',
      basis: { base: 16, trend: 1, event: 1, samples: 7 },
    });
    expect(forecast([], date(0)).expected).toBe(0);
  });

  it('weighted average of the last 6 same weekdays (hand-computed)', () => {
    // 60 days; Saturdays (i % 7 === 0) sell 10,20,30,40,50,60,70,80,90 by week; other days 5.
    const h = days(60, (i) => (i % 7 === 0 ? 10 * (i / 7 + 1) : 5));
    const forDate = date(63); // a Saturday: last six Saturdays are weeks 8..3 → 90,80,70,60,50,40
    const base =
      0.3 * 90 + 0.25 * 80 + 0.15 * 70 + 0.12 * 60 + 0.1 * 50 + 0.08 * 40; // = 72.9
    // trend: last 14 days (46..59) vs 14 before (32..45)
    const sum = (a: number, b: number) =>
      h.slice(a, b + 1).reduce((s, d) => s + d.qty, 0);
    const trend = Math.min(1.2, Math.max(0.8, sum(46, 59) / sum(32, 45)));
    const r = forecast(h, forDate);
    expect(r.method).toBe('weighted');
    expect(r.basis.base).toBeCloseTo(base, 1);
    expect(r.basis.trend).toBeCloseTo(trend, 3);
    expect(r.expected).toBeCloseTo(Math.round(base * trend * 10) / 10, 1);
    expect(r.low).toBeLessThan(r.expected);
    expect(r.high).toBeGreaterThan(r.expected);
  });

  it('a steady dish has a tight band; the trend is clamped to 0.8–1.2', () => {
    const steady = days(42, () => 12);
    expect(forecast(steady, date(42))).toMatchObject({
      expected: 12,
      low: 12,
      high: 12,
      method: 'weighted',
    });
    const booming = days(42, (i) => (i < 28 ? 1 : 50));
    expect(forecast(booming, date(42)).basis.trend).toBe(1.2);
    const fading = days(42, (i) => (i < 28 ? 50 : 1));
    expect(forecast(fading, date(42)).basis.trend).toBe(0.8);
  });

  it('weekday_avg when fewer than 6 same weekdays are known; the event factor multiplies', () => {
    const h = days(20, (i) => (i % 7 === 6 ? 30 : 10)); // Fridays (i=6,13) sell 30
    const r = forecast(h, date(20), 1.5); // date(20) is a Friday
    expect(r.method).toBe('weekday_avg');
    expect(r.basis.samples).toBe(2);
    expect(r.expected).toBe(45);
  });

  it('MAPE over dishes with a forecast or a sale', () => {
    expect(
      mape([
        { expected: 10, actual: 8 }, // 25%
        { expected: 5, actual: 5 }, // 0%
        { expected: 2, actual: 0 }, // 200% (actual counts as 1)
        { expected: 0, actual: 0 }, // ignored
      ]),
    ).toBe(75);
    expect(mape([])).toBeNull();
  });

  it('event factor from the dish’s last event, else the default', () => {
    const h = days(40, (i) => (i >= 30 && i < 35 ? 20 : 10));
    const ev = new Set([30, 31, 32, 33, 34].map(date));
    expect(eventFactorFrom(h, ev, 'ramadan')).toBe(2);
    expect(eventFactorFrom(h.slice(0, 20), ev, 'eid')).toBe(
      DEFAULT_EVENT_FACTOR.eid,
    );
  });
});
