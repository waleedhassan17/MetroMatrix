import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, testIban } from './utils/shopping';
import {
  LAHORE,
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  liveHomeKitchen,
  setUpVendor,
} from './utils/food';
import { FOOD_CHECKOUT_FAULT_INJECTOR } from '../src/modules/food/checkout/food-checkout.service';
import { FoodJobsService } from '../src/modules/food/jobs/food-jobs.service';

const KM = 0.009;
const pkHour = () => (new Date().getUTCHours() + 5) % 24;
const hhmm = (h: number) =>
  `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

describe('Food P4: cart, promotions, preview, checkout, jobs (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: FoodJobsService;
  const fault = {
    armed: false,
    afterDecrements() {
      if (fault.armed) throw new Error('injected checkout fault');
    },
  };
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const remaining = async (v: Vendor, item: string) =>
    (
      await sql(
        `SELECT remaining_today FROM branch_item_overrides WHERE branch_id = $1 AND item_id = $2`,
        [v.branchId, item],
      )
    )[0]?.remaining_today ?? null;
  const add = (
    c: { api: any },
    v: Vendor,
    item: string,
    extra: Record<string, unknown> = {},
    q = '',
  ) =>
    c.api.post(`/food/cart/items${q}`, {
      vendorId: v.brandId,
      itemId: item,
      quantity: 1,
      ...extra,
    });

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) =>
        b.overrideProvider(FOOD_CHECKOUT_FAULT_INJECTOR).useValue(fault),
    });
    admin = await enrolledAdmin(t);
    jobs = t.app.get(FoodJobsService);
  });
  afterAll(() => t.close());

  /** A restaurant with "Zinger Burger" (650): drink required (1/1), extras optional (max 3). */
  async function burgerVendor(name?: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v))!.status).toBe(200);
    const drink = await expectStatus(
      await v.api.post('/food/vendor/menu/option-groups', {
        name: 'Your drink',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'Cola', priceDelta: 0, isDefault: true },
          { name: 'Lassi', priceDelta: 80 },
        ],
      }),
      201,
    );
    const extras = await expectStatus(
      await v.api.post('/food/vendor/menu/option-groups', {
        name: 'Extras',
        minSelect: 0,
        maxSelect: 3,
        options: [
          { name: 'Cheese', priceDelta: 60 },
          { name: 'Jalapeño', priceDelta: 40 },
          { name: 'Egg', priceDelta: 50 },
          { name: 'Extra patty', priceDelta: 250 },
        ],
      }),
      201,
    );
    const [cat] = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const burger = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Zinger Burger',
        basePrice: 650,
      }),
      201,
    );
    await expectStatus(
      await v.api.put(`/food/vendor/menu/items/${burger.id}/option-groups`, [
        { groupId: drink.id },
        { groupId: extras.id },
      ]),
      200,
    );
    const opt = (g: any, n: string) =>
      g.options.find((o: any) => o.name === n).id;
    return {
      v,
      burger: burger.id as string,
      karahi: await itemId(t, v),
      cola: opt(drink, 'Cola'),
      lassi: opt(drink, 'Lassi'),
      extras: extras.options.map((o: any) => o.id) as string[],
    };
  }

  it('options are checked when added; errors name the item and the group (QA #5)', async () => {
    const b = await burgerVendor();
    const c = await foodCustomer(t);
    const missing = await add(c, b.v, b.burger);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({
      code: 'OPTION_REQUIRED',
      details: { item: 'Zinger Burger', group: 'Your drink' },
    });
    const tooMany = await add(c, b.v, b.burger, {
      optionIds: [b.cola, ...b.extras],
    });
    expect(tooMany.body.error).toMatchObject({
      code: 'OPTION_LIMIT',
      details: { group: 'Extras', max: 3 },
    });
    const foreign = await add(c, b.v, b.burger, {
      optionIds: [b.cola, '6f1c2a52-6d8b-4b1e-9d7e-2b8a9e7f1c11'],
    });
    expect(foreign.body.error).toMatchObject({
      code: 'OPTION_INVALID',
      details: { item: 'Zinger Burger' },
    });

    const ok = await expectStatus(
      await add(c, b.v, b.burger, {
        optionIds: [b.lassi, b.extras[0]],
        quantity: 2,
      }),
      201,
    );
    expect(ok.lines).toHaveLength(1);
    expect(ok.lines[0]).toMatchObject({
      unitPrice: 650 + 80 + 60,
      lineTotal: 1580,
      quantity: 2,
    });
    // The same choice again merges into the line.
    const merged = await expectStatus(
      await add(c, b.v, b.burger, { optionIds: [b.extras[0], b.lassi] }),
      201,
    );
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0].quantity).toBe(3);
    // Changing the options re-validates.
    const bad = await c.api.patch(`/food/cart/items/${merged.lines[0].id}`, {
      optionIds: [b.extras[0]],
    });
    expect(bad.body.error).toMatchObject({
      code: 'OPTION_REQUIRED',
      details: { group: 'Your drink' },
    });
    const changed = await expectStatus(
      await c.api.patch(`/food/cart/items/${merged.lines[0].id}`, {
        optionIds: [b.cola],
        quantity: 1,
      }),
      200,
    );
    expect(changed.lines[0]).toMatchObject({ unitPrice: 650, quantity: 1 });
    expect(changed.subtotal).toBe(650);
    const emptied = await expectStatus(
      await c.api.delete(`/food/cart/items/${merged.lines[0].id}`),
      200,
    );
    expect(emptied.empty).toBe(true);
  });

  it('one vendor per cart: CART_OTHER_VENDOR, and ?replace=true starts a new cart (QA #6)', async () => {
    const a = await burgerVendor('Cart Vendor A');
    const b = await burgerVendor('Cart Vendor B');
    const c = await foodCustomer(t);
    await expectStatus(await add(c, a.v, a.karahi, { quantity: 2 }), 201);
    const clash = await add(c, b.v, b.karahi);
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({
      code: 'CART_OTHER_VENDOR',
      details: {
        currentVendor: { id: a.v.brandId, name: 'Cart Vendor A' },
        itemCount: 2,
      },
    });
    const replaced = await expectStatus(
      await add(c, b.v, b.karahi, {}, '?replace=true'),
      201,
    );
    expect(replaced.vendor.id).toBe(b.v.brandId);
    expect(replaced.lines.map((l: any) => l.itemId)).toEqual([b.karahi]);
    expect(replaced.itemCount).toBe(1);
    expect(
      (await expectStatus(await c.api.delete('/food/cart'), 200)).cleared,
    ).toBe(true);
    expect((await expectStatus(await c.api.get('/food/cart'), 200)).empty).toBe(
      true,
    );
  });

  it('preview: the delivery fee is the only fee (QA #21); minimum shortfall (QA #7); COD limit; zone; pickup', async () => {
    const v = await foodVendor(t, admin, 'restaurant', 'Minimums');
    await setUpVendor(t, v, {
      bands: [
        { fromKm: 0, toKm: 3, fee: 120, minOrder: 2000 },
        { fromKm: 3, toKm: 6, fee: 180, minOrder: 2500 },
      ],
      settings: { codLimit: 3000, acceptsPickup: true },
    });
    const karahi = await itemId(t, v);
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const short = await expectStatus(
      await c.api.post('/food/cart/preview', {
        addressId: c.addressId,
        paymentMethod: 'cod',
      }),
      200,
    );
    expect(short.ok).toBe(false);
    expect(Object.keys(short.totals).sort()).toEqual([
      'deliveryFee',
      'discount',
      'subtotal',
      'total',
    ]);
    expect(short.totals).toEqual({
      subtotal: 1600,
      discount: 0,
      deliveryFee: 120,
      total: 1720,
    });
    expect(short.issues[0]).toMatchObject({
      code: 'BELOW_MIN_ORDER',
      details: { minOrder: 2000, subtotal: 1600, shortfall: 400 },
    });
    const placed = await checkout(c);
    expect(placed.status).toBe(400);
    expect(placed.body.error).toMatchObject({
      code: 'BELOW_MIN_ORDER',
      details: { shortfall: 400 },
    });

    const [line] = (await expectStatus(await c.api.get('/food/cart'), 200))
      .lines;
    await expectStatus(
      await c.api.patch(`/food/cart/items/${line.id}`, { quantity: 2 }),
      200,
    );
    const over = await expectStatus(
      await c.api.post('/food/cart/preview', {
        addressId: c.addressId,
        paymentMethod: 'cod',
      }),
      200,
    );
    expect(over.totals.total).toBe(3320);
    expect(over.issues.map((i: any) => i.code)).toEqual(['COD_LIMIT_EXCEEDED']);
    expect(over.payment).toMatchObject({
      available: { cod: true, transfer: false, pay_at_pickup: false },
      codLimit: 3000,
    });
    expect(over.eta.max - over.eta.min).toBe(10);

    const far = await foodCustomer(t, {
      lat: LAHORE.lat + 10 * KM,
      lng: LAHORE.lng,
    });
    await expectStatus(await add(far, v, karahi, { quantity: 2 }), 201);
    const zone = await expectStatus(
      await far.api.post('/food/cart/preview', { addressId: far.addressId }),
      200,
    );
    expect(zone.issues[0]).toMatchObject({ code: 'OUT_OF_ZONE' });
    // Pickup: no address, no fee, pay at the counter.
    await expectStatus(
      await far.api.patch('/food/cart', { fulfilment: 'pickup' }),
      200,
    );
    const pickup = await expectStatus(
      await far.api.post('/food/cart/preview', {
        paymentMethod: 'pay_at_pickup',
      }),
      200,
    );
    expect(pickup).toMatchObject({
      ok: true,
      totals: { subtotal: 3200, deliveryFee: 0, total: 3200 },
    });
    const order = await expectStatus(
      await checkout(far, {
        paymentMethod: 'pay_at_pickup',
        addressId: undefined,
      }),
      201,
    );
    expect(order).toMatchObject({
      fulfilment: 'pickup',
      address: null,
      payment: { method: 'pay_at_pickup', status: 'unpaid' },
    });
    expect(Object.keys(order.totals).sort()).toEqual([
      'deliveryFee',
      'discount',
      'subtotal',
      'total',
    ]);
    const [{ ok }] = await sql(
      `SELECT bool_and(total = subtotal - discount + delivery_fee) AS ok FROM food_orders`,
    );
    expect(ok).toBe(true);
  });

  it('promotions: the best deal wins; happy hour outside its window is not applied (QA #8); codes', async () => {
    const b = await burgerVendor('Deals Kitchen');
    const promo = (body: Record<string, unknown>) =>
      b.v.api.post('/food/vendor/promotions', body);
    await expectStatus(
      await promo({ title: 'Ten off', kind: 'percent_off_order', value: 10 }),
      201,
    );
    await expectStatus(
      await promo({
        title: 'Big order',
        kind: 'flat_off',
        value: 250,
        minOrder: 1500,
      }),
      201,
    );
    const h = pkHour();
    const happy = await expectStatus(
      await promo({
        title: 'Happy hour',
        kind: 'percent_off_order',
        value: 40,
        timeFrom: hhmm(h + 3),
        timeTo: hhmm(h + 4),
      }),
      201,
    );
    expect(happy.state).toBe('live');
    const coded = await expectStatus(
      await promo({
        title: 'Karahi week',
        kind: 'percent_off_items',
        value: 20,
        itemIds: [b.karahi],
        code: 'karahi20',
        usageLimit: 1,
      }),
      201,
    );
    expect(coded).toMatchObject({
      code: 'KARAHI20',
      label: '20% off selected items',
    });
    expect(
      (await promo({ title: 'Bad', kind: 'percent_off_order', value: 150 }))
        .status,
    ).toBe(400);
    expect(
      (
        await promo({
          title: 'Dup',
          kind: 'flat_off',
          value: 50,
          code: 'KARAHI20',
        })
      ).status,
    ).toBe(409);

    // The card shows the best automatic deal.
    const [slug] = (
      await sql(`SELECT slug FROM food_brands WHERE id = $1`, [b.v.brandId])
    ).map((r: any) => r.slug);
    const page = await expectStatus(
      await new ApiClient(t.http).get(`/food/vendors/${slug}`),
      200,
    );
    expect(page.dealLabel).toBe('10% off');
    expect(page.deals.map((d: any) => d.title)).toEqual([
      'Ten off',
      'Big order',
    ]);

    const c = await foodCustomer(t);
    await expectStatus(await add(c, b.v, b.karahi), 201);
    const p1 = await expectStatus(
      await c.api.post('/food/cart/preview', { addressId: c.addressId }),
      200,
    );
    expect(p1.deal).toMatchObject({ title: 'Big order', discount: 250 }); // 250 > 10% of 1600
    expect(p1.totals).toEqual({
      subtotal: 1600,
      discount: 250,
      deliveryFee: 99,
      total: 1449,
    });
    const p2 = await expectStatus(
      await c.api.post('/food/cart/preview', {
        addressId: c.addressId,
        promoCode: 'Karahi20',
      }),
      200,
    );
    expect(p2.deal).toMatchObject({ code: 'KARAHI20', discount: 320 });
    const p3 = await expectStatus(
      await c.api.post('/food/cart/preview', {
        addressId: c.addressId,
        promoCode: 'NOPE',
      }),
      200,
    );
    expect(p3.issues[0]).toMatchObject({ code: 'PROMO_INVALID' });

    const order = await expectStatus(
      await checkout(c, { promoCode: 'KARAHI20' }),
      201,
    );
    expect(order.deal).toMatchObject({
      title: 'Karahi week',
      code: 'KARAHI20',
    });
    expect(order.totals).toEqual({
      subtotal: 1600,
      discount: 320,
      deliveryFee: 99,
      total: 1379,
    });
    expect(
      (
        await sql(`SELECT used_count FROM food_promotions WHERE id = $1`, [
          coded.id,
        ])
      )[0].used_count,
    ).toBe(1);

    const c2 = await foodCustomer(t);
    await expectStatus(await add(c2, b.v, b.karahi), 201);
    const used = await expectStatus(
      await c2.api.post('/food/cart/preview', {
        addressId: c2.addressId,
        promoCode: 'KARAHI20',
      }),
      200,
    );
    expect(used.issues[0]).toMatchObject({ code: 'PROMO_LIMIT_REACHED' });
    expect(used.deal).toMatchObject({ title: 'Big order' });

    const list = await expectStatus(
      await b.v.api.get('/food/vendor/promotions?state=live'),
      200,
    );
    expect(list.total).toBe(4);
    expect(
      (await b.v.api.delete(`/food/vendor/promotions/${coded.id}`)).status,
    ).toBe(409);
    expect(
      (
        await expectStatus(
          await b.v.api.post(`/food/vendor/promotions/${coded.id}/deactivate`),
          200,
        )
      ).state,
    ).toBe('inactive');
    expect(
      (
        await expectStatus(
          await b.v.api.delete(`/food/vendor/promotions/${happy.id}`),
          200,
        )
      ).deleted,
    ).toBe(true);
  });

  it('checkout: same Idempotency-Key → one order; snapshot lines; cart cleared; the vendor is told', async () => {
    const b = await burgerVendor('Idempotent Grill');
    const c = await foodCustomer(t);
    await expectStatus(
      await add(c, b.v, b.burger, {
        optionIds: [b.lassi, b.extras[3]],
        notes: 'No onions',
      }),
      201,
    );
    await expectStatus(await add(c, b.v, b.karahi), 201);
    const key = `same-${Date.now()}`;
    const first = await checkout(
      c,
      {
        cutlery: true,
        note: 'Gate 2',
        building: 'Askari 5',
        floor: '2nd',
        riderInstructions: 'Call me',
      },
      key,
    );
    expect(first.status).toBe(201);
    const second = await checkout(c, { cutlery: true }, key);
    expect(second.status).toBe(201);
    expect(second.body.data.code).toBe(first.body.data.code);
    const o = first.body.data;
    expect(o.code).toMatch(/^FC-[A-Z2-9]{6}$/);
    expect(
      (
        await sql(
          `SELECT count(*)::int AS n FROM food_orders WHERE user_id = $1`,
          [c.userId],
        )
      )[0].n,
    ).toBe(1);
    expect(o).toMatchObject({
      status: 'placed',
      fulfilment: 'delivery',
      cutlery: true,
      note: 'Gate 2',
      payment: {
        method: 'cod',
        status: 'cod_pending',
        instructions: expect.stringMatching(/cash/),
      },
      address: {
        building: 'Askari 5',
        floor: '2nd',
        riderInstructions: 'Call me',
        lat: LAHORE.lat,
        lng: LAHORE.lng,
      },
      totals: {
        subtotal: 980 + 1600,
        discount: 0,
        deliveryFee: 99,
        total: 2679,
      },
      canCancel: true,
      canReorder: false,
      events: [
        { kind: 'status', from: null, to: 'placed', actorRole: 'customer' },
      ],
    });
    expect(o.items[0]).toMatchObject({
      name: 'Zinger Burger',
      unitPrice: 980,
      notes: 'No onions',
      options: [
        { name: 'Lassi', group: 'Your drink', priceDelta: 80 },
        { name: 'Extra patty', group: 'Extras', priceDelta: 250 },
      ],
    });
    expect(
      new Date(o.acceptBy).getTime() - new Date(o.placedAt).getTime(),
    ).toBeCloseTo(5 * 60_000, -3);
    expect((await expectStatus(await c.api.get('/food/cart'), 200)).empty).toBe(
      true,
    );
    const [notice] = await sql(
      `SELECT n.type, n.title FROM notifications n JOIN businesses b ON b.owner_user_id = n.user_id
        WHERE b.id = $1 AND n.type = 'food.order.new'`,
      [b.v.businessId],
    );
    expect(notice.title).toBe(`New order ${o.code}`);
    const mine = await expectStatus(
      await c.api.get('/food/orders?status=active'),
      200,
    );
    expect(mine.items).toMatchObject([
      {
        code: o.code,
        itemCount: 2,
        total: 2679,
        vendor: { name: 'Idempotent Grill' },
      },
    ]);
    expect(
      (await expectStatus(await c.api.get(`/food/orders/${o.code}`), 200)).code,
    ).toBe(o.code);
    const other = await foodCustomer(t);
    expect((await other.api.get(`/food/orders/${o.code}`)).status).toBe(404);
    // A replay with an empty cart is still the first response, not CART_EMPTY.
    expect((await checkout(c, {}, key)).status).toBe(201);
    expect((await checkout(c)).body.error.code).toBe('CART_EMPTY');
  });

  it('the last portion goes to exactly one of two racing checkouts (QA #9)', async () => {
    const v = await liveHomeKitchen(t, admin, 'Last Portion Kitchen');
    const karahi = await itemId(t, v);
    await expectStatus(
      await v.api.patch('/food/vendor/today', {
        items: [{ itemId: karahi, portions: 1 }],
      }),
      200,
    );
    const a = await foodCustomer(t);
    const b = await foodCustomer(t);
    await expectStatus(await add(a, v, karahi), 201);
    await expectStatus(await add(b, v, karahi), 201);
    const results = await Promise.all([checkout(a), checkout(b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409)!;
    expect(lost.body.error).toMatchObject({
      code: 'PORTIONS_SOLD_OUT',
      details: { item: 'Chicken Karahi', remaining: 0 },
    });
    expect(await remaining(v, karahi)).toBe(0);
    const c = await foodCustomer(t);
    const sold = await add(c, v, karahi);
    expect(sold.status).toBe(409);
    expect(sold.body.error.code).toBe('PORTIONS_SOLD_OUT');
  });

  it('a failure after the decrements leaves portions, promotion use and the cart untouched', async () => {
    const v = await liveHomeKitchen(t, admin, 'Fault Kitchen');
    const karahi = await itemId(t, v);
    const promo = await expectStatus(
      await v.api.post('/food/vendor/promotions', {
        title: 'Opening week',
        kind: 'flat_off',
        value: 100,
      }),
      201,
    );
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi, { quantity: 3 }), 201);
    const before = await remaining(v, karahi);
    fault.armed = true;
    try {
      const res = await checkout(c);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      fault.armed = false;
    }
    expect(await remaining(v, karahi)).toBe(before);
    expect(
      (
        await sql(`SELECT used_count FROM food_promotions WHERE id = $1`, [
          promo.id,
        ])
      )[0].used_count,
    ).toBe(0);
    expect(
      (
        await sql(
          `SELECT count(*)::int AS n FROM food_orders WHERE user_id = $1`,
          [c.userId],
        )
      )[0].n,
    ).toBe(0);
    expect(
      (await expectStatus(await c.api.get('/food/cart'), 200)).itemCount,
    ).toBe(3);
    const ok = await expectStatus(await checkout(c), 201);
    expect(ok.totals.discount).toBe(100);
    expect(await remaining(v, karahi)).toBe(before - 3);
  });

  it('pre-order slots: places left, and SLOT_FULL for the one after the last (QA #10)', async () => {
    const v = await liveHomeKitchen(t, admin, 'Friday Biryani');
    const karahi = await itemId(t, v);
    const tomorrow = new Date(Date.now() + 5 * 3600e3 + 86_400e3).getUTCDay();
    await expectStatus(
      await v.api.put('/food/vendor/preorder-slots', [
        {
          weekday: tomorrow,
          slotStart: '13:00',
          cutoffMinutesBefore: 60,
          maxOrders: 1,
        },
      ]),
      200,
    );
    const anon = new ApiClient(t.http);
    const listed = await expectStatus(
      await anon.get(`/food/vendors/${v.brandId}/slots`),
      200,
    );
    expect(listed).toMatchObject({
      usesSlots: true,
      slots: [{ maxOrders: 1, remaining: 1, full: false }],
    });
    const at = listed.slots[0].startsAt;
    expect(at).toMatch(/T13:00:00(\.000)?\+05:00$/);

    const a = await foodCustomer(t);
    await expectStatus(await add(a, v, karahi), 201);
    const bad = await a.api.patch('/food/cart', {
      scheduledFor: new Date(Date.now() + 2 * 3600e3).toISOString(),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('SLOT_INVALID');
    const scheduled = await expectStatus(
      await a.api.patch('/food/cart', { scheduledFor: at }),
      200,
    );
    expect(scheduled.scheduledFor).toMatchObject({
      slotId: listed.slots[0].slotId,
    });
    const order = await expectStatus(await checkout(a), 201);
    expect(order.scheduledFor).toBe(at);
    // A scheduled order for another day doesn't draw on today's portions.
    expect(await remaining(v, karahi)).toBe(20);

    const after = await expectStatus(
      await anon.get(`/food/vendors/${v.brandId}/slots`),
      200,
    );
    expect(after.slots[0]).toMatchObject({ remaining: 0, full: true });
    const b = await foodCustomer(t);
    await expectStatus(await add(b, v, karahi), 201);
    const full = await b.api.patch('/food/cart', { scheduledFor: at });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SLOT_FULL');
    // Raced past the cart check: checkout itself refuses.
    await sql(`UPDATE food_carts SET scheduled_for = $2 WHERE user_id = $1`, [
      b.userId,
      at,
    ]);
    const res = await checkout(b);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_FULL');
  });

  it('silent vendor: auto-rejected, the customer told, portions back (QA #11); jobs twice → no double effects (QA #27)', async () => {
    const v = await liveHomeKitchen(t, admin, 'Sleepy Kitchen');
    const karahi = await itemId(t, v);
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi, { quantity: 2 }), 201);
    const order = await expectStatus(await checkout(c), 201);
    expect(await remaining(v, karahi)).toBe(18);

    expect(await jobs.autoReject()).toEqual({ autoRejected: 0 });
    await sql(
      `UPDATE food_orders SET accept_by = now() - interval '1 second' WHERE id = $1`,
      [order.id],
    );
    expect(await jobs.autoReject()).toEqual({ autoRejected: 1 });
    expect(await jobs.autoReject()).toEqual({ autoRejected: 0 });

    const after = await expectStatus(
      await c.api.get(`/food/orders/${order.code}`),
      200,
    );
    expect(after).toMatchObject({
      status: 'auto_rejected',
      cancelledBy: 'system',
      payment: { status: 'void' },
      canCancel: false,
      canReorder: true,
    });
    expect(after.events.map((e: any) => `${e.kind}:${e.to}`)).toEqual([
      'status:placed',
      'status:auto_rejected',
      'payment:void',
    ]);
    expect(await remaining(v, karahi)).toBe(20);
    const notes = await sql(
      `SELECT type FROM notifications WHERE user_id = $1 AND type = 'food.order.auto_rejected'`,
      [c.userId],
    );
    expect(notes).toHaveLength(1);
  });

  it('a transfer not paid within 10 minutes is cancelled by the system (QA #13)', async () => {
    const v = await foodVendor(t, admin, 'restaurant', 'Transfer Only Tikka');
    await setUpVendor(t, v);
    await expectStatus(
      await v.api.post('/food/vendor/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Tikka House',
        accountNumber: testIban(),
        bankName: 'HBL',
      }),
      201,
    );
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, await itemId(t, v)), 201);
    const order = await expectStatus(
      await checkout(c, { paymentMethod: 'transfer' }),
      201,
    );
    expect(order.payment).toMatchObject({
      method: 'transfer',
      status: 'awaiting_transfer',
      accounts: [{ kind: 'bank', accountTitle: 'Tikka House' }],
    });
    expect(
      new Date(order.payment.payBy).getTime() -
        new Date(order.placedAt).getTime(),
    ).toBeCloseTo(10 * 60_000, -3);

    expect(await jobs.cancelUnpaidTransfers()).toEqual({ cancelled: 0 });
    await sql(
      `UPDATE food_orders SET pay_by = now() - interval '1 second' WHERE id = $1`,
      [order.id],
    );
    expect(await jobs.cancelUnpaidTransfers()).toEqual({ cancelled: 1 });
    expect(await jobs.cancelUnpaidTransfers()).toEqual({ cancelled: 0 });
    const after = await expectStatus(
      await c.api.get(`/food/orders/${order.code}`),
      200,
    );
    expect(after).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      payment: { status: 'void' },
    });
    expect(after.cancelReason).toMatch(/transfer/);
  });
});
