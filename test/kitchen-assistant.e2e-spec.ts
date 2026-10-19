import * as jpeg from 'jpeg-js';
import { DateTime } from 'luxon';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import {
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
} from './utils/food';
import { dish, ingredient } from './utils/kitchen';
import { AiFakes, aiSettings, fakeAi, withFakeAi } from './utils/fake-ai';
import { ReviewInsightsService } from '../src/modules/kitchen/reviews/review-insights.service';

/** Mardan: only this suite puts vendors here. */
const MRD = { lat: 34.1986, lng: 72.0404 };
const TZ = 'Asia/Karachi';
const day = (n: number) =>
  DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;

/** A JPEG: a sharp checkerboard dish in the middle of a grey frame (or `level` everywhere). */
function photo(level?: number) {
  const w = 800;
  const h = 600;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v =
        level ??
        (Math.abs(x - 400) < 220 && Math.abs(y - 300) < 160
          ? (Math.floor(x / 8) + Math.floor(y / 8)) % 2
            ? 210
            : 60
          : 128);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return Buffer.from(jpeg.encode({ width: w, height: h, data }, 90).data);
}

describe('Menu assistant and review insights (Chunk 5 P9)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  let seq = 0;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    f = fakeAi();
    t = await createTestApp({ override: withFakeAi(f) });
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    f.ai.reset();
    const s = aiSettings(t);
    s.enabled = true;
    s.features = 'all';
  });

  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    const live = await setUpVendor(t, v, {
      at: MRD,
      settings: { city: 'Mardan', codLimit: 50000 },
    });
    expect(live!.status).toBe(200);
    return v;
  }

  /** A delivered order with these lines (a fresh customer each time). */
  async function delivered(v: Vendor, lines: Array<[string, number]>) {
    const c = await foodCustomer(t, MRD);
    for (const [item, quantity] of lines)
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
    return { c, o };
  }

  it('describe: English + Urdu-script draft; health claims and Roman Urdu are refused; nothing saved until the PATCH (QA #29 basis)', async () => {
    const v = await kitchen('Assistant Describe Kitchen');
    const karahi = await itemId(t, v);
    const good = {
      en: 'Chicken cooked hard and fast in a wok with tomatoes, green chillies and fresh ginger.',
      ur: 'ٹماٹر، ہری مرچ اور تازہ ادرک کے ساتھ تیز آنچ پر پکی چکن کڑاہی۔',
    };
    f.ai.answer(
      {
        en: 'A healthy, low-fat karahi that is better than KFC every time.',
        ur: good.ur,
      },
      good,
    );
    const r = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/describe', { itemId: karahi }),
      200,
    );
    expect(r).toMatchObject({
      itemId: karahi,
      draft: { description: good.en, descriptionUr: good.ur },
      current: { description: null, descriptionUr: null },
      save: { method: 'PATCH', path: `/food/vendor/menu/items/${karahi}` },
    });
    expect(f.ai.calls).toHaveLength(2);
    // The retry told the model what was wrong.
    const retry = f.ai.calls[1].parts.find((p) => 'text' in p) as {
      text: string;
    };
    expect(retry.text).toMatch(/no health claims .*healthy, low-fat/);
    expect(retry.text).toMatch(/no brand names \(kfc\)/);
    const [before] = await sql(
      `SELECT description, description_ur FROM menu_items WHERE id = $1`,
      [karahi],
    );
    expect(before).toEqual({ description: null, description_ur: null });

    await expectStatus(
      await v.api.patch(`/food/vendor/menu/items/${karahi}`, r.save.body),
      200,
    );
    const sheet = await expectStatus(
      await new ApiClient(t.http).get(`/food/items/${karahi}`),
      200,
    );
    expect(sheet).toMatchObject({
      description: good.en,
      descriptionUr: good.ur,
    });

    // Roman Urdu twice → refused, with the manual path.
    const roman = {
      en: good.en,
      ur: 'tamatar aur adrak ke saath tez aanch par paki karahi',
    };
    f.ai.answer(roman, roman);
    const other = await dish(v, `Mutton Karahi ${++seq}`, 2200);
    const bad = await v.api.post('/food/vendor/kitchen/ai/describe', {
      itemId: other.id,
    });
    expect(bad.status).toBe(503);
    expect(bad.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { reason: 'invalid' },
    });
    // Another kitchen's dish is 404; AI off is the manual path.
    const stranger = await kitchen('Assistant Stranger Kitchen');
    expect(
      (
        await stranger.api.post('/food/vendor/kitchen/ai/describe', {
          itemId: karahi,
        })
      ).status,
    ).toBe(404);
    aiSettings(t).enabled = false;
    const off = await v.api.post('/food/vendor/kitchen/ai/describe', {
      itemId: karahi,
    });
    expect(off.status).toBe(503);
    expect(off.body.error.details.manual).toMatch(
      /Write the description yourself/,
    );
  });

  it('specials: only the kitchen’s own ingredients, each idea using one that expires; priced from the food cost target; created as an inactive dish (QA #30 basis)', async () => {
    const v = await kitchen('Assistant Specials Kitchen');
    const none = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/specials'),
      200,
    );
    expect(none).toMatchObject({ ideas: [], expiring: [] });
    expect(f.ai.calls).toHaveLength(0);

    const spinach = await ingredient(v, {
      name: 'Spinach',
      category: 'vegetable',
      openingStock: { qty: 4, unit: 'kg', totalCost: 800, expiresOn: day(2) },
    });
    const paneer = await ingredient(v, {
      name: 'Paneer',
      category: 'dairy',
      openingStock: { qty: 2, unit: 'kg', totalCost: 3000 },
    });
    const later = await ingredient(v, {
      name: 'Basmati Rice',
      category: 'grain',
      openingStock: {
        qty: 10,
        unit: 'kg',
        totalCost: 4000,
        expiresOn: day(30),
      },
    });
    const stranger = await kitchen('Assistant Specials Stranger');
    const theirs = await ingredient(stranger, {
      name: 'Prawns',
      category: 'meat',
      openingStock: { qty: 1, unit: 'kg', totalCost: 3500, expiresOn: day(1) },
    });
    f.ai.answer({
      ideas: [
        {
          name: 'Palak Paneer Special',
          description:
            'Slow-cooked spinach with soft paneer cubes and a garlic tarka.',
          servings: 4,
          lines: [
            { ingredientId: spinach.id, qty: 1, unit: 'kg' },
            { ingredientId: paneer.id, qty: 400, unit: 'g' },
          ],
          why: 'Uses the spinach that expires in two days.',
        },
        {
          name: 'Prawn Pulao',
          description: 'Fragrant rice with prawns and whole spices.',
          servings: 4,
          lines: [{ ingredientId: theirs.id, qty: 500, unit: 'g' }],
          why: 'Uses the prawns.',
        },
        {
          name: 'Plain Pulao',
          description:
            'Fragrant rice cooked with whole spices and fried onions.',
          servings: 4,
          lines: [{ ingredientId: later.id, qty: 800, unit: 'g' }],
          why: 'Uses the rice.',
        },
      ],
    });
    const r = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/specials'),
      200,
    );
    // Prawns are another kitchen's; the rice isn't expiring.
    expect(r.dropped).toBe(2);
    expect(r.expiring.map((e: any) => e.name)).toEqual(['Spinach']);
    const input = f.ai.lastInput() as any;
    expect(input.expiring.map((e: any) => e.id)).toEqual([spinach.id]);
    expect(input.pantry.map((e: any) => e.id).sort()).toEqual(
      [paneer.id, later.id].sort(),
    );
    expect(r.ideas).toHaveLength(1);
    const [idea] = r.ideas;
    // Cost: 1000 g × Rs 0.2 + 400 g × Rs 1.5 = Rs 800 for 4 → Rs 200 a plate; at 35% → Rs 571.4 → Rs 580.
    expect(idea).toMatchObject({
      name: 'Palak Paneer Special',
      uses: ['Spinach'],
      costPerServing: 200,
      suggestedPrice: 580,
      foodCostPct: 34.5,
    });
    const known = new Set([spinach.id, paneer.id, later.id]);
    for (const l of idea.lines) expect(known.has(l.ingredientId)).toBe(true);
    expect(idea.lines.some((l: any) => l.expiring)).toBe(true);

    const created = await expectStatus(
      await v.api.post(idea.create.path, idea.create.body),
      201,
    );
    expect(created.item).toMatchObject({
      name: 'Palak Paneer Special',
      basePrice: 580,
      isActive: false,
    });
    expect(created.recipe.lines.map((l: any) => l.ingredientId).sort()).toEqual(
      [spinach.id, paneer.id].sort(),
    );
    const foreign = await v.api.post(
      '/food/vendor/kitchen/ai/specials/create',
      {
        ...idea.create.body,
        lines: [{ ingredientId: theirs.id, qty: 1, unit: 'kg' }],
      },
    );
    expect(foreign.status).toBe(404);
  });

  it('combos: counted from real orders; named by AI, or by the dish names without it', async () => {
    const v = await kitchen('Assistant Combos Kitchen');
    const karahi = await itemId(t, v);
    const naan = await dish(v, `Naan ${++seq}`, 60);
    const raita = await dish(v, `Raita ${++seq}`, 120);
    const few = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/combos'),
      200,
    );
    expect(few.combos).toEqual([]);
    for (let i = 0; i < 3; i++)
      await delivered(v, [
        [karahi, 1],
        [naan.id, 2],
      ]);
    await delivered(v, [[raita.id, 3]]);
    aiSettings(t).enabled = false;
    const plain = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/combos'),
      200,
    );
    expect(plain.combos).toHaveLength(1);
    expect(plain.combos[0]).toMatchObject({
      together: 3,
      supportPct: 75,
      named: 'rules',
      price: 1660,
      bundlePrice: 1490,
      draft: {
        path: '/food/vendor/menu/items',
        body: { isDeal: true, isActive: false },
      },
    });
    expect(plain.combos[0].name).toContain('Chicken Karahi');
    aiSettings(t).enabled = true;
    f.ai.answer({
      combos: [
        {
          key: 'c1',
          name: 'Karahi Night Combo',
          description: 'Chicken karahi with two hot naans.',
        },
      ],
    });
    const named = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/combos'),
      200,
    );
    expect(named.combos[0]).toMatchObject({
      name: 'Karahi Night Combo',
      named: 'ai',
      bundlePrice: 1490,
    });
  });

  it('photo check: measured without AI; tips for a dark photo; AI tips when on; unreadable or foreign files refused', async () => {
    const v = await kitchen('Assistant Photo Kitchen');
    const good = asset(v.userId, 'menu_item');
    f.storage.put(good.url, photo(), 'image/jpeg');
    aiSettings(t).enabled = false;
    const r = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/photo-check', {
        imageUrl: good.url,
      }),
      200,
    );
    expect(r).toMatchObject({
      score: 100,
      problems: [],
      aiTips: null,
      source: 'measured',
    });
    expect(r.metrics).toMatchObject({ width: 800, height: 600, aspect: 1.33 });
    const dark = asset(v.userId, 'menu_item');
    f.storage.put(dark.url, photo(25), 'image/jpeg');
    const d = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/photo-check', {
        imageUrl: dark.url,
      }),
      200,
    );
    expect(d.problems).toEqual(expect.arrayContaining(['dark', 'blurry']));
    expect(d.tips[0]).toMatch(/Too dark/);

    aiSettings(t).enabled = true;
    f.ai.answer({
      tips: ['Shoot from 45° with the plate filling the frame.'],
      looksLikeFood: true,
      matchesDish: true,
    });
    const withAi = await expectStatus(
      await v.api.post('/food/vendor/kitchen/ai/photo-check', {
        imageUrl: good.url,
        itemId: await itemId(t, v),
      }),
      200,
    );
    expect(withAi).toMatchObject({
      source: 'measured+ai',
      aiTips: ['Shoot from 45° with the plate filling the frame.'],
      matchesDish: true,
    });
    const odd = asset(v.userId, 'menu_item', 'webp');
    f.storage.put(odd.url, Buffer.from('RIFF....WEBP'), 'image/webp');
    const unreadable = await v.api.post('/food/vendor/kitchen/ai/photo-check', {
      imageUrl: odd.url,
    });
    expect(unreadable.status).toBe(400);
    expect(unreadable.body.error.details.fields.imageUrl[0]).toMatch(
      /JPG or PNG/,
    );
    const other = await kitchen('Assistant Photo Other');
    const theirs = asset(other.userId, 'menu_item');
    expect(
      (
        await v.api.post('/food/vendor/kitchen/ai/photo-check', {
          imageUrl: theirs.url,
        })
      ).status,
    ).toBe(400);
  });

  it('review insights: 5 new reviews → themes (lexicon without AI, the model with it), anonymised; one push a week; reruns write nothing', async () => {
    const v = await kitchen('Assistant Reviews Kitchen');
    const karahi = await itemId(t, v);
    const insights = t.app.get(ReviewInsightsService);
    const texts: Array<[number, string]> = [
      [2, 'Fries were cold. Call me on 0300 1234567'],
      [3, 'Karahi was mazedar but thanda by the time it came'],
      [2, 'Everything came cold and very late'],
      [5, 'Delicious and fresh'],
      [4, 'Tasty food, quick delivery'],
    ];
    const review = async (rating: number, text: string) => {
      const { c, o } = await delivered(v, [[karahi, 1]]);
      await sql(
        `INSERT INTO food_reviews (order_id, brand_id, user_id, food_rating, text) VALUES ($1, $2, $3, $4, $5)`,
        [o.id, v.brandId, c.userId, rating, text],
      );
    };
    // Counted for this kitchen only (other suites leave reviews too).
    const mine = async () =>
      (
        await sql(
          `SELECT count(*)::int AS n, count(pushed_at)::int AS pushed FROM review_insights WHERE brand_id = $1`,
          [v.brandId],
        )
      )[0];
    for (const [rating, text] of texts.slice(0, 4)) await review(rating, text);
    aiSettings(t).enabled = false;
    await insights.runAll();
    expect(await mine()).toEqual({ n: 0, pushed: 0 });
    await review(...texts[4]);
    await insights.runAll();
    expect(await mine()).toEqual({ n: 1, pushed: 1 });
    await insights.runAll();
    expect(await mine()).toEqual({ n: 1, pushed: 1 });
    const view = await expectStatus(
      await v.api.get('/food/vendor/kitchen/review-insights'),
      200,
    );
    expect(view.latest).toMatchObject({
      reviewCount: 5,
      method: 'lexicon',
      headline: 'This week: 3 reviews mention cold food',
    });
    const cold = view.latest.themes.find((x: any) => x.theme === 'cold food');
    expect(cold).toMatchObject({ sentiment: 'negative', count: 3 });
    expect(JSON.stringify(view.latest)).not.toMatch(/0300/);
    const [push] = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'kitchen.review_insights'`,
      [v.userId],
    );
    expect(push.title).toBe('This week: 3 reviews mention cold food');

    // With AI: five more reviews, the model's themes; no second push the same week.
    aiSettings(t).enabled = true;
    for (let i = 0; i < 5; i++)
      await review(2, `Too much oil in the karahi, order ${i}`);
    f.ai.answer({
      themes: [
        {
          theme: 'too much oil',
          sentiment: 'negative',
          count: 5,
          examples: ['Too much oil in the karahi, order 0'],
        },
      ],
    });
    // Tomorrow's run (one insight a day).
    const tomorrow = new Date(Date.now() + 86_400_000);
    await insights.runAll(tomorrow);
    expect(await mine()).toEqual({ n: 2, pushed: 1 });
    const call = f.ai.calls.find((c) =>
      (c.parts.find((p) => 'text' in p) as { text: string }).text.includes(
        'Too much oil',
      ),
    )!;
    const input = JSON.parse(
      (call.parts.find((p) => 'text' in p) as { text: string }).text,
    );
    expect(input.reviews).toHaveLength(5);
    const ai = await expectStatus(
      await v.api.get('/food/vendor/kitchen/review-insights'),
      200,
    );
    expect(ai.latest).toMatchObject({ method: 'ai', reviewCount: 5 });
    expect(ai.history).toHaveLength(1);
  });
});
