import { DateTime } from 'luxon';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import { approvedDoctor } from './utils/health';
import {
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
} from './utils/food';
import {
  acceptedOrder,
  dish,
  ingredient,
  onHand,
  override,
  recipe,
} from './utils/kitchen';
import {
  AiFakes,
  aiSettings,
  fakeAi,
  voiceClip,
  withFakeAi,
} from './utils/fake-ai';
import { KitchenJobsService } from '../src/modules/kitchen/jobs/kitchen-jobs.service';
import { KitchenAlertsService } from '../src/modules/kitchen/stock/kitchen-alerts.service';
import { OrderStockService } from '../src/modules/kitchen/stock/order-stock.service';
import { FoodJobsService } from '../src/modules/food/jobs/food-jobs.service';
import { AiJobsService } from '../src/modules/ai/ai-jobs.service';
import { ServiceabilityService } from '../src/modules/food/availability/serviceability.service';
import { BranchStateService } from '../src/modules/food/availability/branch-state.service';

/** Abbottabad: only this suite puts vendors here. */
const ATD = { lat: 34.1688, lng: 73.2215 };
const TZ = 'Asia/Karachi';

const answer = (
  intent: string,
  slots: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  language: 'ur',
  intent,
  slots,
  confidence: 0.92,
  ...extra,
});

/**
 * Chunk 5's release gate: one test per row of the Kitchen Intelligence QA
 * matrix (spec §8). Milestone 5A: rows 1–19 and 36–38. Add rows; never
 * delete them. Tests never call a real model (FakeAiProvider).
 */
