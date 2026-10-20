import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import {
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
} from './utils/food';
import { AiFakes, aiSettings, fakeAi, withFakeAi } from './utils/fake-ai';

/** Chiniot: only this suite puts vendors here. */
const CHN = { lat: 31.72, lng: 72.9789 };

describe('Staff: nutrition foods, aliases, AI usage and prompts, support lookup (Chunk 5 P12)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    f = fakeAi();
    t = await createTestApp({ override: withFakeAi(f) });
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    f.ai.reset();
    aiSettings(t).enabled = true;
  });

  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect(
      (await setUpVendor(t, v, { at: CHN, settings: { city: 'Chiniot' } }))!
        .status,
    ).toBe(200);
    return v;
  }

  it('nutrition foods: search, add, edit (USDA → staff), deactivate, CSV import; staff only, audited', async () => {
    const v = await kitchen('Admin Nutrition Kitchen');
    expect((await v.api.get('/admin/nutrition/foods')).status).toBe(403);
    const found = await expectStatus(
      await admin.api.get('/admin/nutrition/foods?q=apricot'),
      200,
    );
    // A row no other suite or seed reads: editing it can't change their sums.
    const apricot = found.items.find((x: any) => x.key === 'apricots-raw');
    expect(apricot).toMatchObject({
      source: 'usda_sr_legacy',
      fdcId: 171697,
      isActive: true,
    });

    const nihari = await expectStatus(
      await admin.api.post('/admin/nutrition/foods', {
        name: 'Nihari masala (house blend)',
        foodGroup: 'Spices and Herbs',
        kcal: 330,
        proteinG: 12,
        carbsG: 50,
        fatG: 10,
        fibreG: 20,
        sodiumMg: 4000,
      }),
      201,
    );
    expect(nihari).toMatchObject({
      key: 'nihari-masala-house-blend',
      source: 'staff',
    });
    const dup = await admin.api.post('/admin/nutrition/foods', {
      key: 'nihari-masala-house-blend',
      name: 'Again',
      foodGroup: 'Spices',
      kcal: 1,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fibreG: 0,
      sodiumMg: 0,
    });
    expect(dup.status).toBe(409);
    const heavy = await admin.api.patch(
      `/admin/nutrition/foods/${apricot.id}`,
      {
        proteinG: 60,
        carbsG: 50,
      },
    );
    expect(heavy.status).toBe(400);
    const edited = await expectStatus(
      await admin.api.patch(`/admin/nutrition/foods/${apricot.id}`, {
        nameUr: 'خوبانی',
      }),
      200,
    );
    expect(edited).toMatchObject({
      source: 'staff',
      fdcId: 171697,
      nameUr: 'خوبانی',
    });

    await expectStatus(
      await admin.api.delete(`/admin/nutrition/foods/${nihari.id}`),
      200,
    );
    const vendorView = await expectStatus(
      await v.api.get('/food/vendor/kitchen/nutrition/foods?q=nihari'),
      200,
    );
    expect(vendorView.items.map((x: any) => x.id)).not.toContain(nihari.id);

    const imp = await expectStatus(
      await admin.api.post('/admin/nutrition/foods/import', {
        csv: [
          'key,name,name_ur,food_group,kcal,protein_g,carbs_g,fat_g,fibre_g,sodium_mg,piece_grams',
          'sheermal,Sheermal,شیرمال,Baked Products,330,8,55,9,2,400,80',
          'apricots-raw,Apricots (staff),,Fruits,48,1.4,11.1,0.4,2,1,',
          'Bad Key,Oops,,x,1,0,0,0,0,0,',
          'heavy,Too heavy,,x,500,60,50,20,0,0,',
        ].join('\n'),
      }),
      200,
    );
    expect(imp).toMatchObject({ inserted: 1, updated: 1, rejected: 2 });
    expect(imp.errors.map((e: any) => e.line)).toEqual([4, 5]);
    const actions = (
      await sql(
        `SELECT action FROM operational_audit_events WHERE action LIKE 'nutrition.food.%' ORDER BY created_at`,
      )
    ).map((r: any) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'nutrition.food.create',
        'nutrition.food.update',
        'nutrition.food.deactivate',
        'nutrition.food.import',
      ]),
    );
  });

  it('aliases: staff add one, the pantry and suggestions use it at once; duplicates refused', async () => {
    const list = await expectStatus(
      await admin.api.get('/admin/kitchen/aliases?canonical=tomato'),
      200,
    );
    expect(list.items.map((a: any) => a.alias)).toEqual(
      expect.arrayContaining(['tamatar', 'ٹماٹر']),
    );
    expect(list.canonicals).toBeGreaterThanOrEqual(100);
    const a = await expectStatus(
      await admin.api.post('/admin/kitchen/aliases', {
        alias: 'laal tamatar',
        canonical: 'Tomato',
        lang: 'roman',
      }),
      201,
    );
    expect(a).toMatchObject({ canonical: 'tomato', lang: 'roman' });
    const dup = await admin.api.post('/admin/kitchen/aliases', {
      alias: 'Laal Tamatar',
      canonical: 'onion',
      lang: 'roman',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.canonical).toBe('tomato');
    const c = await foodCustomer(t, CHN);
    const p = await expectStatus(
      await c.api.post('/my-kitchen/pantry', {
        name: 'Laal tamatar',
        qty: 1,
        unit: 'kg',
      }),
      201,
    );
    expect(p.canonical).toBe('tomato');
    await expectStatus(
      await admin.api.delete(`/admin/kitchen/aliases/${a.id}`),
      200,
    );
    expect(
      (await admin.api.delete(`/admin/kitchen/aliases/${a.id}`)).status,
    ).toBe(404);
  });

  it('AI usage by feature and business, prompt versions with calls, switches without keys', async () => {
    const v = await kitchen('Admin AI Kitchen');
    const karahi = await itemId(t, v);
    f.ai.answer({
      en: 'Chicken cooked fast in a wok with tomato, green chilli and ginger.',
      ur: 'ٹماٹر، ہری مرچ اور ادرک کے ساتھ تیز آنچ پر پکی چکن کڑاہی۔',
    });
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/describe', { itemId: karahi }),
      200,
    );
    const u = await expectStatus(
      await admin.api.get('/admin/ai/usage?days=7'),
      200,
    );
    expect(u.totals.calls).toBeGreaterThanOrEqual(1);
    expect(
      u.byFeature.find((x: any) => x.feature === 'menu_assistant'),
    ).toMatchObject({ ok: expect.any(Number) });
    // Top 20 by calls (in a full run other suites call more): ordered, and this vendor's call is counted.
    const calls = u.byBusiness.map((b: any) => b.calls);
    expect(calls).toEqual([...calls].sort((a: number, b: number) => b - a));
    const [mine] = await sql(
      `SELECT count(*)::int AS n FROM ai_usage WHERE business_id = $1 AND feature = 'menu_assistant'`,
      [v.businessId],
    );
    expect(mine.n).toBe(1);
    const prompts = await expectStatus(
      await admin.api.get('/admin/ai/prompts'),
      200,
    );
    const ids = prompts.items.map((p: any) => `${p.id}@${p.version}`);
    expect(ids).toEqual(
      expect.arrayContaining([
        'voice_intent@3',
        'receipt_scan@1',
        'packing_check@1',
        'describe@1',
        'specials@1',
        'combos@1',
        'photo_tips@1',
        'review_themes@1',
        'nutrition_estimate@1',
        'pantry_recipes@1',
      ]),
    );
    expect(
      prompts.items.find((p: any) => p.id === 'describe').calls30d,
    ).toBeGreaterThanOrEqual(1);
    const s = await expectStatus(
      await admin.api.get('/admin/ai/settings'),
      200,
    );
    expect(s).toMatchObject({ enabled: true, providerConfigured: true });
    expect(JSON.stringify(s)).not.toMatch(/key/i);
    expect((await v.api.get('/admin/ai/usage')).status).toBe(403);
  });

  it('support lookup by code: a catering request, an order, a tiffin subscription; unknown is 404', async () => {
    const v = await kitchen('Admin Lookup Kitchen');
    const c = await foodCustomer(t, CHN);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: await itemId(t, v),
        quantity: 1,
      }),
      201,
    );
    const o = await expectStatus(await checkout(c, { source: 'qr' }), 201);
    const order = await expectStatus(
      await admin.api.get(`/admin/food/lookup?code=${o.code}`),
      200,
    );
    expect(order).toMatchObject({
      kind: 'order',
      code: o.code,
      source: 'qr',
      vendor: 'Admin Lookup Kitchen',
    });
    const req = await expectStatus(
      await c.api.post('/food/catering', {
        vendorId: v.brandId,
        eventDate: new Date(Date.now() + 9 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        eventTime: '19:00',
        guests: 30,
        eventType: 'birthday',
        requestedItems: [{ name: 'Karahi', qty: 6 }],
        fulfilment: 'pickup',
      }),
      201,
    );
    const ct = await expectStatus(
      await admin.api.get(`/admin/food/lookup?code=${req.code.toLowerCase()}`),
      200,
    );
    expect(ct).toMatchObject({
      kind: 'catering',
      code: req.code,
      status: 'requested',
      quotes: null,
    });
    const karahi = await itemId(t, v);
    const plan = await expectStatus(
      await v.api.post('/food/vendor/tiffin/plans', {
        name: 'Lookup lunch',
        meal: 'lunch',
        days: [1, 2, 3, 4, 5],
        period: 'weekly',
        pricePerPeriod: 1500,
        deliveryMode: 'pickup',
        deliveryWindowFrom: '12:30',
        deliveryWindowTo: '13:30',
        capacity: 2,
        rotation: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          menuItemIds: [karahi],
        })),
      }),
      201,
    );
    const sub = await expectStatus(
      await c.api
        .post('/food/tiffin/subscribe', {
          planId: plan.id,
          startsOn: new Date(Date.now() + 2 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          paymentMethod: 'cash_weekly',
          fulfilment: 'pickup',
        })
        .set('Idempotency-Key', `lookup-${Date.now()}`),
      201,
    );
    const tf = await expectStatus(
      await admin.api.get(`/admin/food/lookup?code=${sub.id}`),
      200,
    );
    expect(tf).toMatchObject({
      kind: 'tiffin',
      id: sub.id,
      status: 'requested',
      plan: 'Lookup lunch',
      deliveries: 0,
    });
    expect(
      (await admin.api.get('/admin/food/lookup?code=CT-NOPE00')).status,
    ).toBe(404);
    expect((await admin.api.get('/admin/food/lookup?code=hello')).status).toBe(
      400,
    );
    const [audit] = await sql(
      `SELECT count(*)::int AS n FROM operational_audit_events WHERE action = 'food.lookup'`,
    );
    expect(audit.n).toBeGreaterThanOrEqual(2);
  });
});
