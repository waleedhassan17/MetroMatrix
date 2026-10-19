import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import { Vendor, expectStatus, foodVendor, setUpVendor } from './utils/food';
import {
  acceptedOrder,
  dish,
  ingredient,
  onHand,
  override,
  recipe,
} from './utils/kitchen';
import { AiFakes, aiSettings, fakeAi, withFakeAi } from './utils/fake-ai';
import { KitchenJobsService } from '../src/modules/kitchen/jobs/kitchen-jobs.service';

/** Hyderabad (Sindh): only this suite puts vendors here. */
const HYD = { lat: 25.396, lng: 68.3578 };

let receiptSeq = 0;
const receipt = (userId: string) => {
  receiptSeq += 1;
  const publicId = `metromatrix/test/${userId}/receipt/r${receiptSeq}`;
  return {
    url: `https://res.cloudinary.com/metromatrix-test/image/authenticated/s--Rc12_ab-9--/v1712345678/${publicId}.jpg`,
    publicId,
  };
};

describe('Kitchen purchases, costing, price watch, waste, insight cards (Chunk 5 P2)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const buy = (v: Vendor, lines: object[], extra: object = {}) =>
    v.api.post('/food/vendor/kitchen/purchases', { lines, ...extra });

  beforeAll(async () => {
    f = fakeAi();
    t = await createTestApp({ override: withFakeAi(f) });
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    f.ai.reset();
    aiSettings(t).enabled = true;
    aiSettings(t).features = 'all';
  });

  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, { at: HYD }))!.status).toBe(200);
    return v;
  }

  it('weighted average cost is right after 3 purchases (with stock used in between)', async () => {
    const v = await kitchen('Buy Average Kitchen');
    const rice = await ingredient(v, { name: 'Rice', category: 'grain' });
    const p1 = await expectStatus(
      await buy(v, [
        { ingredientId: rice.id, qty: 10, unit: 'kg', totalPrice: 2000 },
      ]),
      201,
    );
    expect(p1).toMatchObject({
      total: 2000,
      source: 'manual',
      lines: [{ qtyBase: 10000, unitCost: 0.2, remaining: 10000 }],
    });
    await expectStatus(
      await buy(v, [
        { ingredientId: rice.id, qty: 5, unit: 'kg', totalPrice: 1500 },
      ]),
      201,
    );
    expect(
      (
        await expectStatus(
          await v.api.get(`/food/vendor/kitchen/ingredients/${rice.id}`),
          200,
        )
      ).avgCost,
    ).toBe(0.2333);
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/waste', {
        ingredientId: rice.id,
        qty: 9,
        unit: 'kg',
        reason: 'spoiled',
      }),
      201,
    );
    await expectStatus(
      await buy(v, [
        { ingredientId: rice.id, qty: 4, unit: 'kg', totalPrice: 1400 },
      ]),
      201,
    );
    const after = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/ingredients/${rice.id}`),
      200,
    );
    // (6 kg × 0.2333 + 4 kg × 0.35) / 10 kg
    expect(after).toMatchObject({
      onHand: 10000,
      avgCost: 0.28,
      lastCost: 0.35,
      avgPrice: { price: 280, per: 'kg' },
    });
    const list = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/purchases?ingredientId=${rice.id}`),
      200,
    );
    expect(list.total).toBe(3);
  });

  it('food cost % per size, and a price rise above target alerts the vendor and makes an insight card', async () => {
    const v = await kitchen('Buy Margin Kitchen');
    const chicken = await ingredient(v, { name: 'Chicken', category: 'meat' });
    await expectStatus(
      await buy(v, [
        { ingredientId: chicken.id, qty: 2, unit: 'kg', totalPrice: 1600 },
      ]),
      201,
    );
    const karahi = await dish(v, 'Mutton Karahi', 800, {
      variants: [
        { name: 'Half', price: 800 },
        { name: 'Full', price: 1500 },
      ],
    });
    const half = karahi.variants.find((x: any) => x.name === 'Half').id;
    const full = karahi.variants.find((x: any) => x.name === 'Full').id;
    await recipe(
      v,
      karahi.id,
      [{ ingredientId: chicken.id, qty: 250, unit: 'g' }],
      { variantId: half },
    );
    await recipe(
      v,
      karahi.id,
      [{ ingredientId: chicken.id, qty: 500, unit: 'g' }],
      { variantId: full },
    );
    const costing = await expectStatus(
      await v.api.get('/food/vendor/kitchen/costing'),
      200,
    );
    const rows = costing.items.filter((r: any) => r.itemId === karahi.id);
    expect(
      rows.map((r: any) => [
        r.variantName,
        r.cost,
        r.foodCostPct,
        r.margin,
        r.aboveTarget,
      ]),
    ).toEqual([
      ['Half', 200, 25, 600, false],
      ['Full', 400, 26.7, 1100, false],
    ]);
    expect(costing.targetFoodCostPct).toBe(35);

    // Chicken doubles in price: the average goes to Rs 1.6/g.
    await expectStatus(
      await buy(v, [
        { ingredientId: chicken.id, qty: 4, unit: 'kg', totalPrice: 8000 },
      ]),
      201,
    );
    const alerts = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'kitchen.food_cost_high' ORDER BY title`,
      [v.userId],
    );
    expect(alerts.map((a: any) => a.title)).toEqual([
      'Mutton Karahi (Full) now costs 53.3% of its price',
      'Mutton Karahi (Half) now costs 50% of its price',
    ]);
    const cards = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    const card = cards.find(
      (c: any) => c.kind === 'food_cost_high' && c.data.variantId === half,
    );
    expect(card).toMatchObject({
      title: 'Mutton Karahi (Half) costs 50% of its price',
      action: { screen: 'kitchen.costing', params: { itemId: karahi.id } },
    });
    // The week's baseline was taken on the first look: the trend compares to last week's.
    const [snap] = await sql(
      `SELECT count(*)::int AS n FROM item_cost_snapshots WHERE menu_item_id = $1`,
      [karahi.id],
    );
    expect(snap.n).toBe(2);
    // The nightly job is idempotent: twice in a row adds nothing.
    const jobs = t.app.get(KitchenJobsService);
    await jobs.costSnapshots();
    await jobs.costSnapshots();
    const [again] = await sql(
      `SELECT count(*)::int AS n FROM item_cost_snapshots WHERE menu_item_id = $1`,
      [karahi.id],
    );
    expect(again.n).toBe(2);
  });

  it('a purchase brings back a dish the stock hid — but not one the vendor took off', async () => {
    const v = await kitchen('Buy Restore Kitchen');
    const maida = await ingredient(v, {
      name: 'Maida',
      category: 'grain',
      openingStock: { qty: 200, unit: 'g' },
    });
    const paratha = await dish(v, 'Paratha', 300);
    const puri = await dish(v, 'Puri', 300);
    await recipe(v, paratha.id, [
      { ingredientId: maida.id, qty: 100, unit: 'g' },
    ]);
    await recipe(v, puri.id, [{ ingredientId: maida.id, qty: 100, unit: 'g' }]);
    await acceptedOrder(t, v, { itemId: paratha.id, quantity: 2 }, HYD);
    expect(await override(t, v, paratha.id)).toEqual({
      is_available: false,
      auto_reason: 'stock',
    });
    expect(await override(t, v, puri.id)).toEqual({
      is_available: false,
      auto_reason: 'stock',
    });
    const cards = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    expect(
      cards
        .filter((c: any) => c.kind === 'sold_out_by_stock')
        .map((c: any) => c.data.itemId)
        .sort(),
    ).toEqual([paratha.id, puri.id].sort());
    await expectStatus(
      await v.api.patch('/food/vendor/availability', {
        items: [{ itemId: puri.id, isAvailable: false }],
      }),
      200,
    );
    await expectStatus(
      await buy(v, [
        { ingredientId: maida.id, qty: 5, unit: 'kg', totalPrice: 900 },
      ]),
      201,
    );
    expect(await override(t, v, paratha.id)).toEqual({
      is_available: true,
      auto_reason: null,
    });
    expect(await override(t, v, puri.id)).toEqual({
      is_available: false,
      auto_reason: null,
    });
  });

  it('receipt scan: a bill photo → confirmable draft lines; unknown names offered as new ingredients; nothing saved', async () => {
    const v = await kitchen('Buy Scan Kitchen');
    const tomato = await ingredient(v, {
      name: 'Tomato',
      category: 'vegetable',
    });
    const onion = await ingredient(v, { name: 'Onion', category: 'vegetable' });
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/suppliers', {
        name: 'Ashraf Sabzi Mandi',
        phone: '03001234567',
      }),
      201,
    );
    const bill = receipt(v.userId);
    f.storage.put(bill.url, Buffer.from('jpeg-bytes'), 'image/jpeg');
    const answer = {
      supplier: 'Ashraf Sabzi',
      date: '2026-10-18',
      lines: [
        { name: 'tamatar', qty: 5, unit: 'kg', totalPrice: 1200 },
        { name: 'pyaz', qty: 3, unit: 'kg', totalPrice: 450 },
        { name: 'bhindi', qty: 2, unit: 'kg', totalPrice: 300 },
      ],
      total: 1950,
      confidence: 0.9,
    };
    f.ai.answer(answer);
    const scan = await expectStatus(
      await v.api.post('/food/vendor/kitchen/purchases/scan', {
        imageUrl: bill.url,
        publicId: bill.publicId,
      }),
      200,
    );
    expect(
      f.ai.calls[0].parts.some(
        (p) => 'inline' in p && p.inline.mimeType === 'image/jpeg',
      ),
    ).toBe(true);
    expect(scan).toMatchObject({
      supplier: { name: 'Ashraf Sabzi Mandi' },
      linesTotal: 1950,
      totalMismatch: false,
      proposedAction: null,
      needsConfirmation: true,
      lines: [
        {
          spoken: 'tamatar',
          status: 'ok',
          ingredientId: tomato.id,
          qtyBase: 5000,
          totalPrice: 1200,
        },
        { spoken: 'pyaz', status: 'ok', ingredientId: onion.id, qtyBase: 3000 },
        {
          spoken: 'bhindi',
          status: 'UNKNOWN_INGREDIENT',
          suggestedName: 'okra',
        },
      ],
    });
    expect(
      (
        await sql(
          `SELECT count(*)::int AS n FROM purchases WHERE branch_id = $1`,
          [v.branchId],
        )
      )[0].n,
    ).toBe(0);

    await ingredient(v, { name: 'Okra', category: 'vegetable' });
    f.ai.answer(answer);
    const again = await expectStatus(
      await v.api.post('/food/vendor/kitchen/purchases/scan', {
        imageUrl: bill.url,
      }),
      200,
    );
    expect(again.proposedAction).toMatchObject({
      method: 'POST',
      path: '/food/vendor/kitchen/purchases',
    });
    const saved = await expectStatus(
      await v.api.post(
        '/food/vendor/kitchen/purchases',
        again.proposedAction.body,
      ),
      201,
    );
    expect(saved).toMatchObject({
      source: 'receipt_scan',
      total: 1950,
      supplier: { name: 'Ashraf Sabzi Mandi' },
    });
    expect(saved.purchasedAt.slice(0, 10)).toBe('2026-10-18');
    expect(saved.receiptDownload.downloadUrl).toContain('api.cloudinary.com');

    // AI off → the manual path.
    aiSettings(t).enabled = false;
    const off = await v.api.post('/food/vendor/kitchen/purchases/scan', {
      imageUrl: bill.url,
    });
    expect(off.status).toBe(503);
    expect(off.body.error.details.manual).toMatch(/Type the bill/);
  });

  it('voice purchase "5 kilo tamatar 1200 rupay" → a draft line tomato 5000 g, Rs 1,200', async () => {
    const v = await kitchen('Buy Voice Kitchen');
    const tomato = await ingredient(v, {
      name: 'Tomato',
      category: 'vegetable',
    });
    aiSettings(t).enabled = false; // the rule parser reads typed text
    const out = await expectStatus(
      await v.api.post('/ai/voice', {
        context: 'purchase',
        text: '5 kilo tamatar 1200 rupay',
      }),
      200,
    );
    expect(out).toMatchObject({
      intent: 'add_purchase',
      draft: {
        lines: [
          {
            ingredientId: tomato.id,
            name: 'Tomato',
            qtyBase: 5000,
            display: { qty: 5, unit: 'kg' },
            totalPrice: 1200,
          },
        ],
      },
      proposedAction: {
        method: 'POST',
        path: '/food/vendor/kitchen/purchases',
        body: {
          source: 'voice',
          lines: [
            { ingredientId: tomato.id, qty: 5, unit: 'kg', totalPrice: 1200 },
          ],
        },
        summary: 'Purchase: Tomato 5 kg Rs 1,200 — Rs 1,200',
      },
    });
    expect(await onHand(t, tomato.id)).toBe(0);
    const waste = await expectStatus(
      await v.api.post('/ai/voice', {
        context: 'stock',
        text: 'do kilo tamatar kharab ho gaye',
      }),
      200,
    );
    expect(waste.proposedAction).toMatchObject({
      path: '/food/vendor/kitchen/waste',
      body: { ingredientId: tomato.id, qty: 2, unit: 'kg', reason: 'spoiled' },
    });
  });

  it('SPI CSV import for two cities; price watch flags a price 15% over the city and a 10% weekly rise', async () => {
    const v = await kitchen('Buy Watch Kitchen');
    const other = await kitchen('Buy Watch Other');
    const csv = [
      'week_ending,city,item,unit,price',
      '2026-10-08,Lahore,Tomatoes,kg,150',
      '2026-10-15,Lahore,Tomatoes,kg,180',
      '2026-10-15,Karachi,Tomatoes,kg,200',
      '2026-10-15,Lahore,Onions,kg,120',
      '2026-10-15,Karachi,Onions,kg,110',
      '2026-10-15,Lahore,Cooking Oil,tin,2600',
    ].join('\n');
    const imp = await expectStatus(
      await admin.api.post('/admin/kitchen/reference-prices/import', { csv }),
      200,
    );
    expect(imp).toMatchObject({
      items: 2,
      prices: 5,
      cities: ['Lahore', 'Karachi'],
      rejected: 1,
      errors: [{ line: 7 }],
    });
    expect(
      (await v.api.post('/admin/kitchen/reference-prices/import', { csv }))
        .status,
    ).toBe(403);
    const [audit] = await sql(
      `SELECT action FROM operational_audit_events WHERE action = 'kitchen.reference_prices.import' LIMIT 1`,
    );
    expect(audit).toBeDefined();

    const tomato = await ingredient(v, {
      name: 'Tomato',
      category: 'vegetable',
    });
    await expectStatus(
      await buy(v, [
        { ingredientId: tomato.id, qty: 5, unit: 'kg', totalPrice: 1200 },
      ]),
      201,
    );
    const before = await expectStatus(
      await v.api.get('/food/vendor/kitchen/price-watch'),
      200,
    );
    expect(before.items).toEqual([]);
    const sug = before.suggestions.find(
      (s: any) => s.ingredientId === tomato.id,
    );
    expect(sug.reference.name).toBe('Tomatoes');
    expect(
      (
        await other.api.patch(
          `/food/vendor/kitchen/ingredients/${tomato.id}/reference`,
          { referenceItemId: sug.reference.id },
        )
      ).status,
    ).toBe(404);
    await expectStatus(
      await v.api.patch(
        `/food/vendor/kitchen/ingredients/${tomato.id}/reference`,
        { referenceItemId: sug.reference.id },
      ),
      200,
    );
    const watch = await expectStatus(
      await v.api.get('/food/vendor/kitchen/price-watch'),
      200,
    );
    expect(watch).toMatchObject({ city: 'Lahore' });
    expect(watch.items[0]).toMatchObject({
      name: 'Tomato',
      referencePrice: 180,
      yourPrice: 240,
      pctAbove: 33.3,
      weekChangePct: 20,
      aboveReference: true,
      referenceRising: true,
    });
    const cards = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    expect(cards.map((c: any) => c.kind)).toEqual(
      expect.arrayContaining(['price_above_reference', 'reference_rising']),
    );
  });

  it('waste: ingredients at FIFO cost, dishes through their recipe, summary by reason; a used purchase can’t be deleted', async () => {
    const v = await kitchen('Buy Waste Kitchen');
    const other = await kitchen('Buy Waste Other');
    const oil = await ingredient(v, {
      name: 'Oil',
      category: 'oil',
      baseUnit: 'ml',
    });
    const p = await expectStatus(
      await buy(v, [
        { ingredientId: oil.id, qty: 5, unit: 'l', totalPrice: 3000 },
      ]),
      201,
    );
    const p2 = await expectStatus(
      await buy(v, [
        { ingredientId: oil.id, qty: 1, unit: 'l', totalPrice: 700 },
      ]),
      201,
    );
    const pakora = await dish(v, 'Pakora', 300);
    await recipe(
      v,
      pakora.id,
      [{ ingredientId: oil.id, qty: 100, unit: 'ml' }],
      { yieldServings: 2 },
    );
    const w1 = await expectStatus(
      await v.api.post('/food/vendor/kitchen/waste', {
        ingredientId: oil.id,
        qty: 500,
        unit: 'ml',
        reason: 'expired',
      }),
      201,
    );
    expect(w1).toMatchObject({
      kind: 'ingredient',
      name: 'Oil',
      cost: 300,
      reason: 'expired',
    });
    const w2 = await expectStatus(
      await v.api.post('/food/vendor/kitchen/waste', {
        menuItemId: pakora.id,
        qty: 4,
        unit: 'servings',
        reason: 'leftover',
      }),
      201,
    );
    expect(w2).toMatchObject({
      kind: 'dish',
      name: 'Pakora',
      unit: 'serving',
      cost: 120,
    });
    expect(await onHand(t, oil.id)).toBe(5300);
    const bad = await v.api.post('/food/vendor/kitchen/waste', {
      menuItemId: pakora.id,
      qty: 1,
      unit: 'kg',
      reason: 'other',
    });
    expect(bad.body.error.code).toBe('UNIT_MISMATCH');
    expect(
      (
        await other.api.post('/food/vendor/kitchen/waste', {
          ingredientId: oil.id,
          qty: 1,
          unit: 'l',
          reason: 'other',
        })
      ).status,
    ).toBe(404);
    const sum = await expectStatus(
      await v.api.get('/food/vendor/kitchen/waste/summary?range=7d'),
      200,
    );
    expect(sum).toMatchObject({ range: '7d', totalCost: 420, entries: 2 });
    expect(sum.byReason.map((r: any) => [r.reason, r.cost])).toEqual([
      ['expired', 300],
      ['leftover', 120],
    ]);
    const list = await expectStatus(
      await v.api.get('/food/vendor/kitchen/waste?reason=expired'),
      200,
    );
    expect(list.total).toBe(1);

    // The first purchase has been drawn on (FIFO) → can't be deleted; the second is untouched → can.
    expect(
      (await v.api.delete(`/food/vendor/kitchen/purchases/${p.id}`)).status,
    ).toBe(409);
    expect(
      await expectStatus(
        await v.api.delete(`/food/vendor/kitchen/purchases/${p2.id}`),
        200,
      ),
    ).toEqual({ removed: true });
    const after = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/ingredients/${oil.id}`),
      200,
    );
    expect(after).toMatchObject({ onHand: 4300, avgCost: 0.6 });
    expect(
      (await other.api.get(`/food/vendor/kitchen/purchases/${p.id}`)).status,
    ).toBe(404);
  });

  it('kitchen settings: target food cost and the packing-photo switch', async () => {
    const v = await kitchen('Buy Settings Kitchen');
    expect(
      await expectStatus(await v.api.get('/food/vendor/kitchen/settings'), 200),
    ).toEqual({
      targetFoodCostPct: 35,
      requirePackingPhoto: false,
    });
    expect(
      await expectStatus(
        await v.api.patch('/food/vendor/kitchen/settings', {
          targetFoodCostPct: 30,
          requirePackingPhoto: true,
        }),
        200,
      ),
    ).toEqual({ targetFoodCostPct: 30, requirePackingPhoto: true });
    expect(
      (
        await v.api.patch('/food/vendor/kitchen/settings', {
          targetFoodCostPct: 99,
        })
      ).status,
    ).toBe(400);
  });
});
