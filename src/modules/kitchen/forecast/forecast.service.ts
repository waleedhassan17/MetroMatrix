import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { addDays, todayIn } from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { kitchenNotFound } from '../common/errors';
import { eventFactorFrom, forecast, mape } from './forecast';

/** Days of sales history read (8 weeks covers 6 same weekdays + the trend). */
export const HISTORY_DAYS = 56;
export const FORECAST_DAYS = 7;

/** Orders that count as sold: everything except refused or cancelled ones. */
const SOLD = `o.status NOT IN ('rejected', 'auto_rejected', 'cancelled')`;

export type ExtraDemand = (
  m: EntityManager,
  branchId: string,
  date: string,
) => Promise<Map<string, number>>;

interface Branch {
  id: string;
  brand_id: string;
  timezone: string;
  city: string;
  went_live_at: Date | null;
}

/**
 * Nightly per kitchen: each active dish's forecast for the next 7 days
 * (forecast.ts), yesterday's accuracy (MAPE). A vendor's adjusted number
 * survives the nightly rewrite. Certain demand (tiffin subscriptions,
 * catering) comes from `extraDemand` providers registered by food-growth.
 */
@Injectable()
export class ForecastService {
  readonly extraDemand: ExtraDemand[] = [];

  constructor(private readonly dataSource: DataSource) {}

  async branch(m: EntityManager, branchId: string): Promise<Branch> {
    const [b] = await m.query(
      `SELECT id, brand_id, timezone, city, went_live_at FROM branches WHERE id = $1`,
      [branchId],
    );
    return b;
  }

  /** Daily quantity per dish over the history window, zeros filled from the first day it could sell. */
  async history(
    m: EntityManager,
    b: Branch,
    today: string,
  ): Promise<Map<string, Array<{ date: string; qty: number }>>> {
    const from = addDays(today, -HISTORY_DAYS);
    const live = b.went_live_at ? todayIn(b.timezone, b.went_live_at) : from;
    const start = live > from ? live : from;
    const rows: Array<{ item_id: string; day: string; qty: number }> =
      await m.query(
        `SELECT oi.item_id, to_char((coalesce(o.scheduled_for, o.created_at) AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day,
              sum(oi.quantity)::int AS qty
         FROM food_orders o JOIN food_order_items oi ON oi.order_id = o.id
        WHERE o.branch_id = $1 AND ${SOLD} AND oi.item_id IS NOT NULL
          AND (coalesce(o.scheduled_for, o.created_at) AT TIME ZONE $2)::date >= $3::date
          AND (coalesce(o.scheduled_for, o.created_at) AT TIME ZONE $2)::date < $4::date
        GROUP BY 1, 2`,
        [b.id, b.timezone, start, today],
      );
    const items: Array<{ id: string }> = await m.query(
      `SELECT id FROM menu_items WHERE brand_id = $1 AND is_active`,
      [b.brand_id],
    );
    const sold = new Map(rows.map((r) => [`${r.item_id}|${r.day}`, r.qty]));
    const out = new Map<string, Array<{ date: string; qty: number }>>();
    for (const i of items) {
      const days: Array<{ date: string; qty: number }> = [];
      for (let d = start; d < today; d = addDays(d, 1))
        days.push({ date: d, qty: sold.get(`${i.id}|${d}`) ?? 0 });
      out.set(i.id, days);
    }
    return out;
  }

  /** Calendar events touching the branch's city between two dates: date → kind. */
  async events(
    m: EntityManager,
    city: string,
    from: string,
    to: string,
  ): Promise<Map<string, string>> {
    const rows: Array<{ kind: string; starts_on: string; ends_on: string }> =
      await m.query(
        `SELECT kind, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
         FROM calendar_events WHERE (city IS NULL OR city = $1) AND ends_on >= $2::date AND starts_on <= $3::date`,
        [city, from, to],
      );
    const out = new Map<string, string>();
    for (const e of rows)
      for (let d = e.starts_on; d <= e.ends_on; d = addDays(d, 1))
        out.set(d, e.kind);
    return out;
  }