describe('QA matrix — Kitchen Intelligence (Chunk 5)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  let kitchenJobs: KitchenJobsService;
  let foodJobs: FoodJobsService;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const anon = () => new ApiClient(t.http);
  let seq = 0;

  beforeAll(async () => {
    f = fakeAi();
    t = await createTestApp({ override: withFakeAi(f) });
    admin = await enrolledAdmin(t);
    kitchenJobs = t.app.get(KitchenJobsService);
    foodJobs = t.app.get(FoodJobsService);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    f.ai.reset();
    const s = aiSettings(t);
    s.enabled = true;
    s.features = 'all';
    s.timeoutMs = 12_000;
  });

  async function kitchen(name: string, settings: Record<string, unknown> = {}) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, { at: ATD, settings }))!.status).toBe(200);
    return v;
  }

  async function placed(v: Vendor, item: string, quantity = 1) {
    const c = await foodCustomer(t, ATD);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: item,
        quantity,
      }),
      201,
    );
    return { c, o: await expectStatus(await checkout(c), 201) };
  }

  async function spoken(v: Vendor, context: string, ai: object) {
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    f.ai.answer(ai);
    return v.api.post('/ai/voice', {
      context,
      audioUrl: clip.url,
      publicId: clip.publicId,
      durationSeconds: 3,
      languageHint: 'ur',
    });
  }

  const window = (minutes = 60) => {
    const now = DateTime.now().setZone(TZ);
    const end = DateTime.min(
      now.plus({ minutes }),
      now.endOf('day').minus({ seconds: 30 }),
    );
    return { pickupFrom: now.toISO()!, pickupTo: end.toISO()! };
  };

  const reserve = (c: { api: ApiClient }, boxId: string) =>
    c.api
      .post(`/food/surplus/${boxId}/reserve`, { quantity: 1 })
      .set('Idempotency-Key', `qa-bb-${Date.now()}-${++seq}`);

  it('QA #1 Urdu voice "order accept karo bees minute" on the board → proposed accept, 20 min, executed only when confirmed', async () => {
    const v = await kitchen('QA1 Voice Board');
    const { o } = await placed(v, await itemId(t, v));
    const res = await expectStatus(
      await spoken(
        v,
        'board',
        answer(
          'accept',
          { etaMinutes: 20 },
          { transcript: 'order accept karo bees minute' },
        ),
      ),
      200,
    );
    expect(res).toMatchObject({
      transcript: 'order accept karo bees minute',
      intent: 'accept',
      needsConfirmation: true,
      proposedAction: {
        method: 'POST',
        path: `/food/vendor/orders/${o.id}/accept`,
        body: { etaMinutes: 20 },
      },
    });
    expect(
      (await sql(`SELECT status FROM food_orders WHERE id = $1`, [o.id]))[0]
        .status,
    ).toBe('placed');
    await expectStatus(
      await v.api.post(res.proposedAction.path, res.proposedAction.body),
      200,
    );
    expect(
      (
        await sql(`SELECT status, eta_minutes FROM food_orders WHERE id = $1`, [
          o.id,
        ])
      )[0],
    ).toEqual({ status: 'accepted', eta_minutes: 20 });
  });

  it('QA #2 English voice "biryani is finished" → proposed mark_unavailable for the matched dish', async () => {
    const v = await kitchen('QA2 Voice Finished');
    const biryani = await dish(v, 'Chicken Biryani', 650);
    const res = await expectStatus(
      await spoken(
        v,
        'board',
        answer(
          'mark_unavailable',
          { dish: 'biryani' },
          { language: 'en', transcript: 'biryani is finished' },
        ),
      ),
      200,
    );
    expect(res.proposedAction).toEqual({
      method: 'PATCH',
      path: '/food/vendor/availability',
      body: { items: [{ itemId: biryani.id, isAvailable: false }] },
      summary: 'Mark Chicken Biryani sold out',
    });
    // The rule parser reads the same English words.
    aiSettings(t).enabled = false;
    const typed = await expectStatus(
      await v.api.post('/ai/voice', {
        context: 'board',
        text: 'biryani is finished',
      }),
      200,
    );
    expect(typed).toMatchObject({
      source: 'rules',
      intent: 'mark_unavailable',
      proposedAction: { body: { items: [{ itemId: biryani.id }] } },
    });
  });

  it('QA #3 unclear audio → VOICE_UNCLEAR with a retry hint', async () => {
    const v = await kitchen('QA3 Voice Unclear');
    const res = await spoken(
      v,
      'board',
      answer('unknown', {}, { confidence: 0.1, transcript: 'hmm… haan… woh' }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'VOICE_UNCLEAR',
      details: { hint: expect.stringMatching(/^Try/) },
    });
  });

  it('QA #4 voice purchase "5 kilo tamatar 1200 rupay" → draft line tomato 5000 g, Rs 1,200', async () => {
    const v = await kitchen('QA4 Voice Purchase');
    const tomato = await ingredient(v, {
      name: 'Tomato',
      category: 'vegetable',
    });
    f.ai.answer(
      answer('add_purchase', {
        lines: [{ name: 'tamatar', qty: 5, unit: 'kg', totalPrice: 1200 }],
      }),
    );
    const res = await expectStatus(
      await v.api.post('/ai/voice', {
        context: 'purchase',
        text: '5 kilo tamatar 1200 rupay',
      }),
      200,
    );
    expect(res.draft.lines).toEqual([
      expect.objectContaining({
        ingredientId: tomato.id,
        name: 'Tomato',
        qtyBase: 5000,
        baseUnit: 'g',
        totalPrice: 1200,
      }),
    ]);
    expect(res.proposedAction.summary).toBe(
      'Purchase: Tomato 5 kg Rs 1,200 — Rs 1,200',
    );
    expect(await onHand(t, tomato.id)).toBe(0);
  });

  it('QA #5 AI disabled → every AI endpoint returns its manual path / AI_UNAVAILABLE; ordering is unaffected', async () => {
    const v = await kitchen('QA5 AI Off');
    aiSettings(t).enabled = false;
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    const voice = await v.api.post('/ai/voice', {
      context: 'board',
      audioUrl: clip.url,
      durationSeconds: 3,
    });
    expect(voice.status).toBe(503);
    expect(voice.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { manual: expect.any(String) },
    });
    const bill = {
      url: `https://res.cloudinary.com/metromatrix-test/image/authenticated/s--Qa12_ab-9--/v1/metromatrix/test/${v.userId}/receipt/qa5.jpg`,
    };
    const scan = await v.api.post('/food/vendor/kitchen/purchases/scan', {
      imageUrl: bill.url,
    });
    expect(scan.status).toBe(503);
    expect(scan.body.error.details.manual).toMatch(/Type the bill/);
    // Typed voice still works (rules), packing photos still save (no AI check), orders flow.
    expect(
      (
        await expectStatus(
          await v.api.post('/ai/voice', {
            context: 'board',
            text: 'busy das minute',
          }),
          200,
        )
      ).source,
    ).toBe('rules');
    const { o } = await placed(v, await itemId(t, v));
    await expectStatus(
      await v.api.post(`/food/vendor/orders/${o.id}/accept`, {}),
      200,
    );
    await expectStatus(
      await v.api.post(`/food/vendor/orders/${o.id}/preparing`),
      200,
    );
    const photo = asset(v.userId, 'packing_proof');
    const proof = await expectStatus(
      await v.api.post(`/food/vendor/kitchen/orders/${o.id}/packing-proof`, {
        photoUrl: photo.url,
      }),
      200,
    );
    expect(proof.aiCheck).toBeNull();
    expect(f.ai.calls).toHaveLength(0);
  });

  it('QA #6 quota exhausted → AI_QUOTA_REACHED with the reset date', async () => {
    const v = await kitchen('QA6 Quota');
    await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
        overrides: { limits: { ai_actions_month: 0 } },
      }),
      200,
    );
    const res = await v.api.post('/ai/voice', {
      context: 'board',
      text: 'order accept karo',
    });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: 'AI_QUOTA_REACHED',
      details: {
        key: 'ai_actions_month',
        limit: 0,
        resetsOn: DateTime.now()
          .setZone(TZ)
          .startOf('month')
          .plus({ months: 1 })
          .toISODate(),
      },
    });
  });

  it('QA #7 accepting an order with recipe cards deducts FIFO and writes movements', async () => {
    const v = await kitchen('QA7 FIFO');
    const rice = await ingredient(v, {
      name: 'Rice',
      category: 'grain',
      openingStock: { qty: 400, unit: 'g', totalCost: 80 },
    });
    await sql(
      `UPDATE stock_batches SET received_at = now() - interval '2 days' WHERE ingredient_id = $1`,
      [rice.id],
    );
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/purchases', {
        lines: [{ ingredientId: rice.id, qty: 1, unit: 'kg', totalPrice: 300 }],
      }),
      201,
    );
    const biryani = await dish(v, 'Biryani', 650);
    await recipe(v, biryani.id, [
      { ingredientId: rice.id, qty: 250, unit: 'g' },
    ]);
    const { o } = await acceptedOrder(
      t,
      v,
      { itemId: biryani.id, quantity: 3 },
      ATD,
    );
    const moves = await sql(
      `SELECT delta::float AS delta, unit_cost::float AS cost, reason FROM stock_movements WHERE ref_id = $1 ORDER BY balance_after DESC`,
      [o.id],
    );
    expect(moves).toEqual([
      { delta: -400, cost: 0.2, reason: 'order' },
      { delta: -350, cost: 0.3, reason: 'order' },
    ]);
    expect(await onHand(t, rice.id)).toBe(650);
  });

  it('QA #8 an ingredient hitting zero hides the dish and tells the vendor; a purchase brings it back', async () => {
    const v = await kitchen('QA8 Zero');
    const dough = await ingredient(v, {
      name: 'Dough',
      category: 'bakery',
      openingStock: { qty: 300, unit: 'g' },
    });
    const naan = await dish(v, 'Naan Platter', 400);
    await recipe(v, naan.id, [{ ingredientId: dough.id, qty: 300, unit: 'g' }]);
    await acceptedOrder(t, v, { itemId: naan.id }, ATD);
    expect(await override(t, v, naan.id)).toEqual({
      is_available: false,
      auto_reason: 'stock',
    });
    const [n] = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'kitchen.sold_out_stock'`,
      [v.userId],
    );
    expect(n.title).toBe('Naan Platter is sold out');
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/purchases', {
        lines: [
          { ingredientId: dough.id, qty: 2, unit: 'kg', totalPrice: 300 },
        ],
      }),
      201,
    );
    expect(await override(t, v, naan.id)).toEqual({
      is_available: true,
      auto_reason: null,
    });
  });

  it('QA #9 a manual sold-out stays unavailable after a purchase', async () => {
    const v = await kitchen('QA9 Manual');
    const beef = await ingredient(v, { name: 'Beef', category: 'meat' });
    const nihari = await dish(v, 'Nihari', 700);
    await expectStatus(
      await v.api.patch('/food/vendor/availability', {
        items: [{ itemId: nihari.id, isAvailable: false }],
      }),
      200,
    );
    await recipe(v, nihari.id, [
      { ingredientId: beef.id, qty: 250, unit: 'g' },
    ]);
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/purchases', {
        lines: [
          { ingredientId: beef.id, qty: 5, unit: 'kg', totalPrice: 6000 },
        ],
      }),
      201,
    );
    expect(await override(t, v, nihari.id)).toEqual({
      is_available: false,
      auto_reason: null,
    });
  });

  it('QA #10 weighted average cost is right after 3 purchases', async () => {
    const v = await kitchen('QA10 Average');
    const oil = await ingredient(v, {
      name: 'Oil',
      category: 'oil',
      baseUnit: 'ml',
    });
    for (const [qty, total] of [
      [10, 5000],
      [5, 3000],
      [5, 3500],
    ])
      await expectStatus(
        await v.api.post('/food/vendor/kitchen/purchases', {
          lines: [{ ingredientId: oil.id, qty, unit: 'l', totalPrice: total }],
        }),
        201,
      );
    // (10 l × 0.5 + 5 l × 0.6 + 5 l × 0.7) / 20 l
    expect(
      await expectStatus(
        await v.api.get(`/food/vendor/kitchen/ingredients/${oil.id}`),
        200,
      ),
    ).toMatchObject({
      onHand: 20000,
      avgCost: 0.575,
      avgPrice: { price: 575, per: 'l' },
    });
  });

  it('QA #11 food cost above target → an insight card with an action', async () => {
    const v = await kitchen('QA11 Food Cost');
    const mutton = await ingredient(v, { name: 'Mutton', category: 'meat' });
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/purchases', {
        lines: [
          { ingredientId: mutton.id, qty: 1, unit: 'kg', totalPrice: 2400 },
        ],
      }),
      201,
    );
    const karahi = await dish(v, 'Mutton Karahi', 1000);
    await recipe(v, karahi.id, [
      { ingredientId: mutton.id, qty: 250, unit: 'g' },
    ]);
    const cards = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    expect(cards.find((c: any) => c.kind === 'food_cost_high')).toMatchObject({
      title: 'Mutton Karahi costs 60% of its price',
      action: {
        label: 'Open costing',
        screen: 'kitchen.costing',
        params: { itemId: karahi.id },
      },
    });
  });

  it('QA #12 forecast with 10 days of history → learning, wide band', async () => {
    const v = await kitchen('QA12 Learning');
    const karahi = (await dish(v, 'Daal Roti', 250)).id;
    await sql(
      `UPDATE branches SET went_live_at = now() - interval '10 days' WHERE id = $1`,
      [v.branchId],
    );
    const { o } = await placed(v, karahi, 7);
    await sql(
      `UPDATE food_orders SET created_at = now() - interval '3 days' WHERE id = $1`,
      [o.id],
    );
    await kitchenJobs.forecastBranch(v.branchId);
    const fc = await expectStatus(
      await v.api.get('/food/vendor/kitchen/forecast?days=1'),
      200,
    );
    expect(fc.learning).toBe(true);
    expect(fc.items.find((r: any) => r.itemId === karahi)).toMatchObject({
      method: 'learning',
      expected: 1,
      low: 0.5,
      high: 1.6,
    });
  });

  it('QA #13 prep sheet: ingredients = forecast × recipe lines', async () => {
    const v = await kitchen('QA13 Prep');
    const rice = await ingredient(v, { name: 'Rice', category: 'grain' });
    const pulao = await dish(v, 'Pulao', 500);
    await recipe(v, pulao.id, [{ ingredientId: rice.id, qty: 180, unit: 'g' }]);
    await kitchenJobs.forecastBranch(v.branchId);
    const fc = await expectStatus(
      await v.api.get('/food/vendor/kitchen/forecast?days=2'),
      200,
    );
    const row = fc.items.find(
      (r: any) => r.itemId === pulao.id && r.date !== fc.from,
    );
    await expectStatus(
      await v.api.patch(`/food/vendor/kitchen/forecast/${row.id}`, {
        adjusted: 12,
      }),
      200,
    );
    const prep = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/prep-sheet?date=${row.date}`),
      200,
    );
    const line = prep.ingredients
      .flatMap((g: any) => g.lines)
      .find((l: any) => l.ingredientId === rice.id);
    expect(line.need).toBe(12 * 180);
  });

  it('QA #14 shopping list: need − stock + 10% buffer', async () => {
    const v = await kitchen('QA14 Shopping');
    const flour = await ingredient(v, {
      name: 'Flour',
      category: 'grain',
      openingStock: { qty: 500, unit: 'g' },
    });
    const puri = await dish(v, 'Puri Plate', 300);
    await recipe(v, puri.id, [{ ingredientId: flour.id, qty: 100, unit: 'g' }]);
    await kitchenJobs.forecastBranch(v.branchId);
    const fc = await expectStatus(
      await v.api.get('/food/vendor/kitchen/forecast?days=2'),
      200,
    );
    const row = fc.items.find(
      (r: any) => r.itemId === puri.id && r.date !== fc.from,
    );
    await expectStatus(
      await v.api.patch(`/food/vendor/kitchen/forecast/${row.id}`, {
        adjusted: 20,
      }),
      200,
    );
    const list = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/shopping-list?date=${row.date}`),
      200,
    );
    // 2000 g × 1.1 − 500 g
    expect(
      list.lines.find((l: any) => l.ingredientId === flour.id),
    ).toMatchObject({ need: 2000, inStock: 500, toBuy: 1700 });
  });

  it('QA #15 smart ETA uses the p75 once there are ≥ 20 samples', async () => {
    const v = await kitchen('QA15 Smart ETA');
    const karahi = await itemId(t, v);
    const ids: string[] = [];
    let c = await foodCustomer(t, ATD);
    for (let i = 0; i < 20; i++) {
      if (i && i % 5 === 0) c = await foodCustomer(t, ATD);
      await expectStatus(
        await c.api.post('/food/cart/items', {
          vendorId: v.brandId,
          itemId: karahi,
          quantity: 1,
        }),
        201,
      );
      const o = await expectStatus(await checkout(c), 201);
      for (const step of ['accept', 'preparing', 'ready'])
        await expectStatus(
          await v.api.post(`/food/vendor/orders/${o.id}/${step}`),
          200,
        );
      ids.push(o.id);
    }
    await sql(
      `UPDATE food_orders SET accepted_at = date_trunc('hour', now()) + interval '1 minute',
              ready_at = date_trunc('hour', now()) + interval '41 minutes' WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await foodJobs.recomputePrepStats();
    const svc = t.app.get(ServiceabilityService);
    const b = (await svc.branch(v.branchId, ATD))!;
    const s = (await t.app.get(BranchStateService).schedules([v.branchId])).get(
      v.branchId,
    )!;
    expect(svc.quote(b, s, 'delivery', { items: 1 })).toMatchObject({
      prepSource: 'learned',
      prepMinutes: 40,
    });
  });

  it('QA #16 pause "gas" for 30 min → auto-resume; customers never see the reason', async () => {
    const v = await kitchen('QA16 Pause');
    await expectStatus(
      await v.api.post('/food/vendor/pause', { reason: 'gas', minutes: 30 }),
      200,
    );
    const [{ slug }] = await sql(`SELECT slug FROM food_brands WHERE id = $1`, [
      v.brandId,
    ]);
    const page = await expectStatus(
      await anon().get(`/food/vendors/${slug}`),
      200,
    );
    expect(JSON.stringify(page)).toContain('back around');
    expect(JSON.stringify(page)).not.toMatch(/gas/i);
    await foodJobs.autoResume(new Date(Date.now() + 31 * 60_000));
    expect(
      (
        await sql(
          `SELECT is_paused, pause_reason FROM branches WHERE id = $1`,
          [v.branchId],
        )
      )[0],
    ).toEqual({ is_paused: false, pause_reason: null });
  });

  it('QA #17 the last Bachat Box race → one success, the other SURPLUS_SOLD_OUT', async () => {
    const v = await kitchen('QA17 Last Box');
    const box = await expectStatus(
      await v.api.post('/food/vendor/kitchen/surplus-boxes', {
        title: 'Last box',
        originalValue: 800,
        price: 300,
        quantity: 1,
        ...window(),
      }),
      201,
    );
    const res = await Promise.all([
      reserve(await foodCustomer(t, ATD), box.id),
      reserve(await foodCustomer(t, ATD), box.id),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.error.code).toBe(
      'SURPLUS_SOLD_OUT',
    );
  });

  it('QA #18 three surplus no-shows → SURPLUS_BLOCKED for 14 days', async () => {
    const v = await kitchen('QA18 No Shows');
    const c = await foodCustomer(t, ATD);
    for (let i = 0; i < 3; i++) {
      const b = await expectStatus(
        await v.api.post('/food/vendor/kitchen/surplus-boxes', {
          title: `Box ${i}`,
          originalValue: 800,
          price: 300,
          quantity: 1,
          ...window(),
        }),
        201,
      );
      const r = await expectStatus(await reserve(c, b.id), 201);
      await sql(
        `UPDATE surplus_boxes SET pickup_from = now() - interval '2 hours', pickup_to = now() - interval '1 minute' WHERE id = $1`,
        [b.id],
      );
      await expectStatus(
        await v.api.post(
          `/food/vendor/kitchen/surplus-reservations/${r.id}/no-show`,
        ),
        200,
      );
    }
    const b = await expectStatus(
      await v.api.post('/food/vendor/kitchen/surplus-boxes', {
        title: 'Box 4',
        originalValue: 800,
        price: 300,
        quantity: 1,
        ...window(),
      }),
      201,
    );
    const res = await reserve(c, b.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SURPLUS_BLOCKED');
    expect(
      Math.round(
        (new Date(res.body.error.details.until).getTime() - Date.now()) /
          86_400_000,
      ),
    ).toBe(14);
  });

  it('QA #19 packing photo required → on_the_way is blocked without the photo', async () => {
    const v = await kitchen('QA19 Packing');
    await expectStatus(
      await v.api.patch('/food/vendor/kitchen/settings', {
        requirePackingPhoto: true,
      }),
      200,
    );
    const { o } = await placed(v, await itemId(t, v));
    for (const step of ['accept', 'preparing', 'ready'])
      await expectStatus(
        await v.api.post(`/food/vendor/orders/${o.id}/${step}`),
        200,
      );
    const res = await v.api.post(`/food/vendor/orders/${o.id}/handed-external`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PACKING_PHOTO_REQUIRED');
    const photo = asset(v.userId, 'packing_proof');
    await expectStatus(
      await v.api.post(`/food/vendor/kitchen/orders/${o.id}/packing-proof`, {
        photoUrl: photo.url,
      }),
      200,
    );
    await expectStatus(
      await v.api.post(`/food/vendor/orders/${o.id}/handed-external`),
      200,
    );
    expect(
      (await sql(`SELECT status FROM food_orders WHERE id = $1`, [o.id]))[0]
        .status,
    ).toBe('on_the_way');
  });

  it('QA #36 a voice recording is deleted after 24 h', async () => {
    const v = await kitchen('QA36 Audio');
    const clip = voiceClip(v.userId);
    f.storage.put(clip.url);
    f.ai.answer(
      answer('busy', { minutes: 10 }, { transcript: 'busy das minute' }),
    );
    const res = await expectStatus(
      await v.api.post('/ai/voice', {
        context: 'board',
        audioUrl: clip.url,
        durationSeconds: 2,
      }),
      200,
    );
    const jobs = t.app.get(AiJobsService);
    await jobs.retention(new Date(Date.now() + 23 * 3600_000));
    expect(f.storage.destroyed).not.toContain(clip.url);
    await jobs.retention(new Date(Date.now() + 25 * 3600_000));
    expect(f.storage.destroyed).toContain(clip.url);
    const [log] = await sql(
      `SELECT audio_url, audio_deleted_at FROM voice_logs WHERE id = $1`,
      [res.voiceLogId],
    );
    expect(log.audio_url).toBeNull();
    expect(log.audio_deleted_at).not.toBeNull();
  });

  it('QA #37 jobs run twice → no double effects', async () => {
    const v = await kitchen('QA37 Jobs Twice');
    const rice = await ingredient(v, {
      name: 'Rice',
      category: 'grain',
      openingStock: {
        qty: 5,
        unit: 'kg',
        totalCost: 1000,
        expiresOn: DateTime.now().setZone(TZ).plus({ days: 2 }).toISODate()!,
      },
    });
    const pulao = await dish(v, 'Pulao', 500);
    await recipe(v, pulao.id, [{ ingredientId: rice.id, qty: 200, unit: 'g' }]);
    const { o } = await acceptedOrder(t, v, { itemId: pulao.id }, ATD);
    // The deduction itself is once-only, even if the hook ran again.
    await t.ds.transaction(async (m) => {
      const order = (
        await m.query(`SELECT * FROM food_orders WHERE id = $1`, [o.id])
      )[0];
      await t.app
        .get(OrderStockService)
        .deduct(m, { ...order, id: o.id, branchId: v.branchId } as any, null);
    });
    expect(await onHand(t, rice.id)).toBe(4800);
    const box = await expectStatus(
      await v.api.post('/food/vendor/kitchen/surplus-boxes', {
        title: 'Jobs box',
        originalValue: 800,
        price: 300,
        quantity: 2,
        ...window(),
      }),
      201,
    );
    await sql(
      `UPDATE surplus_boxes SET pickup_from = now() - interval '2 hours', pickup_to = now() - interval '1 minute' WHERE id = $1`,
      [box.id],
    );
    const twice = async (fn: () => Promise<unknown>) => [
      await fn(),
      await fn(),
    ];
    const [e1, e2] = await twice(() => kitchenJobs.expireSurplus());
    expect([e1, e2]).toEqual([{ expired: 1 }, { expired: 0 }]);
    await twice(() => kitchenJobs.expiryAlerts());
    await t.app.get(KitchenAlertsService).flush();
    const [{ n: alerts }] = await sql(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'kitchen.expiring'`,
      [v.userId],
    );
    expect(alerts).toBe(1);
    await twice(() => kitchenJobs.forecastBranch(v.branchId));
    const [{ n: fc }] = await sql(
      `SELECT count(*)::int AS n FROM demand_forecasts WHERE branch_id = $1 AND menu_item_id = $2`,
      [v.branchId, pulao.id],
    );
    expect(fc).toBe(7);
    await twice(() => kitchenJobs.costSnapshots());
    const [{ n: snaps }] = await sql(
      `SELECT count(*)::int AS n FROM item_cost_snapshots WHERE menu_item_id = $1`,
      [pulao.id],
    );
    expect(snaps).toBe(1);
    await twice(() => foodJobs.recomputePrepStats());
    await twice(() => foodJobs.autoResume());
    const [r1, r2] = await twice(() => t.app.get(AiJobsService).retention());
    expect((r2 as any).audioDeleted).toBe(0);
    void r1;
  });

  it('QA #38 a doctor partner calling kitchen routes gets 403 WRONG_SERVICE', async () => {
    const doc = await approvedDoctor(t, admin);
    for (const path of [
      '/food/vendor/kitchen/stock',
      '/food/vendor/kitchen/costing',
      '/food/vendor/kitchen/forecast',
    ]) {
      const res = await doc.api.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('WRONG_SERVICE');
    }
    const voice = await doc.api.post('/ai/voice', {
      context: 'board',
      text: 'order accept karo',
    });
    expect(voice.body.error.code).toBe('WRONG_SERVICE');
  });
});
