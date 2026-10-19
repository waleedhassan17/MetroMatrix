import { DateTime } from 'luxon';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import {
  Vendor,
  checkout,
  cuisineIds,
  expectStatus,
  foodCustomer,
  foodVendor,
  setUpVendor,
} from './utils/food';
import { dish, ingredient, recipe } from './utils/kitchen';
import { encodeGeohash } from '../src/common/geo/geohash';
import { GrowthJobsService } from '../src/modules/food-growth/jobs/growth-jobs.service';
import { KitchenJobsService } from '../src/modules/kitchen/jobs/kitchen-jobs.service';

/** Gilgit: only this suite puts vendors (and searches) here. */
const GIL = { lat: 35.9208, lng: 74.3089 };
const TZ = 'Asia/Karachi';
const KM_LAT = 0.008993;
const KM_LNG = KM_LAT / Math.cos((GIL.lat * Math.PI) / 180);
/** A point `n` km north and `e` km east of the Gilgit kitchens. */
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const at = (n: number, e = 0) => ({
  lat: r6(GIL.lat + n * KM_LAT),
  lng: r6(GIL.lng + e * KM_LNG),
});
const day = (n: number) =>
  DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;

describe('Demand map, demand curve, menu engineering, experiments, rider batching (Chunk 5 P8)', () => {
  let t: TestApp;
  let admin: Admin;
  let anon: ApiClient;
  let growthJobs: GrowthJobsService;
  let kitchenJobs: KitchenJobsService;
  let seq = 0;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    anon = new ApiClient(t.http);
    growthJobs = t.app.get(GrowthJobsService);
    kitchenJobs = t.app.get(KitchenJobsService);
  });
  afterAll(() => t.close());

  async function kitchen(name: string, cuisines = ['pakistani', 'karahi']) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    const live = await setUpVendor(t, v, {
      at: GIL,
      cuisines,
      settings: { city: 'Gilgit', area: 'Jutial', codLimit: 50000 },
    });
    expect(live!.status).toBe(200);
    return v;
  }

  async function order(
    v: Vendor,
    lines: Array<[string, number]>,
    point = at(0.5),
  ) {
    const c = await foodCustomer(t, point);
    for (const [itemId, quantity] of lines)
      await expectStatus(
        await c.api.post('/food/cart/items', {
          vendorId: v.brandId,
          itemId,
          quantity,
        }),
        201,
      );
    return expectStatus(await checkout(c), 201);
  }

  it('search events are anonymous: no user column, a geohash6 cell, cleaned text (QA #26 basis)', async () => {
    await kitchen('Demand Probe Kitchen');
    const cols = (
      await sql(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'search_events'`,
      )
    ).map((r: any) => r.column_name);
    expect(cols).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/user|ip|device|token|lat|lng/),
      ]),
    );
    const c = await foodCustomer(t, at(-2.2));
    const p = at(-2.2);
    await expectStatus(
      await c.api.get(
        `/food/search?q=${encodeURIComponent('Biryani 03001234567!')}&lat=${p.lat}&lng=${p.lng}`,
      ),
      200,
    );
    const [row] = await sql(
      `SELECT kind, geohash6, city::text AS city, query_norm, results_count FROM search_events
        WHERE geohash6 = $1 AND kind = 'search' ORDER BY at DESC LIMIT 1`,
      [encodeGeohash(p.lat, p.lng)],
    );
    expect(row).toEqual({
      kind: 'search',
      geohash6: encodeGeohash(p.lat, p.lng),
      city: 'Gilgit',
      query_norm: 'biryani',
      results_count: 0,
    });
    // The same cell PostGIS computes.
    const [{ gh }] = await sql(
      `SELECT ST_GeoHash(ST_SetSRID(ST_MakePoint($2, $1), 4326), 6) AS gh`,
      [p.lat, p.lng],
    );
    expect(gh).toBe(row.geohash6);
    // A cuisine filter is kept as the cuisine id.
    const [karahi] = await cuisineIds(t, 'karahi');
    await expectStatus(
      await anon.get(`/food/vendors?lat=${p.lat}&lng=${p.lng}&cuisine=karahi`),
      200,
    );
    const [list] = await sql(
      `SELECT cuisine_id, results_count FROM search_events WHERE geohash6 = $1 AND kind = 'list' ORDER BY at DESC LIMIT 1`,
      [row.geohash6],
    );
    expect(list.cuisine_id).toBe(karahi);
    expect(list.results_count).toBeGreaterThan(0);
  });

  it('demand cells: under 5 searches hidden; zero-result share and orders; rebuild twice is the same (QA #25 basis)', async () => {
    const v = await kitchen('Demand Map Kitchen');
    const A = at(3.1, 1.3);
    const B = at(-3.4, -1.1);
    for (let i = 0; i < 6; i++)
      await expectStatus(
        await anon.get(`/food/search?q=pizza&lat=${A.lat}&lng=${A.lng}`),
        200,
      );
    for (let i = 0; i < 3; i++)
      await expectStatus(
        await anon.get(`/food/search?q=pizza&lat=${B.lat}&lng=${B.lng}`),
        200,
      );
    const [karahi] = await sql(
      `SELECT id FROM menu_items WHERE brand_id = $1 LIMIT 1`,
      [v.brandId],
    );
    await order(v, [[karahi.id, 1]], A);
    const first = await growthJobs.demand();
    expect(first.cells).toBeGreaterThan(0);
    const again = await growthJobs.demand();
    expect(again.cells).toBe(first.cells);

    const map = await expectStatus(
      await v.api.get('/food/vendor/demand-map'),
      200,
    );
    const cellA = map.cells.find(
      (c: any) => c.geohash6 === encodeGeohash(A.lat, A.lng),
    );
    expect(cellA).toMatchObject({
      searches: 6,
      zeroResultShare: 1,
      closedShare: 0,
      unmetSearches: 6,
      orders: 1,
      inYourZone: true,
    });
    expect(cellA.distanceKm).toBeCloseTo(3.4, 0);
    expect(map.cells.map((c: any) => c.geohash6)).not.toContain(
      encodeGeohash(B.lat, B.lng),
    );
    expect(map.hidden).toBeGreaterThanOrEqual(1);
    expect(map.k).toBe(5);
    expect(map.topQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query: 'pizza',
          searches: 9,
          zeroResultShare: 1,
        }),
      ]),
    );
    const hour = DateTime.now().setZone(TZ).hour;
    const byHour = await expectStatus(
      await v.api.get(`/food/vendor/demand-map?hour=${hour}`),
      200,
    );
    expect(byHour.cells.map((c: any) => c.geohash6)).toContain(cellA.geohash6);
    const otherHour = await expectStatus(
      await v.api.get(`/food/vendor/demand-map?hour=${(hour + 12) % 24}`),
      200,
    );
    expect(otherHour.cells.map((c: any) => c.geohash6)).not.toContain(
      cellA.geohash6,
    );

    // Staff see the platform view; vendors can't.
    expect((await v.api.get('/admin/food/demand-map?city=Gilgit')).status).toBe(
      403,
    );
    const platform = await expectStatus(
      await admin.api.get('/admin/food/demand-map?city=Gilgit'),
      200,
    );
    expect(
      platform.cells.find((c: any) => c.geohash6 === cellA.geohash6),
    ).toMatchObject({
      searches: 6,
    });
    expect(platform.cells[0].distanceKm).toBeUndefined();
    const cities = await expectStatus(
      await admin.api.get('/admin/food/demand-map/cities'),
      200,
    );
    expect(cities.items.map((c: any) => c.city)).toContain('Gilgit');
  });

  it('demand curve: own orders by weekday × hour; the area only with 3+ kitchens like yours', async () => {
    const v = await kitchen('Curve Kitchen', ['bbq']);
    const [own] = await sql(
      `SELECT id FROM menu_items WHERE brand_id = $1 LIMIT 1`,
      [v.brandId],
    );
    await order(v, [[own.id, 1]]);
    const now = DateTime.now().setZone(TZ);
    const wd = now.weekday % 7;
    const alone = await expectStatus(
      await v.api.get('/food/vendor/demand-curve'),
      200,
    );
    expect(alone.own.orders[wd][now.hour]).toBe(1);
    expect(alone.own.peaks[0]).toEqual({
      weekday: wd,
      hour: now.hour,
      orders: 1,
    });
    expect(alone.area).toBeNull();
    expect(alone.areaNote).toMatch(/Not enough kitchens/);
    for (const name of ['Curve BBQ Two', 'Curve BBQ Three', 'Curve BBQ Four']) {
      const o = await kitchen(name, ['bbq', 'pakistani']);
      const [item] = await sql(
        `SELECT id FROM menu_items WHERE brand_id = $1 LIMIT 1`,
        [o.brandId],
      );
      await order(o, [[item.id, 1]]);
    }
    const area = await expectStatus(
      await v.api.get('/food/vendor/demand-curve?weeks=4'),
      200,
    );
    expect(area).toMatchObject({ weeks: 4, area: { kitchens: 3 } });
    expect(area.area.orders[wd][now.hour]).toBe(3);
    expect(area.area.perKitchen[wd][now.hour]).toBe(1);
    expect(area.own.orders[wd][now.hour]).toBe(1);
  });

  it('menu engineering: quadrants match the hand calculation; no recipe card → listed apart (QA #27 basis)', async () => {
    const v = await kitchen('Engineering Kitchen');
    const mix = await ingredient(v, {
      name: 'Kitchen mix',
      openingStock: { qty: 10, unit: 'kg', totalCost: 10000 },
    });
    const make = async (name: string, price: number, grams: number | null) => {
      const d = await dish(v, `${name} ${++seq}`, price);
      if (grams)
        await recipe(v, d.id, [
          { ingredientId: mix.id, qty: grams, unit: 'g' },
        ]);
      return d;
    };
    // margin = price − grams × Rs 1: 300, 150, 420, 100.
    const karahi = await make('Karahi', 500, 200);
    const daal = await make('Daal', 250, 100);
    const pulao = await make('Pulao', 600, 180);
    const roll = await make('Roll', 150, 50);
    const kheer = await make('Kheer', 200, null);
    const o1 = await order(v, [
      [karahi.id, 12],
      [roll.id, 2],
    ]);
    const o2 = await order(v, [
      [daal.id, 9],
      [pulao.id, 4],
      [kheer.id, 7],
    ]);
    await sql(
      `UPDATE food_orders SET status = 'delivered', created_at = now() - interval '2 days' WHERE id = ANY($1::uuid[])`,
      [[o1.id, o2.id]],
    );
    const m = await expectStatus(
      await v.api.get('/food/vendor/kitchen/menu-engineering'),
      200,
    );
    expect(m).toMatchObject({
      days: 30,
      medianQty: 6.5,
      medianMargin: 225,
      counts: { star: 1, plowhorse: 1, puzzle: 1, dog: 1 },
    });
    const q = Object.fromEntries(
      m.items.map((i: any) => [i.itemId, [i.quadrant, i.action]]),
    );
    expect(q).toEqual({
      [karahi.id]: ['star', 'feature'],
      [daal.id]: ['plowhorse', 'reprice'],
      [pulao.id]: ['puzzle', 'redescribe_or_bundle'],
      [roll.id]: ['dog', 'remove'],
    });
    expect(m.needsRecipe).toEqual(
      expect.arrayContaining([
        {
          itemId: kheer.id,
          name: kheer.name,
          qty: 7,
          message: 'Add a recipe card to analyse',
        },
      ]),
    );

    // An experiment on the Puzzle: sales vs the category's median dish.
    const exp = await expectStatus(
      await v.api.post('/food/vendor/kitchen/experiments', {
        itemId: pulao.id,
        days: 7,
        startsOn: day(-5),
        notes: 'New photo',
      }),
      201,
    );
    // 4 in 5 days = 0.8 a day; others 12, 9, 2, 7, 0 → 2.4, 1.8, 0.4, 1.4, 0 → median 1.4.
    expect(exp).toMatchObject({
      status: 'running',
      startsOn: day(-5),
      endsOn: day(1),
      result: {
        days: 5,
        sold: 4,
        itemDaily: 0.8,
        categoryMedianDaily: 1.4,
        salesIndex: 0.57,
        foodCostPct: 30,
        recommendation: 'adjust',
      },
    });
    const dup = await v.api.post('/food/vendor/kitchen/experiments', {
      itemId: pulao.id,
      days: 5,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const stranger = await kitchen('Engineering Stranger');
    expect(
      (await stranger.api.get(`/food/vendor/kitchen/experiments/${exp.id}`))
        .status,
    ).toBe(404);

    // The last day passes: the nightly job stores the result once.
    await expectStatus(
      await v.api.patch(`/food/vendor/kitchen/experiments/${exp.id}`, {
        endsOn: day(-1),
      }),
      200,
    );
    expect(await kitchenJobs.experiments()).toMatchObject({ completed: 1 });
    expect(await kitchenJobs.experiments()).toMatchObject({ completed: 0 });
    const done = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/experiments/${exp.id}`),
      200,
    );
    expect(done).toMatchObject({
      status: 'completed',
      result: { days: 5, recommendation: 'adjust', through: day(-1) },
    });
    const list = await expectStatus(
      await v.api.get('/food/vendor/kitchen/experiments?status=completed'),
      200,
    );
    expect(list.items.map((x: any) => x.id)).toEqual([exp.id]);

    const planned = await expectStatus(
      await v.api.post('/food/vendor/kitchen/experiments', {
        itemId: roll.id,
        days: 3,
        startsOn: day(2),
      }),
      201,
    );
    expect(planned).toMatchObject({ status: 'planned', result: null });
    const early = await v.api.post(
      `/food/vendor/kitchen/experiments/${planned.id}/end`,
    );
    expect(early.status).toBe(409);
    const cancelled = await expectStatus(
      await v.api.delete(`/food/vendor/kitchen/experiments/${planned.id}`),
      200,
    );
    expect(cancelled.status).toBe('cancelled');
    expect(
      (await v.api.delete(`/food/vendor/kitchen/experiments/${planned.id}`))
        .status,
    ).toBe(409);
  });

  it('rider batching: only drops within 2 km whose bearing differs ≤ 45° (QA #28 basis)', async () => {
    const v = await kitchen('Batching Kitchen');
    const [item] = await sql(
      `SELECT id FROM menu_items WHERE brand_id = $1 LIMIT 1`,
      [v.brandId],
    );
    const place = (p: { lat: number; lng: number }) =>
      order(v, [[item.id, 1]], p);
    const a = await place(at(1.5)); // north
    const b = await place(at(1.5, 0.8)); // 0.8 km from A, bearing ≈ 28°
    const c = await place(at(-1.5)); // south
    const d = await place(at(3.6)); // north, 2.1 km beyond A
    const e = await place(at(1.0, 1.2)); // 1.3 km from A, bearing ≈ 50°
    await sql(
      `UPDATE food_orders SET status = 'ready' WHERE id = ANY($1::uuid[])`,
      [[a.id, b.id, c.id, d.id, e.id]],
    );
    const s = await expectStatus(
      await v.api.get(`/food/vendor/riders/suggest?orderId=${a.id}`),
      200,
    );
    expect(s.batchWith).toEqual([
      expect.objectContaining({
        orderId: b.id,
        code: b.code,
        dropSequence: [a.code, b.code],
      }),
    ]);
    const [batch] = s.batchWith;
    expect(batch.dropsApartKm).toBeCloseTo(0.8, 1);
    expect(batch.bearingDiff).toBeLessThanOrEqual(45);
    expect(batch.bearingDiff).toBeGreaterThan(20);
    expect(batch.extraKm).toBeCloseTo(0.8, 1);
    // Assigned or not ready: no longer a candidate.
    await sql(`UPDATE food_orders SET status = 'preparing' WHERE id = $1`, [
      b.id,
    ]);
    const none = await expectStatus(
      await v.api.get(`/food/vendor/riders/suggest?orderId=${a.id}`),
      200,
    );
    expect(none.batchWith).toEqual([]);
  });
});
