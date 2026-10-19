import { createTestApp, ApiClient, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import {
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  liveHomeKitchen,
  setUpVendor,
} from './utils/food';
import { dish, ingredient, recipe } from './utils/kitchen';
import { KitchenJobsService } from '../src/modules/kitchen/jobs/kitchen-jobs.service';
import { FoodJobsService } from '../src/modules/food/jobs/food-jobs.service';
import { ServiceabilityService } from '../src/modules/food/availability/serviceability.service';
import { BranchStateService } from '../src/modules/food/availability/branch-state.service';

/** Bahawalpur: only this suite puts vendors here. */
const BWP = { lat: 29.3956, lng: 71.6836 };

describe('Kitchen forecast, prep sheet, shopping list, smart ETA, outage pause (Chunk 5 P3)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: KitchenJobsService;
  let food: FoodJobsService;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    jobs = t.app.get(KitchenJobsService);
    food = t.app.get(FoodJobsService);
  });
  afterAll(() => t.close());

  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, { at: BWP }))!.status).toBe(200);
    return v;
  }

  /** n COD orders of one item from one customer, each moved through to ready. */
  async function orders(
    v: Vendor,
    item: string,
    n: number,
    upTo: 'placed' | 'ready' = 'ready',
  ) {
    let c = await foodCustomer(t, BWP);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      // Checkout is throttled per address: a new customer every 5 orders.
      if (i > 0 && i % 5 === 0) c = await foodCustomer(t, BWP);
      await expectStatus(
        await c.api.post('/food/cart/items', {
          vendorId: v.brandId,
          itemId: item,
          quantity: 1,
        }),
        201,
      );
      const o = await expectStatus(await checkout(c), 201);
      ids.push(o.id);
      if (upTo === 'ready') {
        await expectStatus(
          await v.api.post(`/food/vendor/orders/${o.id}/accept`, {}),
          200,
        );
        await expectStatus(
          await v.api.post(`/food/vendor/orders/${o.id}/preparing`),
          200,
        );
        await expectStatus(
          await v.api.post(`/food/vendor/orders/${o.id}/ready`),
          200,
        );
      }
    }
    return ids;
  }

  it('with 10 days of history the forecast is `learning` with a wide band; the nightly job is idempotent', async () => {
    const v = await kitchen('Forecast Learning Kitchen');
    const karahi = await itemId(t, v);
    await sql(
      `UPDATE branches SET went_live_at = now() - interval '10 days' WHERE id = $1`,
      [v.branchId],
    );
    const ids = await orders(v, karahi, 5, 'placed');
    // Spread them over the last 10 days: 2 days ago ×2, 4 days ago ×3.
    await sql(
      `UPDATE food_orders SET created_at = now() - interval '2 days' WHERE id = ANY($1::uuid[])`,
      [ids.slice(0, 2)],
    );
    await sql(
      `UPDATE food_orders SET created_at = now() - interval '4 days' WHERE id = ANY($1::uuid[])`,
      [ids.slice(2)],
    );
    await jobs.forecastBranch(v.branchId);
    await jobs.forecastBranch(v.branchId);
    const f = await expectStatus(
      await v.api.get('/food/vendor/kitchen/forecast?days=7'),
      200,
    );
    expect(f.learning).toBe(true);
    const rows = f.items.filter((r: any) => r.itemId === karahi);
    expect(rows).toHaveLength(7);
    // Last 7 days: 5 sold → 5/7 a day.
    expect(rows[0]).toMatchObject({
      method: 'learning',
      label: 'Learning your patterns',
      expected: 0.7,
      low: 0.4,
      high: 1.1,
    });
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM demand_forecasts WHERE branch_id = $1`,
      [v.branchId],
    );
    expect(n).toBe(7);
  });

  it('prep sheet = planned portions × recipe lines; shopping list = need − stock + 10% (topped up to par)', async () => {
    const v = await kitchen('Forecast Prep Kitchen');
    const other = await kitchen('Forecast Prep Other');
    const rice = await ingredient(v, {
      name: 'Rice',
      category: 'grain',
      openingStock: { qty: 1, unit: 'kg' },
    });
    const chicken = await ingredient(v, {
      name: 'Chicken',
      category: 'meat',
      parLevel: { qty: 3, unit: 'kg' },
      openingStock: { qty: 2, unit: 'kg' },
    });
    const biryani = await dish(v, 'Chicken Biryani', 650);
    await recipe(
      v,
      biryani.id,
      [
        { ingredientId: rice.id, qty: 1, unit: 'kg' },
        { ingredientId: chicken.id, qty: 0.8, unit: 'kg' },
      ],
      { yieldServings: 4 },
    );
    await jobs.forecastBranch(v.branchId);
    const f = await expectStatus(
      await v.api.get('/food/vendor/kitchen/forecast?days=2'),
      200,
    );
    const tomorrow = f.items.find(
      (r: any) => r.itemId === biryani.id && r.date !== f.from,
    );
    expect(
      (
        await other.api.patch(`/food/vendor/kitchen/forecast/${tomorrow.id}`, {
          adjusted: 10,
        })
      ).status,
    ).toBe(404);
    await expectStatus(
      await v.api.patch(`/food/vendor/kitchen/forecast/${tomorrow.id}`, {
        adjusted: 10,
      }),
      200,
    );

    const prep = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/prep-sheet?date=${tomorrow.date}`),
      200,
    );
    expect(prep.dishes.find((d: any) => d.itemId === biryani.id)).toMatchObject(
      { planned: 10, adjusted: 10, hasRecipe: true },
    );
    const lines = prep.ingredients.flatMap((g: any) =>
      g.lines.map((l: any) => ({ ...l, category: g.category })),
    );
    // 10 portions × (1 kg ÷ 4) rice, 10 × (0.8 kg ÷ 4) chicken
    expect(lines.find((l: any) => l.ingredientId === rice.id)).toMatchObject({
      category: 'grain',
      need: 2500,
      needDisplay: { qty: 2.5, unit: 'kg' },
      inStock: 1000,
      short: 1500,
    });
    expect(lines.find((l: any) => l.ingredientId === chicken.id)).toMatchObject(
      { need: 2000, inStock: 2000, short: 0 },
    );
    expect(prep.dishesWithoutRecipe).toEqual([]);

    const list = await expectStatus(
      await v.api.get(
        `/food/vendor/kitchen/shopping-list?date=${tomorrow.date}`,
      ),
      200,
    );
    expect(
      list.lines.find((l: any) => l.ingredientId === rice.id),
    ).toMatchObject({ toBuy: 1750, reason: 'plan' });
    // Chicken: 2 kg needed + 3 kg par − 2 kg on hand
    expect(
      list.lines.find((l: any) => l.ingredientId === chicken.id),
    ).toMatchObject({ toBuy: 3000, reason: 'par_level' });
    expect(list.text).toContain('• Rice: 1.75 kg');
    expect(list.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);

    const cards = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    expect(cards.find((c: any) => c.kind === 'forecast_gap')).toMatchObject({
      action: { screen: 'kitchen.shopping-list' },
    });
  });

  it('home kitchens: suggested portions = forecast high capped by stock, applied for tomorrow', async () => {
    const v = await liveHomeKitchen(t, admin, 'Forecast Home Kitchen', {
      at: BWP,
    });
    const karahi = await itemId(t, v);
    const chicken = await ingredient(v, {
      name: 'Chicken',
      category: 'meat',
      openingStock: { qty: 1.5, unit: 'kg' },
    });
    await recipe(v, karahi, [
      { ingredientId: chicken.id, qty: 250, unit: 'g' },
    ]);
    await jobs.forecastBranch(v.branchId);
    const f = await expectStatus(
      await v.api.get('/food/vendor/kitchen/forecast?days=2'),
      200,
    );
    const tomorrow = f.items.find(
      (r: any) => r.itemId === karahi && r.date !== f.from,
    );
    await expectStatus(
      await v.api.patch(`/food/vendor/kitchen/forecast/${tomorrow.id}`, {
        adjusted: 9,
      }),
      200,
    );
    const s = await expectStatus(
      await v.api.get(
        `/food/vendor/kitchen/portions/suggestions?date=${tomorrow.date}`,
      ),
      200,
    );
    expect(s.items.find((i: any) => i.itemId === karahi)).toMatchObject({
      fromForecast: 9,
      fromStock: 6,
      suggested: 6,
      cappedByStock: true,
    });
    const applied = await expectStatus(
      await v.api.post('/food/vendor/kitchen/portions/apply-suggestion', {
        date: tomorrow.date,
      }),
      200,
    );
    expect(applied.applied).toEqual([
      { itemId: karahi, name: 'Chicken Karahi', portions: 6 },
    ]);
    const [o] = await sql(
      `SELECT daily_limit FROM branch_item_overrides WHERE branch_id = $1 AND item_id = $2`,
      [v.branchId, karahi],
    );
    expect(o.daily_limit).toBe(6);
    const bad = await v.api.post(
      '/food/vendor/kitchen/portions/apply-suggestion',
      { date: '2020-01-01' },
    );
    expect(bad.status).toBe(400);
  });

  it('smart ETA: quotes use the p75 of real prep times once an hour-and-size bucket has 20 samples', async () => {
    const v = await kitchen('Forecast ETA Kitchen');
    const karahi = await itemId(t, v);
    const ids = await orders(v, karahi, 20);
    // Prep times 21..40 minutes, all accepted in the current hour.
    await sql(
      `UPDATE food_orders o SET accepted_at = date_trunc('hour', now()) + interval '1 minute',
              ready_at = date_trunc('hour', now()) + interval '1 minute' + make_interval(mins => x.n + 20)
         FROM (SELECT id, row_number() OVER (ORDER BY created_at, id)::int AS n FROM food_orders WHERE id = ANY($1::uuid[])) x
        WHERE o.id = x.id`,
      [ids],
    );
    const svc = t.app.get(ServiceabilityService);
    const state = t.app.get(BranchStateService);
    const quote = async () => {
      const b = (await svc.branch(v.branchId, BWP))!;
      const s = (await state.schedules([v.branchId])).get(v.branchId)!;
      return svc.quote(b, s, 'delivery', { items: 1 });
    };
    // 19 samples: still the vendor's own prep minutes.
    await sql(`UPDATE food_orders SET ready_at = NULL WHERE id = $1`, [
      ids[19],
    ]);
    await food.recomputePrepStats();
    expect(await quote()).toMatchObject({
      prepSource: 'configured',
      prepMinutes: 20,
    });
    await sql(
      `UPDATE food_orders SET ready_at = date_trunc('hour', now()) + interval '41 minutes' WHERE id = $1`,
      [ids[19]],
    );
    await food.recomputePrepStats();
    const q = await quote();
    // p75 of 21..40 = 35.25 → 35
    expect(q).toMatchObject({ prepSource: 'learned', prepMinutes: 35 });
    const eta = await expectStatus(
      await v.api.get('/food/vendor/kitchen/eta-accuracy'),
      200,
    );
    expect(eta.learned).toEqual([
      expect.objectContaining({
        size: '1-2',
        p75: 35,
        samples: 20,
        inUse: true,
      }),
    ]);
  });

  it('outage pause "gas", 30 minutes: customers see when it’s back but never why; it resumes by itself', async () => {
    const v = await kitchen('Forecast Pause Kitchen');
    const p = await expectStatus(
      await v.api.post('/food/vendor/pause', { reason: 'gas', minutes: 30 }),
      200,
    );
    expect(p.branch).toMatchObject({ isPaused: true, pauseReason: 'gas' });
    expect(p.branch.pauseMessage).toMatch(
      /^Temporarily paused · back around \d{1,2}:\d{2} (AM|PM)$/,
    );
    const [{ slug }] = await sql(`SELECT slug FROM food_brands WHERE id = $1`, [
      v.brandId,
    ]);
    const page = await expectStatus(
      await new ApiClient(t.http).get(
        `/food/vendors/${slug}?lat=${BWP.lat}&lng=${BWP.lng}`,
      ),
      200,
    );
    expect(JSON.stringify(page)).toContain('Temporarily paused · back around');
    expect(JSON.stringify(page)).not.toMatch(/gas/i);

    await food.autoResume(new Date(Date.now() + 10 * 60_000));
    expect(
      (
        await sql(`SELECT is_paused FROM branches WHERE id = $1`, [v.branchId])
      )[0].is_paused,
    ).toBe(true);
    await food.autoResume(new Date(Date.now() + 31 * 60_000));
    await food.autoResume(new Date(Date.now() + 31 * 60_000));
    const [b] = await sql(
      `SELECT is_paused, pause_reason, auto_resume_at, pause_message FROM branches WHERE id = $1`,
      [v.branchId],
    );
    expect(b).toEqual({
      is_paused: false,
      pause_reason: null,
      auto_resume_at: null,
      pause_message: null,
    });
  });

  it('yesterday’s forecast is scored (MAPE) the next night', async () => {
    const v = await kitchen('Forecast Accuracy Kitchen');
    const karahi = await itemId(t, v);
    const [b] = await sql(
      `SELECT (now() AT TIME ZONE timezone)::date - 1 AS y FROM branches WHERE id = $1`,
      [v.branchId],
    );
    await sql(
      `INSERT INTO demand_forecasts (branch_id, menu_item_id, for_date, expected, low, high, method, generated_at)
       VALUES ($1, $2, $3, 4, 2, 6, 'weighted', now())`,
      [v.branchId, karahi, b.y],
    );
    const ids = await orders(v, karahi, 2, 'placed');
    await sql(
      `UPDATE food_orders SET created_at = now() - interval '1 day' WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await jobs.forecastBranch(v.branchId);
    const f = await expectStatus(
      await v.api.get('/food/vendor/kitchen/forecast'),
      200,
    );
    // |2 − 4| ÷ 2 = 100%
    expect(f.accuracy.recent[0]).toMatchObject({ mape: 100, items: 1 });
    expect(f.accuracy.mape14d).toBe(100);
  });
});
