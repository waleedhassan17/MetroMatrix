import { Injectable, OnModuleInit } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, EntityManager } from 'typeorm';
import { DEFAULT_TZ } from '../../../common/time/time.util';
import { returned } from '../../../common/db/parallel';
import { decodeGeohash, encodeGeohash } from '../../../common/geo/geohash';
import { haversineKm } from '../../../common/geo/bearing';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import {
  FoodDiscoveryService,
  SearchSignal,
} from '../../food/discovery/discovery.service';
import { NEGATIVE_END } from '../../food/orders/food-order-status';
import { normalizeQuery } from './query-norm';

/** A cell, query or curve with fewer events than this is never shown. */
export const DEMAND_K = 5;
/** The anonymous area curve needs at least this many other kitchens. */
export const CURVE_MIN_KITCHENS = 3;
/** Search events older than this are deleted (the cells stay). */
export const SEARCH_RETENTION_WEEKS = 26;
/** A search is placed in the city of the nearest kitchen within this distance. */
const CITY_REACH_M = 30_000;

const NEGATIVE = NEGATIVE_END.map((s) => `'${s}'`).join(', ');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Monday of the week containing `now`, Pakistan time. */
export const weekOf = (now: Date) =>
  DateTime.fromJSDate(now, { zone: DEFAULT_TZ }).startOf('week').toISODate()!;

const emptyMatrix = () =>
  Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

/**
 * The unmet-demand map and the hourly demand curve. Discovery reports every
 * home, list and search (FoodDiscoveryService.searchSinks) as an anonymous
 * search_events row; a nightly job rolls them up into demand_cells per week,
 * city and geohash6 cell. Vendors see their city's cells with many searches
 * and a high share that found nothing (or nothing open) — never a cell, query
 * or curve built from fewer than DEMAND_K events.
 */
