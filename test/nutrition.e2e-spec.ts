import { ApiClient, createTestApp, TestApp } from './utils/test-app';
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
import { dish, ingredient, recipe } from './utils/kitchen';
import { AiFakes, aiSettings, fakeAi, withFakeAi } from './utils/fake-ai';

/** Sargodha: only this suite puts vendors here. */
const SGD = { lat: 32.0836, lng: 72.6711 };

describe('Nutrition: mapping, recipe-based values, AI estimates, profile and summary (Chunk 5 P10)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  let seq = 0;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const anon = () => new ApiClient(t.http);

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
    const live = await setUpVendor(t, v, {
      at: SGD,
      settings: { city: 'Sargodha', codLimit: 50000 },
    });
    expect(live!.status).toBe(200);
    return v;
  }

  /** Chicken karahi for 4: 1 kg chicken, 300 g tomato, 100 g ghee. */
  async function karahiKitchen(name: string) {
    const v = await kitchen(name);
    const karahi = await itemId(t, v);
    const chicken = await ingredient(v, {
      name: 'Chicken',
      category: 'meat',
      openingStock: { qty: 20, unit: 'kg', totalCost: 14000 },
    });
    const tomato = await ingredient(v, {
      name: 'Tamatar',
      category: 'vegetable',
      openingStock: { qty: 10, unit: 'kg', totalCost: 1500 },
    });
    const ghee = await ingredient(v, {
      name: 'Desi Ghee',
      category: 'oil',
      openingStock: { qty: 5, unit: 'kg', totalCost: 7500 },
    });
    await recipe(
      v,
      karahi,
      [
        { ingredientId: chicken.id, qty: 1, unit: 'kg' },
        { ingredientId: tomato.id, qty: 300, unit: 'g' },
        { ingredientId: ghee.id, qty: 100, unit: 'g' },
      ],
      { yieldServings: 4 },
    );
    return { v, karahi, chicken, tomato, ghee };
  }

  it('mapping is suggested by alias, counts only once confirmed; the recipe value equals the hand calculation (QA #31 basis)', async () => {
    const { v, karahi, tomato } = await karahiKitchen(
      'Nutrition Recipe Kitchen',
    );
    const map = await expectStatus(
      await v.api.get('/food/vendor/kitchen/nutrition/mapping'),
      200,
    );
    const row = map.items.find((i: any) => i.ingredientId === tomato.id);
    expect(row).toMatchObject({
      status: 'suggested',
      suggestion: {
        via: 'alias',
        food: { key: 'tomato', per100g: { kcal: 18 } },
      },
    });
    expect(map.summary).toMatchObject({ suggested: 3, confirmed: 0 });
    // Suggestions alone don't count.
    const before = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/nutrition/items/${karahi}`),
      200,
    );
    expect(before).toMatchObject({
      nutrition: null,
      recipe: { mappedShare: 0, usable: false, needed: 0.8 },
    });
    const accepted = await expectStatus(
      await v.api.post(
        '/food/vendor/kitchen/nutrition/mapping/accept-suggestions',
      ),
      200,
    );
    expect(accepted).toMatchObject({ accepted: 3, summary: { confirmed: 3 } });
    const after = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/nutrition/items/${karahi}`),
      200,
    );
    // (1000 × 119 + 300 × 18 + 100 × 900) / 100 / 4 = 536 kcal; protein (213.9 + 2.64) / 4 = 54.1 g.
    expect(after.nutrition).toMatchObject({
      perServing: { kcal: 536, proteinG: 54.1 },
      servingGrams: 350,
      method: 'recipe',
      confidence: 0.9,
      lowConfidence: false,
      mappedShare: 1,
      badges: ['under_600_kcal', 'high_protein'],
      label: 'Estimated from the kitchen’s recipe',
    });

    // Customers: the item sheet, the vendor page and the filters.
    const sheet = await expectStatus(
      await anon().get(`/food/items/${karahi}`),
      200,
    );
    expect(sheet.nutrition).toMatchObject({
      perServing: { kcal: 536 },
      method: 'recipe',
      badges: ['under_600_kcal', 'high_protein'],
    });
    const page = await expectStatus(
      await anon().get(`/food/vendors/${v.brandId}`),
      200,
    );
    expect(page.nutritionByItem[karahi]).toMatchObject({ kcal: 536 });
    const list = async (q: string) =>
      (
        await expectStatus(
          await anon().get(
            `/food/vendors?lat=${SGD.lat}&lng=${SGD.lng}&pageSize=100&${q}`,
          ),
          200,
        )
      ).items.map((x: any) => x.id);
    expect(await list('maxKcal=600')).toContain(v.brandId);
    expect(await list('maxKcal=500')).not.toContain(v.brandId);
    expect(await list('highProtein=true')).toContain(v.brandId);

    // Hidden: nothing for customers; the vendor still sees it.
    await expectStatus(
      await v.api.patch(`/food/vendor/kitchen/nutrition/items/${karahi}`, {
        hidden: true,
      }),
      200,
    );
    expect(
      (await expectStatus(await anon().get(`/food/items/${karahi}`), 200))
        .nutrition,
    ).toBeNull();
    expect(await list('maxKcal=600')).not.toContain(v.brandId);
    await expectStatus(
      await v.api.patch(`/food/vendor/kitchen/nutrition/items/${karahi}`, {
        hidden: false,
      }),
      200,
    );

    // A recipe change recomputes it (double the ghee: +225 kcal a plate).
    const ghee = map.items.find(
      (i: any) => i.name === 'Desi Ghee',
    ).ingredientId;
    const chicken = map.items.find(
      (i: any) => i.name === 'Chicken',
    ).ingredientId;
    await recipe(
      v,
      karahi,
      [
        { ingredientId: chicken, qty: 1, unit: 'kg' },
        { ingredientId: tomato.id, qty: 300, unit: 'g' },
        { ingredientId: ghee, qty: 200, unit: 'g' },
      ],
      { yieldServings: 4 },
    );
    const [{ kcal }] = await sql(
      `SELECT kcal FROM menu_item_nutrition WHERE menu_item_id = $1`,
      [karahi],
    );
    expect(Number(kcal)).toBe(761);

    const stranger = await kitchen('Nutrition Stranger Kitchen');
    expect(
      (await stranger.api.get(`/food/vendor/kitchen/nutrition/items/${karahi}`))
        .status,
    ).toBe(404);
  });

  it('no usable recipe → an AI estimate, capped and labelled low confidence (QA #32 basis)', async () => {
    const v = await kitchen('Nutrition Estimate Kitchen');
    const pulao = await dish(v, `Chicken Pulao ${++seq}`, 650, {
      description: 'Rice cooked in chicken stock with whole spices.',
      serves: 1,
    });
    const none = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/nutrition/items/${pulao.id}`),
      200,
    );
    expect(none).toEqual({ itemId: pulao.id, nutrition: null, recipe: null });
    f.ai.answer(
      // kcal far from the macros → refused once.
      {
        servingGrams: 400,
        kcal: 1500,
        proteinG: 20,
        carbsG: 60,
        fatG: 10,
        fibreG: 2,
        sodiumMg: 900,
        confidence: 0.45,
      },
      {
        servingGrams: 400,
        kcal: 620,
        proteinG: 28,
        carbsG: 80,
        fatG: 20,
        fibreG: 3,
        sodiumMg: 950,
        confidence: 0.8,
      },
    );
    const est = await expectStatus(
      await v.api.post(
        `/food/vendor/kitchen/nutrition/items/${pulao.id}/estimate`,
      ),
      200,
    );
    expect(f.ai.calls).toHaveLength(2);
    expect(est.nutrition).toMatchObject({
      perServing: { kcal: 620, proteinG: 28 },
      method: 'ai_estimate',
      confidence: 0.4,
      lowConfidence: true,
      label: 'AI estimate — low confidence',
      badges: ['high_protein'],
    });
    const sheet = await expectStatus(
      await anon().get(`/food/items/${pulao.id}`),
      200,
    );
    expect(sheet.nutrition).toMatchObject({
      lowConfidence: true,
      label: 'AI estimate — low confidence',
    });

    // A mostly unmapped recipe still isn't used; AI off is the manual path.
    const rice = await ingredient(v, { name: 'Chawal', category: 'grain' });
    const secret = await ingredient(v, {
      name: 'House masala blend',
      category: 'spice',
    });
    await recipe(v, pulao.id, [
      { ingredientId: rice.id, qty: 100, unit: 'g' },
      { ingredientId: secret.id, qty: 300, unit: 'g' },
    ]);
    await expectStatus(
      await v.api.put(`/food/vendor/kitchen/nutrition/mapping/${rice.id}`, {
        nutritionFoodId: (
          await expectStatus(
            await v.api.get(
              '/food/vendor/kitchen/nutrition/foods?q=rice&pageSize=100',
            ),
            200,
          )
        ).items.find((x: any) => x.key === 'rice').id,
      }),
      200,
    );
    const partial = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/nutrition/items/${pulao.id}`),
      200,
    );
    expect(partial.recipe).toMatchObject({
      mappedShare: 0.25,
      usable: false,
      unmapped: ['House masala blend'],
    });
    expect(partial.nutrition.method).toBe('ai_estimate');
    aiSettings(t).enabled = false;
    const other = await dish(v, `Kheer ${++seq}`, 250);
    const off = await v.api.post(
      `/food/vendor/kitchen/nutrition/items/${other.id}/estimate`,
    );
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('the profile is the customer’s alone: vendors get 404; Mifflin-St Jeor or a manual target; delete removes it (QA #33 basis)', async () => {
    const v = await kitchen('Nutrition Profile Kitchen');
    const c = await foodCustomer(t, SGD);
    expect((await c.api.get('/food/me/nutrition/profile')).status).toBe(404);
    const missing = await c.api.put('/food/me/nutrition/profile', {
      goal: 'maintain',
      sex: 'male',
    });
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.error.details.fields).sort()).toEqual([
      'activity',
      'age',
      'heightCm',
      'weightKg',
    ]);
    const p = await expectStatus(
      await c.api.put('/food/me/nutrition/profile', {
        goal: 'maintain',
        sex: 'male',
        age: 30,
        heightCm: 175,
        weightKg: 70,
        activity: 'moderate',
      }),
      200,
    );
    expect(p).toMatchObject({
      targetKcal: 2560,
      targetMethod: 'mifflin_st_jeor',
      formula: { name: 'Mifflin-St Jeor' },
    });
    expect(p.formula.source).toMatch(/Am J Clin Nutr\. 1990/);
    // A vendor (or any partner) never sees it.
    expect((await v.api.get('/food/me/nutrition/profile')).status).toBe(404);
    expect(
      (
        await v.api.put('/food/me/nutrition/profile', {
          goal: 'lose',
          manualTargetKcal: 1800,
        })
      ).status,
    ).toBe(403);
    const manual = await expectStatus(
      await c.api.put('/food/me/nutrition/profile', {
        goal: 'lose',
        manualTargetKcal: 1800,
      }),
      200,
    );
    expect(manual).toMatchObject({
      targetKcal: 1800,
      targetMethod: 'manual',
      formula: null,
    });

    // The order view the vendor gets carries nothing of it.
    const karahi = await itemId(t, v);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: karahi,
        quantity: 1,
      }),
      201,
    );
    const o = await expectStatus(await checkout(c), 201);
    const seen = await expectStatus(
      await v.api.get(`/food/vendor/orders/${o.id}`),
      200,
    );
    expect(JSON.stringify(seen)).not.toMatch(
      /targetKcal|weightKg|heightCm|"goal"|mifflin/i,
    );

    expect(
      await expectStatus(await c.api.delete('/food/me/nutrition/profile'), 200),
    ).toEqual({ deleted: true });
    expect((await c.api.get('/food/me/nutrition/profile')).status).toBe(404);
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM nutrition_profiles WHERE user_id = $1`,
      [c.userId],
    );
    expect(n).toBe(0);
  });

  it('summary: ordered food only, per day, estimated, with coverage and the target', async () => {
    const { v, karahi } = await karahiKitchen('Nutrition Summary Kitchen');
    await expectStatus(
      await v.api.post(
        '/food/vendor/kitchen/nutrition/mapping/accept-suggestions',
      ),
      200,
    );
    const naan = await dish(v, `Naan ${++seq}`, 60);
    const c = await foodCustomer(t, SGD);
    await expectStatus(
      await c.api.put('/food/me/nutrition/profile', {
        goal: 'maintain',
        manualTargetKcal: 2200,
      }),
      200,
    );
    for (const [item, quantity] of [
      [karahi, 2],
      [naan.id, 2],
    ] as const)
      await expectStatus(
        await c.api.post('/food/cart/items', {
          vendorId: v.brandId,
          itemId: item,
          quantity,
        }),
        201,
      );
    const o = await expectStatus(await checkout(c), 201);
    await sql(`UPDATE food_orders SET status = 'delivered' WHERE id = $1`, [
      o.id,
    ]);
    const s = await expectStatus(
      await c.api.get('/food/me/nutrition/summary?range=7d'),
      200,
    );
    expect(s.days).toHaveLength(7);
    const today = s.days[s.days.length - 1];
    expect(today).toMatchObject({
      kcal: 1072,
      items: 4,
      itemsWithNutrition: 2,
    });
    expect(s).toMatchObject({
      coverage: 0.5,
      targetKcal: 2200,
      totals: { kcal: 1072 },
    });
    expect(s.label).toMatch(/ordered on MetroMatrix only/);
  });
});
