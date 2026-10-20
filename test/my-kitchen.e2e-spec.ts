import { DateTime } from 'luxon';
import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import {
  Admin,
  Partner,
  approvedPartner,
  categoryId,
  customer,
  deliverOrder,
  listProduct,
  orderFrom,
  storeOf,
} from './utils/shopping';
import { expectStatus } from './utils/food';
import { AiFakes, aiSettings, fakeAi, withFakeAi } from './utils/fake-ai';
import { MyKitchenJobsService } from '../src/modules/my-kitchen/my-kitchen-jobs.service';

const TZ = 'Asia/Karachi';
const day = (n: number) =>
  DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;

describe('My Kitchen: pantry, recipes, missing-to-bag, order drafts, reminders (Chunk 5 P11)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  let grocer: Partner;
  let storeId: string;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    f = fakeAi();
    t = await createTestApp({ override: withFakeAi(f) });
    admin = await enrolledAdmin(t);
    grocer = await approvedPartner(t, admin, 'store', 'My Kitchen Test Grocer');
    storeId = (await storeOf(grocer)).id;
  });
  afterAll(() => t.close());
  beforeEach(() => {
    f.ai.reset();
    aiSettings(t).enabled = false;
  });

  async function stocked(c: Awaited<ReturnType<typeof customer>>) {
    const add = async (
      name: string,
      qty: number,
      unit: string,
      expiresOn: string | null,
    ) =>
      expectStatus(
        await c.api.post('/my-kitchen/pantry', { name, qty, unit, expiresOn }),
        201,
      );
    return {
      palak: await add('Palak', 1, 'kg', day(1)),
      paneer: await add('Paneer', 500, 'g', day(2)),
      aloo: await add('Aloo', 2, 'kg', day(20)),
      pyaz: await add('Pyaz', 1, 'kg', null),
      anday: await add('Anday', 12, 'piece', day(10)),
    };
  }

  it('pantry: Urdu names map to canonical ones, soonest first, expiring list, stats; another person’s item is 404', async () => {
    const c = await customer(t);
    const p = await stocked(c);
    expect(p.palak).toMatchObject({
      canonical: 'spinach',
      daysLeft: 1,
      expiring: true,
      status: 'active',
    });
    expect(p.pyaz).toMatchObject({
      canonical: 'onion',
      daysLeft: null,
      expiring: false,
    });
    const list = await expectStatus(await c.api.get('/my-kitchen/pantry'), 200);
    expect(list.items.map((i: any) => i.name)).toEqual([
      'Palak',
      'Paneer',
      'Anday',
      'Aloo',
      'Pyaz',
    ]);
    const exp = await expectStatus(
      await c.api.get('/my-kitchen/pantry/expiring'),
      200,
    );
    expect(exp.items.map((i: any) => i.name)).toEqual(['Palak', 'Paneer']);
    const other = await customer(t);
    expect(
      (await other.api.patch(`/my-kitchen/pantry/${p.palak.id}`, { qty: 2 }))
        .status,
    ).toBe(404);
    expect(
      (await other.api.post(`/my-kitchen/pantry/${p.palak.id}/used`)).status,
    ).toBe(404);

    await expectStatus(
      await c.api.post(`/my-kitchen/pantry/${p.aloo.id}/used`),
      200,
    );
    await expectStatus(
      await c.api.post(`/my-kitchen/pantry/${p.anday.id}/discard`),
      200,
    );
    const s = await expectStatus(await c.api.get('/my-kitchen/stats'), 200);
    expect(s).toMatchObject({
      used: 1,
      discarded: 1,
      expired: 0,
      usedShare: 0.5,
    });
    expect(s.mostWasted).toEqual([{ name: 'Anday', n: 1 }]);
    const used = await expectStatus(
      await c.api.get('/my-kitchen/pantry?status=used'),
      200,
    );
    expect(used.items.map((i: any) => i.name)).toEqual(['Aloo']);
  });

  it('recipe suggestions prefer what expires first and mark what is missing — the recipe book, or the model re-sorted (QA #34 basis)', async () => {
    const c = await customer(t);
    const p = await stocked(c);
    const book = await expectStatus(
      await c.api.post('/my-kitchen/recipes/suggest'),
      200,
    );
    expect(book.source).toBe('library');
    expect(book.recipes[0]).toMatchObject({
      key: 'palak-paneer',
      expiringUsed: 2,
      missing: ['garlic', 'cream'],
      notCooking: { path: '/food/search?q=Palak%20paneer' },
      missingToBag: {
        path: '/my-kitchen/missing-to-bag',
        body: { items: [{ name: 'garlic' }, { name: 'cream' }] },
      },
    });
    expect(book.recipes[0].uses.map((u: any) => u.name).sort()).toEqual([
      'Palak',
      'Paneer',
      'Pyaz',
    ]);

    aiSettings(t).enabled = true;
    const recipe = (title: string, uses: string[], missing: string[]) => ({
      title,
      titleUr: 'ڈش',
      uses,
      missing,
      steps: ['Wash and chop.', 'Cook on a medium flame.'],
      minutes: 30,
      servings: 3,
      why: 'Uses what you have.',
    });
    f.ai.answer({
      recipes: [
        recipe('Aloo bhujia', [p.aloo.id, p.pyaz.id], []),
        recipe('Palak paneer', [p.palak.id, p.paneer.id], ['cream', 'salt']),
      ],
    });
    const ai = await expectStatus(
      await c.api.post('/my-kitchen/recipes/suggest'),
      200,
    );
    expect(ai.source).toBe('ai');
    // The model listed it second; it uses the two items that expire first.
    expect(ai.recipes.map((r: any) => r.title)).toEqual([
      'Palak paneer',
      'Aloo bhujia',
    ]);
    expect(ai.recipes[0]).toMatchObject({
      expiringUsed: 2,
      missing: ['cream'],
    });
    expect(ai.recipes[0].uses.every((u: any) => u.expiring)).toBe(true);
    // Same pantry within 6 h: the cached answer, no new model call.
    const again = await expectStatus(
      await c.api.post('/my-kitchen/recipes/suggest'),
      200,
    );
    expect(again).toMatchObject({ source: 'ai', cached: true });
    expect(f.ai.calls).toHaveLength(1);

    // An answer naming an item that isn't in the pantry, twice → the recipe book.
    // A new item changes the pantry (quantities alone don't: they aren't sent).
    await expectStatus(
      await c.api.post('/my-kitchen/pantry', {
        name: 'Gajar',
        qty: 1,
        unit: 'kg',
        expiresOn: day(6),
      }),
      201,
    );
    const ghost = recipe(
      'Ghost curry',
      ['00000000-0000-4000-8000-000000000000'],
      [],
    );
    f.ai.answer({ recipes: [ghost] }, { recipes: [ghost] });
    const fallback = await expectStatus(
      await c.api.post('/my-kitchen/recipes/suggest'),
      200,
    );
    expect(fallback.source).toBe('library');
    expect(fallback.recipes[0].key).toBe('palak-paneer');
  });

  it('missing-to-bag: grocery products sorted by price per unit; pack sizes on products and variants (QA #35 basis)', async () => {
    const dairy = await categoryId(t, 'grocery-dairy-eggs');
    const veg = await categoryId(t, 'grocery-vegetables-fruit');
    const bad = await grocer.api.post('/shop/partner/products', {
      name: 'Half a pack',
      description: 'x',
      categoryId: dairy,
      basePrice: 100,
      packQty: 1,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.pack).toBeDefined();
    const cream = await listProduct(t, grocer, {
      name: 'Dairy cream',
      categoryId: dairy,
      basePrice: 180,
      packQty: 200,
      packUnit: 'ml',
      variants: [
        { option1: '200 ml', stock: 10 },
        {
          option1: '1 litre',
          stock: 10,
          priceDelta: 470,
          packQty: 1,
          packUnit: 'l',
        },
      ],
    });
    expect(cream.pack).toEqual({ qty: 200, unit: 'ml' });
    expect(cream.variants.map((v: any) => v.pricePer)).toEqual([
      { price: 900, per: 'l' },
      { price: 650, per: 'l' },
    ]);
    await listProduct(t, grocer, {
      name: 'Garlic (desi)',
      categoryId: veg,
      basePrice: 120,
      packQty: 250,
      packUnit: 'g',
      variants: [{ option1: '250 g', stock: 5 }],
    });
    await listProduct(t, grocer, {
      name: 'Garlic, Chinese',
      categoryId: veg,
      basePrice: 400,
      packQty: 1,
      packUnit: 'kg',
      variants: [{ option1: '1 kg', stock: 5 }],
    });
    // Not grocery: never offered.
    await listProduct(t, grocer, {
      name: 'Cream lawn kurta',
      variants: [{ option1: 'M', stock: 3 }],
    });
    const pub = await expectStatus(
      await new (await import('./utils/test-app')).ApiClient(t.http).get(
        `/shop/products/${cream.id}`,
      ),
      200,
    );
    expect(pub).toMatchObject({
      pack: { qty: 200, unit: 'ml' },
      pricePer: { price: 900, per: 'l' },
    });

    const c = await customer(t);
    const r = await expectStatus(
      await c.api.post('/my-kitchen/missing-to-bag', {
        items: [{ name: 'cream' }, { name: 'lehsan' }],
      }),
      200,
    );
    expect(r.city).toBe('Lahore');
    const [creamOpts, garlicOpts] = r.items;
    expect(
      creamOpts.options.map((o: any) => [o.name, o.variant, o.pricePer.price]),
    ).toEqual([
      ['Dairy cream', '1 litre', 650],
      ['Dairy cream', '200 ml', 900],
    ]);
    expect(garlicOpts).toMatchObject({ name: 'lehsan', canonical: 'garlic' });
    expect(garlicOpts.options.map((o: any) => o.pricePer)).toEqual([
      { price: 400, per: 'kg' },
      { price: 480, per: 'kg' },
    ]);
    expect(garlicOpts.options[0].store).toMatchObject({
      id: storeId,
      deliversToYou: true,
    });
    // The first option straight into the Shopping bag.
    const add = garlicOpts.options[0].addToBag;
    expect((await c.api.post(add.path, add.body)).status).toBe(200);
  });

  it('a delivered grocery order offers "add to pantry" drafts (pack × quantity, a suggested expiry); added once', async () => {
    const veg = await categoryId(t, 'grocery-vegetables-fruit');
    const tomatoes = await listProduct(t, grocer, {
      name: 'Tomatoes',
      categoryId: veg,
      basePrice: 160,
      packQty: 1,
      packUnit: 'kg',
      variants: [{ option1: '1 kg', stock: 20 }],
    });
    const c = await customer(t);
    const so = await orderFrom(c, storeId, [[tomatoes.variants[0].id, 2]]);
    expect(
      (
        await expectStatus(
          await c.api.get('/my-kitchen/pantry/from-orders'),
          200,
        )
      ).items,
    ).toEqual([]);
    await deliverOrder(grocer, so.id);
    const d = await expectStatus(
      await c.api.get('/my-kitchen/pantry/from-orders'),
      200,
    );
    expect(d.items).toEqual([
      expect.objectContaining({
        name: 'Tomatoes',
        qty: 2,
        unit: 'kg',
        suggestedExpiresOn: day(5),
      }),
    ]);
    const line = d.items[0].storeOrderItemId;
    const added = await expectStatus(
      await c.api.post('/my-kitchen/pantry/from-orders', {
        lines: [{ storeOrderItemId: line }],
      }),
      201,
    );
    expect(added.added[0]).toMatchObject({
      name: 'Tomatoes',
      canonical: 'tomato',
      qty: 2,
      source: 'order',
    });
    const twice = await expectStatus(
      await c.api.post('/my-kitchen/pantry/from-orders', {
        lines: [{ storeOrderItemId: line }],
      }),
      201,
    );
    expect(twice.added).toEqual([]);
    const other = await customer(t);
    expect(
      (
        await other.api.post('/my-kitchen/pantry/from-orders', {
          lines: [{ storeOrderItemId: line }],
        })
      ).status,
    ).toBe(404);
  });

  it('reminders: 2 days before and on the day, once each; past items expire; voice adds pantry lines as a proposal', async () => {
    const c = await customer(t);
    const add = async (name: string, expiresOn: string) =>
      expectStatus(
        await c.api.post('/my-kitchen/pantry', {
          name,
          qty: 1,
          unit: 'piece',
          expiresOn,
        }),
        201,
      );
    await add('Bread', day(0));
    await add('Yogurt', day(2));
    const old = await add('Milk', day(1));
    await sql(`UPDATE pantry_items SET expires_on = $2 WHERE id = $1`, [
      old.id,
      day(-1),
    ]);
    const jobs = t.app.get(MyKitchenJobsService);
    const first = await jobs.reminders();
    expect(first).toMatchObject({
      expired: expect.any(Number),
      reminded: expect.any(Number),
    });
    const mine = await sql(
      `SELECT title, body FROM notifications WHERE user_id = $1 AND type = 'my_kitchen.expiring'`,
      [c.userId],
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Use today: Bread');
    expect(mine[0].body).toMatch(/In 2 days: Yogurt/);
    await jobs.reminders();
    expect(
      await sql(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'my_kitchen.expiring'`,
        [c.userId],
      ),
    ).toHaveLength(1);
    const [m] = await sql(`SELECT status FROM pantry_items WHERE id = $1`, [
      old.id,
    ]);
    expect(m.status).toBe('expired');

    const v = await expectStatus(
      await c.api.post('/ai/voice', {
        context: 'pantry',
        text: 'ek litre doodh, teen din mein expire',
      }),
      200,
    );
    expect(v).toMatchObject({
      intent: 'add_pantry',
      needsConfirmation: true,
      proposedAction: { method: 'POST', path: '/my-kitchen/pantry/batch' },
    });
    expect(v.proposedAction.body.items[0]).toMatchObject({
      name: 'milk',
      qty: 1,
      unit: 'l',
      expiresOn: day(3),
    });
    const saved = await expectStatus(
      await c.api.post(v.proposedAction.path, v.proposedAction.body),
      201,
    );
    expect(saved.items[0]).toMatchObject({
      name: 'milk',
      canonical: 'milk',
      source: 'voice',
    });
  });
});