@Injectable()
export class DemandService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discovery: FoodDiscoveryService,
  ) {}

  onModuleInit(): void {
    this.discovery.searchSinks.push((e) => this.log(e));
  }

  /** One anonymous row: the cell, the nearest kitchen's city, the cleaned query. */
  async log(e: SearchSignal) {
    const local = DateTime.fromJSDate(e.now, { zone: DEFAULT_TZ });
    await this.dataSource.query(
      `INSERT INTO search_events (kind, geohash6, city, query_norm, cuisine_id, results_count, open_results_count, hour, weekday, at)
       SELECT $1, $2,
              (SELECT br.city FROM branches br
                WHERE br.geo IS NOT NULL
                  AND ST_DWithin(br.geo, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography, ${CITY_REACH_M})
                ORDER BY br.geo <-> ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography LIMIT 1),
              $5, (SELECT id FROM cuisines WHERE slug = $6 OR id::text = $6 LIMIT 1),
              least($7::int, 32767), least($8::int, 32767), $9, $10, $11`,
      [
        e.kind,
        encodeGeohash(e.point.lat, e.point.lng, 6),
        e.point.lat,
        e.point.lng,
        normalizeQuery(e.q),
        e.cuisine ?? '',
        e.results,
        e.openResults,
        local.hour,
        local.weekday % 7,
        e.now,
      ],
    );
  }

  /**
   * Rebuild one week's cells (delete + insert, so a rerun is harmless):
   * searches, zero-result and closed-result counts and orders dropped in the
   * cell, for everything / per cuisine / per query, all day and per hour.
   */
  async rebuildWeek(m: EntityManager, week: string): Promise<number> {
    const from = DateTime.fromISO(week, { zone: DEFAULT_TZ });
    const params = [from.toJSDate(), from.plus({ weeks: 1 }).toJSDate(), week];
    await m.query(`DELETE FROM demand_cells WHERE week = $1`, [week]);
    const res = await m.query(
      `WITH s AS (
         SELECT city::text AS city, geohash6, cuisine_id, query_norm, hour, results_count, open_results_count
           FROM search_events WHERE at >= $1 AND at < $2 AND city IS NOT NULL
       ), agg AS (
         SELECT city, geohash6, cuisine_id, query_norm, hour,
                GROUPING(cuisine_id) AS gc, GROUPING(query_norm) AS gq, GROUPING(hour) AS gh,
                count(*)::int AS searches,
                count(*) FILTER (WHERE results_count = 0)::int AS zero,
                count(*) FILTER (WHERE results_count > 0 AND open_results_count = 0)::int AS closed
           FROM s
          GROUP BY GROUPING SETS ((city, geohash6), (city, geohash6, hour), (city, geohash6, cuisine_id),
                                  (city, geohash6, cuisine_id, hour), (city, geohash6, query_norm))
       ), o AS (
         SELECT fo.id, lower(br.city) AS city, ST_GeoHash(fo.drop_geo::geometry, 6) AS geohash6, c.cuisine_id,
                extract(hour FROM fo.created_at AT TIME ZONE '${DEFAULT_TZ}')::int AS hour
           FROM food_orders fo JOIN branches br ON br.id = fo.branch_id JOIN food_brands fb ON fb.id = fo.brand_id
           LEFT JOIN LATERAL unnest(fb.cuisine_ids) AS c(cuisine_id) ON true
          WHERE fo.created_at >= $1 AND fo.created_at < $2 AND fo.drop_geo IS NOT NULL
            AND fo.status NOT IN (${NEGATIVE})
       ), oagg AS (
         SELECT city, geohash6, cuisine_id, hour, GROUPING(cuisine_id) AS gc, GROUPING(hour) AS gh,
                count(DISTINCT id)::int AS orders
           FROM o
          GROUP BY GROUPING SETS ((city, geohash6), (city, geohash6, hour), (city, geohash6, cuisine_id),
                                  (city, geohash6, cuisine_id, hour))
       )
       INSERT INTO demand_cells (week, city, geohash6, dimension, cuisine_id, query_norm, hour,
                                 searches, zero_results, closed_results, orders, computed_at)
       SELECT $3::date, a.city, a.geohash6,
              (CASE WHEN a.gc = 0 THEN 'cuisine' WHEN a.gq = 0 THEN 'query' ELSE 'all' END)::demand_dimension,
              CASE WHEN a.gc = 0 THEN a.cuisine_id END, CASE WHEN a.gq = 0 THEN a.query_norm END,
              CASE WHEN a.gh = 0 THEN a.hour END,
              a.searches, a.zero, a.closed, coalesce(oa.orders, 0), now()
         FROM agg a
         LEFT JOIN oagg oa ON a.gq = 1 AND oa.city = lower(a.city) AND oa.geohash6 = a.geohash6
              AND oa.gc = a.gc AND oa.gh = a.gh
              AND (a.gc = 1 OR oa.cuisine_id = a.cuisine_id) AND (a.gh = 1 OR oa.hour = a.hour)
        WHERE NOT (a.gc = 0 AND a.cuisine_id IS NULL) AND NOT (a.gq = 0 AND a.query_norm IS NULL)
       RETURNING id`,
      params,
    );
    return returned(res).length;
  }

  /** The nightly job: this week and last week again, and old events purged. */
  async rebuild(m: EntityManager, now = new Date()) {
    const week = weekOf(now);
    const last = DateTime.fromISO(week).minus({ weeks: 1 }).toISODate()!;
    const cells =
      (await this.rebuildWeek(m, last)) + (await this.rebuildWeek(m, week));
    const purged = await m.query(
      `DELETE FROM search_events WHERE at < $1::timestamptz - interval '${SEARCH_RETENTION_WEEKS} weeks' RETURNING id`,
      [now],
    );
    return { cells, purged: returned(purged).length };
  }

  // ── Reading the map ─────────────────────────────────────────────────

  async map(opts: {
    city: string;
    week?: string;
    cuisineId?: string;
    hour?: number;
    origin?: { lat: number; lng: number; radiusKm: number };
  }) {
    const weeks: string[] = (
      await this.dataSource.query(
        `SELECT DISTINCT to_char(week, 'YYYY-MM-DD') AS week FROM demand_cells
          WHERE lower(city) = lower($1) ORDER BY week DESC LIMIT 8`,
        [opts.city],
      )
    ).map((r: { week: string }) => r.week);
    const week = opts.week ?? weeks[0] ?? null;
    const base = {
      city: opts.city,
      week,
      weeks,
      k: DEMAND_K,
      filters: { cuisineId: opts.cuisineId ?? null, hour: opts.hour ?? null },
    };
    if (!week) return { ...base, cells: [], hidden: 0, topQueries: [] };
    const rows: Array<{
      geohash6: string;
      searches: number;
      zero_results: number;
      closed_results: number;
      orders: number;
    }> = await this.dataSource.query(
      `SELECT geohash6, searches, zero_results, closed_results, orders FROM demand_cells
        WHERE lower(city) = lower($1) AND week = $2 AND dimension = $3
          AND cuisine_id IS NOT DISTINCT FROM $4::uuid AND hour IS NOT DISTINCT FROM $5::smallint`,
      [
        opts.city,
        week,
        opts.cuisineId ? 'cuisine' : 'all',
        opts.cuisineId ?? null,
        opts.hour ?? null,
      ],
    );
    const visible = rows.filter((r) => r.searches >= DEMAND_K);
    const cells = visible
      .map((r) => {
        const c = decodeGeohash(r.geohash6);
        const unmet = r.zero_results + r.closed_results;
        const distanceKm = opts.origin
          ? Math.round(haversineKm(opts.origin, c) * 10) / 10
          : null;
        return {
          geohash6: r.geohash6,
          center: { lat: r3(c.lat), lng: r3(c.lng) },
          bounds: c.bounds,
          searches: r.searches,
          zeroResultShare: r3(r.zero_results / r.searches),
          closedShare: r3(r.closed_results / r.searches),
          unmetSearches: unmet,
          orders: r.orders,
          ...(opts.origin
            ? {
                distanceKm,
                inYourZone: distanceKm! <= opts.origin.radiusKm,
              }
            : {}),
        };
      })
      .sort(
        (a, b) =>
          b.unmetSearches - a.unmetSearches ||
          b.searches - a.searches ||
          a.geohash6.localeCompare(b.geohash6),
      );
    const topQueries = await this.dataSource.query(
      `SELECT query_norm AS query, sum(searches)::int AS searches,
              round(sum(zero_results)::numeric / sum(searches), 3)::float AS "zeroResultShare",
              round(sum(closed_results)::numeric / sum(searches), 3)::float AS "closedShare"
         FROM demand_cells
        WHERE lower(city) = lower($1) AND week = $2 AND dimension = 'query'
        GROUP BY query_norm HAVING sum(searches) >= ${DEMAND_K}
        ORDER BY sum(zero_results + closed_results) DESC, sum(searches) DESC, query_norm LIMIT 10`,
      [opts.city, week],
    );
    return {
      ...base,
      cells,
      /** Cells with fewer than k searches: counted, never shown. */
      hidden: rows.length - visible.length,
      topQueries,
    };
  }

  async vendorMap(
    v: VendorRef,
    q: { week?: string; cuisineId?: string; hour?: number },
  ) {
    const [b] = await this.dataSource.query(
      `SELECT city, max_radius_km, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng FROM branches WHERE id = $1`,
      [v.branchId],
    );
    return this.map({
      city: b.city,
      ...q,
      origin:
        b.lat !== null
          ? { lat: b.lat, lng: b.lng, radiusKm: Number(b.max_radius_km) }
          : undefined,
    });
  }

  /** Cities with demand data (staff). */
  async cities() {
    const items = await this.dataSource.query(
      `SELECT city::text AS city, to_char(max(week), 'YYYY-MM-DD') AS "latestWeek", sum(searches)::int AS searches
         FROM demand_cells WHERE dimension = 'all' AND hour IS NULL
        GROUP BY city ORDER BY sum(searches) DESC, city`,
    );
    return { items };
  }

  // ── The hourly demand curve ─────────────────────────────────────────

  /**
   * Orders per weekday × hour over the last `weeks` weeks: the vendor's own,
   * and — when at least CURVE_MIN_KITCHENS other kitchens in the city share
   * a cuisine with it — theirs together (and per kitchen), never one of them.
   */
  async curve(v: VendorRef, weeks: number, now = new Date()) {
    const [b] = await this.dataSource.query(
      `SELECT br.city, br.timezone, fb.cuisine_ids FROM branches br JOIN food_brands fb ON fb.id = br.brand_id WHERE br.id = $1`,
      [v.branchId],
    );
    const since = new Date(now.getTime() - weeks * 7 * 86_400_000);
    const cell = `extract(dow FROM fo.created_at AT TIME ZONE $3)::int AS wd,
                  extract(hour FROM fo.created_at AT TIME ZONE $3)::int AS h`;
    const own = await this.dataSource.query(
      `SELECT ${cell}, count(*)::int AS n FROM food_orders fo
        WHERE fo.brand_id = $1 AND fo.created_at >= $2 AND fo.status NOT IN (${NEGATIVE})
        GROUP BY 1, 2`,
      [v.brandId, since, b.timezone],
    );
    const [{ kitchens }] = await this.dataSource.query(
      `SELECT count(DISTINCT fo.brand_id)::int AS kitchens
         FROM food_orders fo JOIN branches br ON br.id = fo.branch_id JOIN food_brands fb ON fb.id = fo.brand_id
        WHERE lower(br.city) = lower($1) AND fo.brand_id <> $2 AND fb.cuisine_ids && $3::uuid[]
          AND fo.created_at >= $4 AND fo.status NOT IN (${NEGATIVE})`,
      [b.city, v.brandId, b.cuisine_ids, since],
    );
    const ownMatrix = emptyMatrix();
    for (const r of own) ownMatrix[r.wd][r.h] = r.n;
    let area: {
      kitchens: number;
      orders: number[][];
      perKitchen: number[][];
    } | null = null;
    if (kitchens >= CURVE_MIN_KITCHENS) {
      const rows = await this.dataSource.query(
        `SELECT ${cell}, count(*)::int AS n
           FROM food_orders fo JOIN branches br ON br.id = fo.branch_id JOIN food_brands fb ON fb.id = fo.brand_id
          WHERE lower(br.city) = lower($1) AND fo.brand_id <> $2 AND fb.cuisine_ids && $4::uuid[]
            AND fo.created_at >= $5 AND fo.status NOT IN (${NEGATIVE})
          GROUP BY 1, 2`,
        [b.city, v.brandId, b.timezone, b.cuisine_ids, since],
      );
      const orders = emptyMatrix();
      for (const r of rows) orders[r.wd][r.h] = r.n;
      area = {
        kitchens,
        orders,
        perKitchen: orders.map((row) =>
          row.map((n) => Math.round((n / kitchens) * 10) / 10),
        ),
      };
    }
    const peaks = (m: number[][]) =>
      m
        .flatMap((row, weekday) => row.map((n, hour) => ({ weekday, hour, n })))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n || a.weekday - b.weekday || a.hour - b.hour)
        .slice(0, 3)
        .map(({ weekday, hour, n }) => ({ weekday, hour, orders: n }));
    return {
      weeks,
      city: b.city,
      timezone: b.timezone,
      /** Rows are weekdays (0 = Sunday), columns hours 0–23. */
      own: { orders: ownMatrix, peaks: peaks(ownMatrix) },
      area: area && { ...area, peaks: peaks(area.orders) },
      areaNote: area
        ? `Orders at ${kitchens} other kitchens in ${b.city} that cook what you cook.`
        : `Not enough kitchens like yours in ${b.city} yet to show an anonymous curve.`,
    };
  }
}