  /** Rewrite the next 7 days for one kitchen (adjusted numbers are kept). */
  async generate(m: EntityManager, branchId: string, now = new Date()) {
    const b = await this.branch(m, branchId);
    const today = todayIn(b.timezone, now);
    const history = await this.history(m, b, today);
    const events = await this.events(
      m,
      b.city,
      addDays(today, -400),
      addDays(today, FORECAST_DAYS),
    );
    let rows = 0;
    for (const [itemId, days] of history) {
      for (let k = 0; k < FORECAST_DAYS; k++) {
        const forDate = addDays(today, k);
        const kind = events.get(forDate);
        const factor = kind
          ? eventFactorFrom(
              days,
              new Set(
                [...events].filter(([, v]) => v === kind).map(([d]) => d),
              ),
              kind,
            )
          : 1;
        const f = forecast(days, forDate, factor);
        await m.query(
          `INSERT INTO demand_forecasts (branch_id, menu_item_id, for_date, expected, low, high, method, basis, generated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (branch_id, menu_item_id, for_date) DO UPDATE SET expected = EXCLUDED.expected,
             low = EXCLUDED.low, high = EXCLUDED.high, method = EXCLUDED.method, basis = EXCLUDED.basis,
             generated_at = EXCLUDED.generated_at, updated_at = now()`,
          [
            branchId,
            itemId,
            forDate,
            f.expected,
            f.low,
            f.high,
            f.method,
            JSON.stringify({ ...f.basis, ...(kind ? { eventKind: 1 } : {}) }),
            now,
          ],
        );
        rows++;
      }
    }
    await m.query(
      `DELETE FROM demand_forecasts WHERE branch_id = $1 AND for_date < $2::date - 60`,
      [branchId, today],
    );
    return rows;
  }

  /** Yesterday's MAPE (once per day; a re-run replaces it). */
  async accuracy(m: EntityManager, branchId: string, now = new Date()) {
    const b = await this.branch(m, branchId);
    const day = addDays(todayIn(b.timezone, now), -1);
    const pairs: Array<{ expected: string; actual: number }> = await m.query(
      `SELECT coalesce(f.adjusted::numeric, f.expected) AS expected, coalesce(s.qty, 0)::int AS actual
         FROM demand_forecasts f
         LEFT JOIN (SELECT oi.item_id, sum(oi.quantity) AS qty FROM food_orders o JOIN food_order_items oi ON oi.order_id = o.id
                     WHERE o.branch_id = $1 AND ${SOLD}
                       AND (coalesce(o.scheduled_for, o.created_at) AT TIME ZONE $3)::date = $2::date
                     GROUP BY oi.item_id) s ON s.item_id = f.menu_item_id
        WHERE f.branch_id = $1 AND f.for_date = $2::date`,
      [branchId, day, b.timezone],
    );
    if (!pairs.length) return null;
    const value = mape(
      pairs.map((p) => ({ expected: Number(p.expected), actual: p.actual })),
    );
    await m.query(
      `INSERT INTO forecast_accuracy (branch_id, for_date, mape, items_count) VALUES ($1, $2, $3, $4)
       ON CONFLICT (branch_id, for_date) DO UPDATE SET mape = EXCLUDED.mape, items_count = EXCLUDED.items_count, updated_at = now()`,
      [branchId, day, value, pairs.length],
    );
    return value;
  }

