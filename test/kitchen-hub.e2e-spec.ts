import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import { expectStatus, foodVendor, setUpVendor, Vendor } from './utils/food';
import { dish, ingredient, recipe } from './utils/kitchen';
import { addDays, todayIn } from '../src/common/time/time.util';

/** Sialkot: only this suite puts vendors here. */
const SKT = { lat: 32.4945, lng: 74.5229 };

describe('Kitchen hub: summary, board, card snooze', () => {
  let t: TestApp;
  let admin: Admin;
  let v: Vendor;
  let other: Vendor;
  let flour: { id: string };
  let roti: { id: string };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    v = await foodVendor(t, admin, 'restaurant', 'Hub Tandoor');
    other = await foodVendor(t, admin, 'restaurant', 'Hub Neighbour');
    for (const k of [v, other])
      expect((await setUpVendor(t, k, { at: SKT }))!.status).toBe(200);
    // 300 g of flour and 100 g a roti: the stock makes 3.
    flour = await ingredient(v, {
      name: 'Hub flour',
      category: 'grain',
      openingStock: {
        qty: 300,
        unit: 'g',
        totalCost: 60,
        expiresOn: addDays(todayIn('Asia/Karachi'), 1),
      },
    });
    roti = await dish(v, 'Hub roti', 40);
    await recipe(v, roti.id, [{ ingredientId: flour.id, qty: 100, unit: 'g' }]);
  });
  afterAll(() => t.close());

  it('the board: a dish running low, then sold out by stock; the prep time; the packing rule', async () => {
    let board = await expectStatus(
      await v.api.get('/food/vendor/kitchen/board'),
      200,
    );
    expect(board.lowStock).toEqual([
      { itemId: roti.id, name: 'Hub roti', servings: 3 },
    ]);
    expect(board.soldOutByStock).toEqual([]);
    expect(board.prep).toEqual({
      minutes: expect.any(Number),
      source: 'configured',
    });
    expect(board.requirePackingPhoto).toBe(false);

    // Counted out: the dish sells out by stock and leaves "running low".
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/stock/count', {
        lines: [{ ingredientId: flour.id, qty: 0, unit: 'g' }],
      }),
      200,
    );
    await expectStatus(
      await v.api.patch('/food/vendor/kitchen/settings', {
        requirePackingPhoto: true,
      }),
      200,
    );
    board = await expectStatus(
      await v.api.get('/food/vendor/kitchen/board'),
      200,
    );
    expect(board.lowStock).toEqual([]);
    expect(board.soldOutByStock).toEqual([
      { itemId: roti.id, name: 'Hub roti' },
    ]);
    expect(board.requirePackingPhoto).toBe(true);
    // The other kitchen's board knows nothing of it.
    const theirs = await expectStatus(
      await other.api.get('/food/vendor/kitchen/board'),
      200,
    );
    expect([...theirs.lowStock, ...theirs.soldOutByStock]).toEqual([]);

    // Back in stock for the rest of the suite.
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/purchases', {
        lines: [
          {
            ingredientId: flour.id,
            qty: 2,
            unit: 'kg',
            totalPrice: 400,
            expiresOn: addDays(todayIn('Asia/Karachi'), 1),
          },
        ],
      }),
      201,
    );
  });

  it('the summary: each number is the one its screen shows', async () => {
    const s = await expectStatus(
      await v.api.get('/food/vendor/kitchen/summary'),
      200,
    );
    const stock = await expectStatus(
      await v.api.get('/food/vendor/kitchen/stock'),
      200,
    );
    const costing = await expectStatus(
      await v.api.get('/food/vendor/kitchen/costing'),
      200,
    );
    const today = todayIn('Asia/Karachi');
    expect(s.date).toBe(today);
    expect(s.stock).toEqual({
      ingredients: stock.summary.ingredients,
      value: stock.summary.value,
      belowPar: stock.summary.belowPar,
      negative: stock.summary.negative,
      expiring: stock.summary.expiringIn3Days,
      attention: 0,
    });
    expect(s.stock.expiring).toBe(1);
    expect(s.recipes).toEqual({
      dishes: costing.summary.dishes,
      withRecipe: costing.summary.withRecipe,
      withoutRecipe: costing.summary.dishes - costing.summary.withRecipe,
      aboveTarget: costing.summary.aboveTarget,
      avgFoodCostPct: costing.summary.avgFoodCostPct,
      targetFoodCostPct: 35,
    });
    expect(s.purchases).toEqual({ weekTotal: 400, weekCount: 1 });
    expect(s.forecast).toMatchObject({
      date: addDays(today, 1),
      learning: expect.any(Boolean),
    });
    expect(s.waste).toEqual({ weekCost: 0, mealsRescued: 0 });
    // Demand is the vendor's own map: unmet searches in its zone on the newest week (other
    // suites search in this city too).
    const map = await expectStatus(
      await v.api.get('/food/vendor/demand-map'),
      200,
    );
    expect(s.growth.demand).toEqual({
      week: map.week ?? null,
      unmetSearches: map.cells
        .filter((c: { inYourZone: boolean }) => c.inYourZone)
        .reduce(
          (n: number, c: { unmetSearches: number }) => n + c.unmetSearches,
          0,
        ),
    });
    expect({ ...s.growth, demand: null }).toEqual({
      experiments: { running: 0, results: 0 },
      tiffin: { plans: 0, subscribers: 0, requested: 0, mealsTomorrow: 0 },
      catering: { requested: 0, upcoming: 0 },
      storefront: { days: 30, orders: 0 },
      demand: null,
      hygiene: null,
      ramadan: { enabled: false, period: expect.any(String) },
    });
  });

  it('a snoozed card stays away for a day, for this kitchen only', async () => {
    const cards = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    const expiring = cards.find(
      (c: { kind: string }) => c.kind === 'expiring_stock',
    );
    expect(expiring.key).toBe(`expiring_stock:${flour.id}`);
    const snoozed = await expectStatus(
      await v.api.post(
        `/food/vendor/kitchen/insights/cards/${encodeURIComponent(expiring.key)}/snooze`,
      ),
      200,
    );
    expect(snoozed.key).toBe(expiring.key);
    const hours =
      (new Date(snoozed.snoozedUntil).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    const after = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    expect(after.map((c: { key: string }) => c.key)).not.toContain(
      expiring.key,
    );
    // The other kitchen snoozing the same key changes nothing here (and isn't an error).
    await expectStatus(
      await other.api.post(
        `/food/vendor/kitchen/insights/cards/${encodeURIComponent(expiring.key)}/snooze`,
      ),
      200,
    );
    // A key that isn't one.
    const bad = await v.api.post(
      '/food/vendor/kitchen/insights/cards/DROP%20TABLE/snooze',
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });
});
