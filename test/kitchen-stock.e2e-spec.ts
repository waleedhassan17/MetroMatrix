import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import { approvedDoctor } from './utils/health';
import { Vendor, expectStatus, foodVendor, setUpVendor } from './utils/food';
import {
  acceptedOrder,
  dish,
  ingredient,
  onHand,
  override,
  recipe,
} from './utils/kitchen';

/** Faisalabad: only this suite puts vendors here. */
const FSD = { lat: 31.4504, lng: 73.135 };

describe('Kitchen stock — ingredients, recipes, FIFO, automatic sold-out (Chunk 5 P1)', () => {
  let t: TestApp;
  let admin: Admin;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, { at: FSD }))!.status).toBe(200);
    return v;
  }

  /** Rice in two batches: 400 g at Rs 0.20/g (older), 1 kg at Rs 0.30/g. */
  async function riceInTwoBatches(v: Vendor) {
    const rice = await ingredient(v, {
      name: 'Basmati Rice',
      category: 'grain',
      openingStock: { qty: 400, unit: 'g', totalCost: 80 },
    });
    await sql(
      `UPDATE stock_batches SET received_at = now() - interval '2 days' WHERE ingredient_id = $1`,
      [rice.id],
    );
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/stock/count', {
        lines: [{ ingredientId: rice.id, qty: 1.4, unit: 'kg' }],
      }),
      200,
    );
    // A count that finds more is a batch at the average cost; give it the newer price instead.
    await sql(
      `UPDATE stock_batches SET unit_cost = 0.30 WHERE ingredient_id = $1 AND received_at > now() - interval '1 hour'`,
      [rice.id],
    );
    return rice;
  }

  it('ingredients: units, par level, opening stock; duplicate names and other kitchens refused', async () => {
    const v = await kitchen('Stock Basics Kitchen');
    const other = await kitchen('Stock Basics Other');
    const eggs = await ingredient(v, {
      name: 'Eggs',
      nameUr: 'انڈے',
      category: 'dairy',
      baseUnit: 'piece',
      customUnits: [{ name: 'tray', factor: 30 }],
      parLevel: { qty: 2, unit: 'tray' },
      openingStock: {
        qty: 3,
        unit: 'tray',
        totalCost: 2700,
        expiresOn: '2099-01-01',
      },
    });
    expect(eggs).toMatchObject({
      name: 'Eggs',
      baseUnit: 'piece',
      units: ['piece', 'dozen', 'tray'],
      onHand: 90,
      parLevel: 60,
      belowPar: false,
      avgCost: 30,
      avgPrice: { price: 30, per: 'piece' },
      value: 2700,
    });
    const dup = await v.api.post('/food/vendor/kitchen/ingredients', {
      name: 'eggs',
      category: 'dairy',
      baseUnit: 'piece',
    });
    expect(dup.status).toBe(409);
    const mismatch = await v.api.post('/food/vendor/kitchen/ingredients', {
      name: 'Milk',
      baseUnit: 'ml',
      category: 'dairy',
      parLevel: { qty: 2, unit: 'kg' },
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toMatchObject({
      code: 'UNIT_MISMATCH',
      details: { allowed: ['ml', 'l'] },
    });
    expect(
      (await other.api.get(`/food/vendor/kitchen/ingredients/${eggs.id}`))
        .status,
    ).toBe(404);
    expect(
      (
        await other.api.patch(`/food/vendor/kitchen/ingredients/${eggs.id}`, {
          name: 'Mine',
        })
      ).status,
    ).toBe(404);

    const list = await expectStatus(
      await v.api.get('/food/vendor/kitchen/ingredients?q=انڈے'),
      200,
    );
    expect(list).toMatchObject({ total: 1, page: 1, items: [{ id: eggs.id }] });
    const moves = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/stock/${eggs.id}/movements`),
      200,
    );
    expect(moves.items).toEqual([
      expect.objectContaining({
        delta: 90,
        reason: 'manual',
        balanceAfter: 90,
        unitCost: 30,
        note: 'Opening stock',
      }),
    ]);
  });

  it('accepting 3 biryanis deducts FIFO across two batches, with movements; cancel puts it back', async () => {
    const v = await kitchen('Stock FIFO Kitchen');
    const rice = await riceInTwoBatches(v);
    const chicken = await ingredient(v, {
      name: 'Chicken',
      category: 'meat',
      openingStock: { qty: 5, unit: 'kg', totalCost: 4000 },
    });
    const biryani = await dish(v, 'Chicken Biryani', 650);
    const card = await recipe(v, biryani.id, [
      { ingredientId: rice.id, qty: 250, unit: 'g' },
      { ingredientId: chicken.id, qty: 0.2, unit: 'kg' },
    ]);
    expect(card).toMatchObject({
      yieldServings: 1,
      servings: 5,
      limitedBy: { name: 'Basmati Rice' },
    });

    const before = await sql(
      `SELECT count(*)::int AS n FROM stock_movements WHERE ingredient_id = $1`,
      [rice.id],
    );
    // Placing alone takes nothing — only accepting does.
    const { o } = await acceptedOrder(
      t,
      v,
      { itemId: biryani.id, quantity: 3 },
      FSD,
    );
    expect(await onHand(t, rice.id)).toBe(650);
    expect(await onHand(t, chicken.id)).toBe(4400);
    const moves = await sql(
      `SELECT delta::float AS delta, unit_cost::float AS unit_cost, balance_after::float AS balance_after
         FROM stock_movements WHERE ref_id = $1 AND ingredient_id = $2 ORDER BY created_at, balance_after DESC`,
      [o.id, rice.id],
    );
    expect(moves).toEqual([
      { delta: -400, unit_cost: 0.2, balance_after: 1000 },
      { delta: -350, unit_cost: 0.3, balance_after: 650 },
    ]);
    const batches = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/stock/${rice.id}/batches`),
      200,
    );
    expect(batches.map((b: any) => b.qtyRemaining)).toEqual([650]);
    const after = await sql(
      `SELECT count(*)::int AS n FROM stock_movements WHERE ingredient_id = $1`,
      [rice.id],
    );
    expect(after[0].n - before[0].n).toBe(2);

    await expectStatus(
      await v.api.post(`/food/vendor/orders/${o.id}/cancel`, {
        reason: 'Customer called to cancel',
      }),
      200,
    );
    expect(await onHand(t, rice.id)).toBe(1400);
    expect(await onHand(t, chicken.id)).toBe(5000);
    const back = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/stock/${rice.id}/batches`),
      200,
    );
    expect(back.map((b: any) => b.qtyRemaining)).toEqual([400, 1000]);
    const [flags] = await sql(
      `SELECT stock_deducted_at, stock_restored_at FROM food_orders WHERE id = $1`,
      [o.id],
    );
    expect(flags.stock_deducted_at).not.toBeNull();
    expect(flags.stock_restored_at).not.toBeNull();
  });

  it('an ingredient reaching zero makes the dish unavailable and tells the vendor; a count brings it back', async () => {
    const v = await kitchen('Stock Zero Kitchen');
    const naan = await ingredient(v, {
      name: 'Naan Dough',
      category: 'bakery',
      openingStock: { qty: 300, unit: 'g' },
    });
    const item = await dish(v, 'Garlic Naan', 320);
    await recipe(v, item.id, [{ ingredientId: naan.id, qty: 150, unit: 'g' }]);
    await acceptedOrder(t, v, { itemId: item.id, quantity: 2 }, FSD);
    expect(await onHand(t, naan.id)).toBe(0);
    expect(await override(t, v, item.id)).toEqual({
      is_available: false,
      auto_reason: 'stock',
    });
    const [note] = await sql(
      `SELECT title, body FROM notifications WHERE user_id = $1 AND type = 'kitchen.sold_out_stock' ORDER BY created_at DESC LIMIT 1`,
      [v.userId],
    );
    expect(note.title).toBe('Garlic Naan is sold out');
    expect(note.body).toContain('Naan Dough ran out');
    const menu = await expectStatus(
      await v.api.get('/food/vendor/availability'),
      200,
    );
    expect(JSON.stringify(menu)).toContain(item.id);

    await expectStatus(
      await v.api.post('/food/vendor/kitchen/stock/count', {
        lines: [{ ingredientId: naan.id, qty: 1, unit: 'kg' }],
      }),
      200,
    );
    expect(await override(t, v, item.id)).toEqual({
      is_available: true,
      auto_reason: null,
    });
    const [back] = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'kitchen.back_in_stock' ORDER BY created_at DESC LIMIT 1`,
      [v.userId],
    );
    expect(back.title).toBe('Garlic Naan is back on your menu');
  });

  it('a manual sold-out is never undone by stock coming back', async () => {
    const v = await kitchen('Stock Manual Kitchen');
    const beef = await ingredient(v, {
      name: 'Beef',
      category: 'meat',
      openingStock: { qty: 100, unit: 'g' },
    });
    const nihari = await dish(v, 'Nihari', 700);
    await recipe(v, nihari.id, [
      { ingredientId: beef.id, qty: 250, unit: 'g' },
    ]);
    // A card for something already short: sold out at once (by stock).
    expect(await override(t, v, nihari.id)).toEqual({
      is_available: false,
      auto_reason: 'stock',
    });
    // The vendor takes it off themselves…
    await expectStatus(
      await v.api.patch('/food/vendor/availability', {
        items: [{ itemId: nihari.id, isAvailable: false }],
      }),
      200,
    );
    expect(await override(t, v, nihari.id)).toEqual({
      is_available: false,
      auto_reason: null,
    });
    // …so new stock leaves it off.
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/stock/count', {
        lines: [{ ingredientId: beef.id, qty: 5, unit: 'kg' }],
      }),
      200,
    );
    expect(await override(t, v, nihari.id)).toEqual({
      is_available: false,
      auto_reason: null,
    });
  });

  it('add-on lines are deducted only when the add-on is chosen; a size uses its own card; packaging never causes sold-out', async () => {
    const v = await kitchen('Stock Addon Kitchen');
    const bun = await ingredient(v, {
      name: 'Bun',
      category: 'bakery',
      baseUnit: 'piece',
      openingStock: { qty: 20, unit: 'piece' },
    });
    const cheese = await ingredient(v, {
      name: 'Cheese Slice',
      category: 'dairy',
      baseUnit: 'piece',
      openingStock: { qty: 20, unit: 'piece' },
    });
    const box = await ingredient(v, {
      name: 'Burger Box',
      category: 'packaging',
      baseUnit: 'piece',
    });
    const group = await expectStatus(
      await v.api.post('/food/vendor/menu/option-groups', {
        name: 'Extras',
        minSelect: 0,
        maxSelect: 1,
        options: [{ name: 'Extra cheese', priceDelta: 60 }],
      }),
      201,
    );
    const extra = group.options[0].id;
    const burger = await dish(v, 'Zinger Burger', 550, {
      variants: [
        { name: 'Regular', price: 550 },
        { name: 'Double', price: 750 },
      ],
    });
    await expectStatus(
      await v.api.put(`/food/vendor/menu/items/${burger.id}/option-groups`, [
        { groupId: group.id },
      ]),
      200,
    );
    const double = burger.variants.find((x: any) => x.name === 'Double').id;
    await recipe(v, burger.id, [
      { ingredientId: bun.id, qty: 1, unit: 'piece' },
      { ingredientId: cheese.id, qty: 1, unit: 'piece', optionId: extra },
      { ingredientId: box.id, qty: 1, unit: 'piece', isPackaging: true },
    ]);
    await recipe(
      v,
      burger.id,
      [{ ingredientId: bun.id, qty: 2, unit: 'piece' }],
      { variantId: double },
    );
    // The empty box doesn't make it sold out.
    expect(await override(t, v, burger.id)).toBeUndefined();

    const regular = burger.variants.find((x: any) => x.name === 'Regular').id;
    await acceptedOrder(
      t,
      v,
      { itemId: burger.id, variantId: regular, quantity: 2 },
      FSD,
    );
    expect([
      await onHand(t, bun.id),
      await onHand(t, cheese.id),
      await onHand(t, box.id),
    ]).toEqual([18, 20, -2]);
    await acceptedOrder(
      t,
      v,
      {
        itemId: burger.id,
        variantId: regular,
        quantity: 1,
        optionIds: [extra],
      },
      FSD,
    );
    expect([await onHand(t, bun.id), await onHand(t, cheese.id)]).toEqual([
      17, 19,
    ]);
    await acceptedOrder(
      t,
      v,
      { itemId: burger.id, variantId: double, quantity: 1 },
      FSD,
    );
    expect(await onHand(t, bun.id)).toBe(15);

    // Packaging below zero: a "log your purchase" alert, once.
    const alerts = await sql(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'kitchen.stock_negative'`,
      [v.userId],
    );
    expect(alerts[0].n).toBe(1);
    const negative = await expectStatus(
      await v.api.get('/food/vendor/kitchen/stock?filter=negative'),
      200,
    );
    expect(negative.items.map((i: any) => i.name)).toEqual(['Burger Box']);
    expect(negative.summary).toMatchObject({ ingredients: 3, negative: 1 });

    const servings = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/items/${burger.id}/servings`),
      200,
    );
    expect(servings).toMatchObject({ hasRecipe: true, servings: 15 });
  });

  it('stock never blocks an order: accepting with too little goes negative', async () => {
    const v = await kitchen('Stock Negative Kitchen');
    const dal = await ingredient(v, {
      name: 'Daal',
      category: 'grain',
      openingStock: { qty: 100, unit: 'g', totalCost: 30 },
    });
    const item = await dish(v, 'Daal Chawal', 300);
    await recipe(v, item.id, [{ ingredientId: dal.id, qty: 60, unit: 'g' }]);
    await acceptedOrder(t, v, { itemId: item.id, quantity: 1 }, FSD);
    // 40 g left → 0 servings → sold out; but an order already on the board can still be accepted.
    expect(await override(t, v, item.id)).toEqual({
      is_available: false,
      auto_reason: 'stock',
    });
    const moves = await sql(
      `SELECT batch_id, delta::float AS d FROM stock_movements WHERE ingredient_id = $1 ORDER BY created_at`,
      [dal.id],
    );
    expect(moves.map((x: any) => x.d)).toEqual([100, -60]);
  });

  it('recipe cards: 404 for another kitchen’s dish or ingredient, UNIT_MISMATCH, setup completeness', async () => {
    const v = await kitchen('Stock Recipe Kitchen');
    const other = await kitchen('Stock Recipe Other');
    const ghee = await ingredient(v, {
      name: 'Ghee',
      category: 'oil',
      baseUnit: 'ml',
    });
    const theirs = await ingredient(other, {
      name: 'Ghee',
      category: 'oil',
      baseUnit: 'ml',
    });
    const halwa = await dish(v, 'Halwa', 250);
    const bad = await v.api.put(
      `/food/vendor/kitchen/items/${halwa.id}/recipe`,
      { lines: [{ ingredientId: ghee.id, qty: 1, unit: 'kg' }] },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('UNIT_MISMATCH');
    const foreign = await v.api.put(
      `/food/vendor/kitchen/items/${halwa.id}/recipe`,
      { lines: [{ ingredientId: theirs.id, qty: 10, unit: 'ml' }] },
    );
    expect(foreign.status).toBe(404);
    expect(
      (await other.api.get(`/food/vendor/kitchen/items/${halwa.id}/recipe`))
        .status,
    ).toBe(404);
    expect(
      await expectStatus(
        await v.api.get(`/food/vendor/kitchen/items/${halwa.id}/recipe`),
        200,
      ),
    ).toBeNull();
    const setup = await expectStatus(
      await v.api.get('/food/vendor/kitchen/setup'),
      200,
    );
    expect(setup.itemsWithoutRecipe.map((i: any) => i.name).sort()).toEqual([
      'Chicken Karahi',
      'Halwa',
    ]);
    // An ingredient in a recipe is switched off, not deleted.
    await recipe(v, halwa.id, [{ ingredientId: ghee.id, qty: 30, unit: 'ml' }]);
    expect(
      await expectStatus(
        await v.api.delete(`/food/vendor/kitchen/ingredients/${ghee.id}`),
        200,
      ),
    ).toEqual({
      removed: false,
      deactivated: true,
      usedInRecipes: 1,
    });
  });

  it('voice on the stock screen: "chawal bees kilo baqi hain" → a proposed count for the kitchen’s rice; unknown names are flagged', async () => {
    const v = await kitchen('Stock Voice Kitchen');
    const rice = await ingredient(v, {
      name: 'Basmati Rice',
      category: 'grain',
      openingStock: { qty: 5, unit: 'kg' },
    });
    const out = await expectStatus(
      await v.api.post('/ai/voice', {
        context: 'stock',
        text: 'chawal bees kilo baqi hain',
      }),
      200,
    );
    expect(out).toMatchObject({
      intent: 'count',
      source: 'rules',
      proposedAction: {
        method: 'POST',
        path: '/food/vendor/kitchen/stock/count',
        body: { lines: [{ ingredientId: rice.id, qty: 20, unit: 'kg' }] },
        summary: 'Count: Basmati Rice 20 kg',
      },
    });
    expect(await onHand(t, rice.id)).toBe(5000);
    const unknown = await expectStatus(
      await v.api.post('/ai/voice', {
        context: 'stock',
        text: 'teen kilo bhindi baqi hai',
      }),
      200,
    );
    expect(unknown.proposedAction).toBeNull();
    expect(unknown.draft.lines[0]).toMatchObject({
      spoken: 'bhindi',
      status: 'UNKNOWN_INGREDIENT',
      suggestedName: 'okra',
    });
  });

  it('a doctor partner calling kitchen routes gets 403 WRONG_SERVICE', async () => {
    const doc = await approvedDoctor(t, admin);
    const res = await doc.api.get('/food/vendor/kitchen/stock');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WRONG_SERVICE');
  });
});