  async view(v: VendorRef, from?: string, days = 7) {
    const b = await this.branch(this.dataSource.manager, v.branchId);
    const start = from ?? todayIn(b.timezone);
    const end = addDays(start, Math.min(Math.max(days, 1), 14) - 1);
    const rows = await this.dataSource.query(
      `SELECT f.id, f.menu_item_id, mi.name, to_char(f.for_date, 'YYYY-MM-DD') AS for_date, f.expected, f.low, f.high,
              f.method, f.adjusted, f.basis, f.generated_at
         FROM demand_forecasts f JOIN menu_items mi ON mi.id = f.menu_item_id
        WHERE f.branch_id = $1 AND f.for_date BETWEEN $2::date AND $3::date AND mi.is_active
        ORDER BY f.for_date, mi.sort, mi.name`,
      [v.branchId, start, end],
    );
    const acc = await this.dataSource.query(
      `SELECT to_char(for_date, 'YYYY-MM-DD') AS date, mape, items_count FROM forecast_accuracy
        WHERE branch_id = $1 ORDER BY for_date DESC LIMIT 14`,
      [v.branchId],
    );
    const known = acc.filter((a: any) => a.mape !== null);
    return {
      from: start,
      to: end,
      learning:
        rows.length > 0 && rows.every((r: any) => r.method === 'learning'),
      items: rows.map((r: any) => ({
        id: r.id,
        itemId: r.menu_item_id,
        name: r.name,
        date: r.for_date,
        expected: Number(r.expected),
        low: Number(r.low),
        high: Number(r.high),
        method: r.method,
        label: r.method === 'learning' ? 'Learning your patterns' : null,
        adjusted: r.adjusted,
        basis: r.basis,
        generatedAt: r.generated_at,
      })),
      accuracy: {
        recent: acc.map((a: any) => ({
          date: a.date,
          mape: a.mape === null ? null : Number(a.mape),
          items: a.items_count,
        })),
        /** Average MAPE over the last 14 days with a score. */
        mape14d: known.length
          ? Math.round(
              (known.reduce((s: number, a: any) => s + Number(a.mape), 0) /
                known.length) *
                10,
            ) / 10
          : null,
      },
    };
  }

  async adjust(v: VendorRef, id: string, adjusted: number | null) {
    const res = await this.dataSource.query(
      `UPDATE demand_forecasts SET adjusted = $3, updated_at = now() WHERE id = $1 AND branch_id = $2 RETURNING id`,
      [id, v.branchId, adjusted],
    );
    const updated = Array.isArray(res[0]) ? res[0].length : res.length;
    if (!updated) throw kitchenNotFound('Forecast');
    const [row] = await this.dataSource.query(
      `SELECT id, menu_item_id, to_char(for_date, 'YYYY-MM-DD') AS for_date, expected, low, high, method, adjusted
         FROM demand_forecasts WHERE id = $1`,
      [id],
    );
    return {
      id: row.id,
      itemId: row.menu_item_id,
      date: row.for_date,
      expected: Number(row.expected),
      low: Number(row.low),
      high: Number(row.high),
      method: row.method,
      adjusted: row.adjusted,
    };
  }

  /** Planned portions per dish for a date: the vendor's number, else the forecast, plus certain demand. */
  async planned(
    m: EntityManager,
    branchId: string,
    date: string,
  ): Promise<
    Map<
      string,
      {
        planned: number;
        forecast: number | null;
        adjusted: number | null;
        extra: number;
      }
    >
  > {
    const rows: Array<{
      menu_item_id: string;
      expected: string;
      adjusted: number | null;
    }> = await m.query(
      `SELECT f.menu_item_id, f.expected, f.adjusted FROM demand_forecasts f JOIN menu_items mi ON mi.id = f.menu_item_id
        WHERE f.branch_id = $1 AND f.for_date = $2::date AND mi.is_active`,
      [branchId, date],
    );
    const out = new Map<
      string,
      {
        planned: number;
        forecast: number | null;
        adjusted: number | null;
        extra: number;
      }
    >();
    for (const r of rows) {
      const base = r.adjusted ?? Math.round(Number(r.expected));
      out.set(r.menu_item_id, {
        planned: base,
        forecast: Number(r.expected),
        adjusted: r.adjusted,
        extra: 0,
      });
    }
    for (const provider of this.extraDemand) {
      for (const [itemId, qty] of await provider(m, branchId, date)) {
        const cur = out.get(itemId) ?? {
          planned: 0,
          forecast: null,
          adjusted: null,
          extra: 0,
        };
        cur.extra += qty;
        cur.planned += qty;
        out.set(itemId, cur);
      }
    }
    return out;
  }
}
