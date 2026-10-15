import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import {
  Admin,
  Partner,
  addAddress,
  approvedPartner,
  listProduct,
  shopper,
  storeOf,
  testIban,
} from './utils/shopping';

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('Shopping P3: cart, wishlist, coupons, preview (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let a: Partner;
  let b: Partner;
  let storeA: { id: string; slug: string };
  let storeB: { id: string; slug: string };
  let kurta: any; // store A: S (3), M (10), L (0) at Rs 3000
  let shawl: any; // store B: one variant (5) at Rs 2500

  const variant = (p: any, label: string) =>
    p.variants.find((v: any) => v.label === label).id;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    a = await approvedPartner(t, admin, 'store', 'Cart Couture');
    b = await approvedPartner(t, admin, 'store', 'Basket Bazaar');
    storeA = await storeOf(a);
    storeB = await storeOf(b);
    await a.api
      .patch('/shop/partner/store/settings', {
        shippingFlatFee: 200,
        freeShippingOver: 6000,
      })
      .expect(200);
    await b.api
      .patch('/shop/partner/store/settings', {
        shippingFlatFee: 150,
        deliveryCities: ['Karachi'],
      })
      .expect(200);
    kurta = await listProduct(t, a, {
      name: 'Chikankari kurta',
      basePrice: 3000,
      variants: [
        { option1: 'S', stock: 3 },
        { option1: 'M', stock: 10 },
        { option1: 'L', stock: 0 },
      ],
    });
    shawl = await listProduct(t, b, {
      name: 'Pashmina shawl',
      basePrice: 2500,
      variants: [{ option1: 'Grey', stock: 5 }],
    });
  });
  afterAll(() => t.close());

  describe('cart', () => {
    it('merges the same variant and caps quantity at stock and at 20', async () => {
      const c = await shopper(t);
      const first = await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'S'),
          quantity: 2,
        })
        .expect(200);
      expect(first.body.data).toMatchObject({
        lineCount: 1,
        itemCount: 2,
        adjusted: null,
      });

      const merged = await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'S'),
          quantity: 2,
        })
        .expect(200);
      expect(merged.body.data.lineCount).toBe(1);
      expect(merged.body.data.stores[0].items[0]).toMatchObject({
        quantity: 3,
        maxQuantity: 3,
      });
      expect(merged.body.data.adjusted).toEqual({
        variantId: variant(kurta, 'S'),
        requested: 4,
        quantity: 3,
        reason: 'stock',
      });

      await a.api
        .patch(`/shop/partner/inventory/${variant(kurta, 'M')}`, { setTo: 40 })
        .expect(200);
      await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'M'),
          quantity: 15,
        })
        .expect(200);
      const max = await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'M'),
          quantity: 10,
        })
        .expect(200);
      expect(max.body.data.adjusted).toMatchObject({
        requested: 25,
        quantity: 20,
        reason: 'max_per_line',
      });
      await a.api
        .patch(`/shop/partner/inventory/${variant(kurta, 'M')}`, { setTo: 10 })
        .expect(200);

      const lineM = max.body.data.stores[0].items.find(
        (i: any) => i.variantLabel === 'M',
      );
      await c.api
        .patch(`/shop/cart/items/${lineM.id}`, { quantity: 25 })
        .expect(400);
      const patched = await c.api
        .patch(`/shop/cart/items/${lineM.id}`, { quantity: 12 })
        .expect(200);
      expect(patched.body.data.adjusted).toMatchObject({
        requested: 12,
        quantity: 10,
        reason: 'stock',
      });
      const five = await c.api
        .patch(`/shop/cart/items/${lineM.id}`, { quantity: 5 })
        .expect(200);
      // 3 × 3000 + 5 × 3000 = 24000 ≥ 6000 → free shipping.
      expect(five.body.data).toMatchObject({
        lineCount: 2,
        itemCount: 8,
        itemsTotal: 24000,
        shippingTotal: 0,
        grandTotal: 24000,
        hasWarnings: false,
      });

      await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'S'),
          quantity: 0,
        })
        .expect(400);
      const oos = await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'L'),
          quantity: 1,
        })
        .expect(409);
      expect(oos.body.error.code).toBe('OUT_OF_STOCK');
      const draft = await listProduct(t, a, {
        name: 'Unpublished kurta',
        status: 'draft',
      });
      await c.api
        .post('/shop/cart/items', {
          variantId: draft.variants[0].id,
          quantity: 1,
        })
        .expect(404);

      // Another customer can't touch these lines.
      const other = await shopper(t);
      await other.api
        .patch(`/shop/cart/items/${lineM.id}`, { quantity: 1 })
        .expect(404);
      await other.api.delete(`/shop/cart/items/${lineM.id}`).expect(404);

      const removed = await c.api
        .delete(`/shop/cart/items/${lineM.id}`)
        .expect(200);
      expect(removed.body.data.lineCount).toBe(1);
      const cleared = await c.api.delete('/shop/cart').expect(200);
      expect(cleared.body.data).toMatchObject({
        lineCount: 0,
        stores: [],
        grandTotal: 0,
      });

      // Only verified customers have carts.
      await a.api.get('/shop/cart').expect(403);
    });

    it('flags PRICE_CHANGED after a price edit, and other live problems', async () => {
      const c = await shopper(t);
      await c.api
        .post('/shop/cart/items', {
          variantId: shawl.variants[0].id,
          quantity: 1,
        })
        .expect(200);
      await b.api
        .patch(`/shop/partner/products/${shawl.id}`, { salePrice: 2200 })
        .expect(200);

      const cart = await c.api.get('/shop/cart').expect(200);
      const line = cart.body.data.stores[0].items[0];
      expect(line).toMatchObject({
        unitPrice: 2200,
        priceAtAdd: 2500,
        lineTotal: 2200,
      });
      expect(line.warnings).toEqual([
        expect.objectContaining({
          code: 'PRICE_CHANGED',
          details: { was: 2500, now: 2200 },
        }),
      ]);
      expect(cart.body.data.hasWarnings).toBe(true);

      // Touching the line accepts the new price.
      const ack = await c.api
        .patch(`/shop/cart/items/${line.id}`, { quantity: 1 })
        .expect(200);
      expect(ack.body.data.stores[0].items[0].warnings).toEqual([]);

      await b.api
        .patch(`/shop/partner/inventory/${shawl.variants[0].id}`, { setTo: 0 })
        .expect(200);
      const oos = await c.api.get('/shop/cart').expect(200);
      expect(
        oos.body.data.stores[0].items[0].warnings.map((w: any) => w.code),
      ).toEqual(['OUT_OF_STOCK']);
      expect(oos.body.data.stores[0].subtotal).toBe(0);
      await b.api
        .patch(`/shop/partner/inventory/${shawl.variants[0].id}`, { setTo: 5 })
        .expect(200);

      await b.api
        .patch('/shop/partner/store/settings', {
          isPaused: true,
          pauseMessage: 'Back on Monday',
        })
        .expect(200);
      const paused = await c.api.get('/shop/cart').expect(200);
      expect(paused.body.data.stores[0]).toMatchObject({
        isAvailable: false,
        subtotal: 0,
        warnings: [{ code: 'STORE_UNAVAILABLE', message: 'Back on Monday' }],
      });
      await b.api
        .patch('/shop/partner/store/settings', { isPaused: false })
        .expect(200);
    });
  });

  describe('preview', () => {
    let c: Awaited<ReturnType<typeof shopper>>;
    let lahore: string;
    let karachi: string;

    beforeAll(async () => {
      c = await shopper(t);
      lahore = await addAddress(c, { city: 'Lahore' });
      karachi = await addAddress(c, { city: ' karachi ' });
      await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'M'),
          quantity: 2,
        })
        .expect(200);
      await c.api
        .post('/shop/cart/items', {
          variantId: shawl.variants[0].id,
          quantity: 1,
        })
        .expect(200);
    });

    const preview = (body: object) =>
      c.api.post('/shop/cart/preview', body).expect(200);
    const both = (addressId: string, payA = 'cod', payB = 'cod') => ({
      addressId,
      stores: [
        { storeId: storeA.id, paymentMethod: payA },
        { storeId: storeB.id, paymentMethod: payB },
      ],
    });
    const codes = (s: any) => s.issues.map((i: any) => i.code);

    it('prices every store exactly and reports problems per store', async () => {
      const lahoreRes = await preview(both(lahore));
      const [pa, pb] = lahoreRes.body.data.stores;
      expect(lahoreRes.body.data.ok).toBe(false);
      expect(codes(pa)).toEqual([]);
      expect(codes(pb)).toEqual(['DELIVERY_UNAVAILABLE']); // B delivers to Karachi only

      const res = await preview(both(karachi));
      expect(res.body.data.ok).toBe(true);
      expect(
        res.body.data.stores.map((s: any) => [
          s.storeId,
          s.subtotal,
          s.discount,
          s.shippingFee,
          s.total,
        ]),
      ).toEqual([
        [storeA.id, 6000, 0, 0, 6000], // 2 × 3000, free from 6000
        [storeB.id, 2200, 0, 150, 2350],
      ]);
      expect(res.body.data.totals).toEqual({
        itemsTotal: 8200,
        discountTotal: 0,
        shippingTotal: 150,
        grandTotal: 8350,
      });
    });

    it('checks payment methods, COD limit, stock and the store set — and writes nothing', async () => {
      const stockBefore = await t.ds.query(
        `SELECT id, stock FROM product_variants ORDER BY id`,
      );

      const noAccount = await preview(both(karachi, 'transfer'));
      expect(codes(noAccount.body.data.stores[0])).toEqual([
        'PAYMENT_METHOD_UNAVAILABLE',
      ]);
      const iban = testIban();
      await a.api
        .post('/shop/partner/store/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Cart Couture',
          accountNumber: iban,
          bankName: 'Meezan Bank',
        })
        .expect(201);
      const transfer = await preview(both(karachi, 'transfer'));
      expect(transfer.body.data.ok).toBe(true);
      expect(transfer.body.data.stores[0].transferVia).toEqual(['bank']);
      expect(JSON.stringify(transfer.body)).not.toContain(iban.slice(4));

      await a.api
        .patch('/shop/partner/store/settings', { codLimit: 5000 })
        .expect(200);
      const cod = await preview(both(karachi));
      expect(cod.body.data.stores[0].issues).toEqual([
        expect.objectContaining({
          code: 'COD_LIMIT_EXCEEDED',
          details: { storeId: storeA.id, codLimit: 5000, total: 6000 },
        }),
      ]);
      await a.api
        .patch('/shop/partner/store/settings', { codEnabled: false })
        .expect(200);
      expect(codes((await preview(both(karachi))).body.data.stores[0])).toEqual(
        ['PAYMENT_METHOD_UNAVAILABLE'],
      );
      await a.api
        .patch('/shop/partner/store/settings', {
          codEnabled: true,
          codLimit: 10000,
        })
        .expect(200);

      await a.api
        .patch(`/shop/partner/inventory/${variant(kurta, 'M')}`, { setTo: 1 })
        .expect(200);
      const short = await preview(both(karachi));
      expect(short.body.data.stores[0].issues).toEqual([
        expect.objectContaining({
          code: 'OUT_OF_STOCK',
          details: expect.objectContaining({
            lines: [
              expect.objectContaining({
                variantId: variant(kurta, 'M'),
                requested: 2,
                available: 1,
              }),
            ],
          }),
        }),
      ]);
      await a.api
        .patch(`/shop/partner/inventory/${variant(kurta, 'M')}`, { setTo: 10 })
        .expect(200);

      const onlyA = await preview({
        addressId: karachi,
        stores: [{ storeId: storeA.id, paymentMethod: 'cod' }],
      });
      expect(onlyA.body.data.issues).toEqual([
        expect.objectContaining({
          code: 'CHECKOUT_MISMATCH',
          details: { missing: [storeB.id], unexpected: [] },
        }),
      ]);
      const stranger = '00000000-0000-4000-8000-000000000001';
      const extra = await preview({
        ...both(karachi),
        stores: [
          ...both(karachi).stores,
          { storeId: stranger, paymentMethod: 'cod' },
        ],
      });
      expect(extra.body.data.issues[0].details).toEqual({
        missing: [],
        unexpected: [stranger],
      });

      const someoneElse = await shopper(t);
      const theirAddress = await addAddress(someoneElse);
      expect(
        (await preview(both(theirAddress))).body.data.issues.map(
          (i: any) => i.code,
        ),
      ).toEqual(['NOT_FOUND']);
      const empty = await someoneElse.api
        .post('/shop/cart/preview', both(theirAddress))
        .expect(200);
      expect(empty.body.data.issues.map((i: any) => i.code)).toEqual([
        'CART_EMPTY',
      ]);

      await c.api
        .post('/shop/cart/preview', { addressId: karachi, stores: [] })
        .expect(400);
      await c.api
        .post('/shop/cart/preview', {
          addressId: karachi,
          stores: [{ storeId: storeA.id, paymentMethod: 'card' }],
        })
        .expect(400);

      // Nothing moved: stock, cart.
      expect(
        await t.ds.query(`SELECT id, stock FROM product_variants ORDER BY id`),
      ).toEqual(stockBefore);
      expect(
        (await c.api.get('/shop/cart').expect(200)).body.data.itemCount,
      ).toBe(3);
    });
  });

  describe('coupons', () => {
    const create = (p: Partner, body: Record<string, unknown>) =>
      p.api.post('/shop/partner/coupons', {
        type: 'percent',
        value: 10,
        endsAt: iso(30 * DAY),
        ...body,
      });

    it('partner CRUD: upper-case unique codes, valid terms, store-scoped', async () => {
      const made = await create(a, { code: 'eid15', value: 15 }).expect(201);
      expect(made.body.data).toMatchObject({
        code: 'EID15',
        type: 'percent',
        value: 15,
        minOrder: 0,
        perUserLimit: 1,
        usedCount: 0,
        state: 'active',
      });
      const id = made.body.data.id;

      expect(
        (await create(a, { code: 'Eid15' }).expect(409)).body.error.code,
      ).toBe('CONFLICT');
      await create(b, { code: 'EID15' }).expect(201); // another store may reuse it
      await create(a, { code: 'BIG', value: 150 }).expect(400);
      await create(a, { code: 'BAD CODE' }).expect(400);
      await create(a, { code: 'PAST', endsAt: iso(-DAY) }).expect(400);
      await create(a, {
        code: 'BACKWARD',
        startsAt: iso(10 * DAY),
        endsAt: iso(5 * DAY),
      }).expect(400);
      const later = await create(a, {
        code: 'LATER',
        startsAt: iso(5 * DAY),
      }).expect(201);
      expect(later.body.data.state).toBe('scheduled');

      for (const call of [
        () => b.api.get(`/shop/partner/coupons/${id}`),
        () => b.api.patch(`/shop/partner/coupons/${id}`, { value: 50 }),
        () => b.api.post(`/shop/partner/coupons/${id}/deactivate`),
      ]) {
        expect((await call().expect(404)).body.error.code).toBe('NOT_FOUND');
      }

      const scheduled = await a.api
        .get('/shop/partner/coupons?state=scheduled')
        .expect(200);
      expect(scheduled.body.data.items.map((c: any) => c.code)).toEqual([
        'LATER',
      ]);

      await t.ds.query(`UPDATE coupons SET used_count = 2 WHERE id = $1`, [id]);
      await a.api
        .patch(`/shop/partner/coupons/${id}`, { usageLimit: 1 })
        .expect(400);
      expect(
        (
          await a.api
            .patch(`/shop/partner/coupons/${id}`, { value: 20 })
            .expect(409)
        ).body.error.code,
      ).toBe('CONFLICT');
      const edited = await a.api
        .patch(`/shop/partner/coupons/${id}`, { usageLimit: 2, minOrder: 1000 })
        .expect(200);
      expect(edited.body.data).toMatchObject({
        usageLimit: 2,
        minOrder: 1000,
        state: 'exhausted',
      });

      const off = await a.api
        .post(`/shop/partner/coupons/${id}/deactivate`)
        .expect(200);
      expect(off.body.data).toMatchObject({
        isActive: false,
        state: 'inactive',
      });
    });

    it('preview applies a coupon; each failure returns its own code', async () => {
      const c = await shopper(t);
      const addressId = await addAddress(c);
      await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'M'),
          quantity: 1,
        })
        .expect(200);

      await create(a, { code: 'SAVE10', value: 10, maxDiscount: 250 }).expect(
        201,
      );
      await create(a, {
        code: 'FLAT500',
        type: 'fixed',
        value: 500,
        minOrder: 5000,
      }).expect(201);
      const oldie = await create(a, {
        code: 'OLDIE',
        startsAt: iso(-10 * DAY),
      }).expect(201);
      await t.ds.query(
        `UPDATE coupons SET ends_at = now() - interval '1 day' WHERE id = $1`,
        [oldie.body.data.id],
      );
      const gone = await create(a, { code: 'GONE', usageLimit: 1 }).expect(201);
      await t.ds.query(`UPDATE coupons SET used_count = 1 WHERE id = $1`, [
        gone.body.data.id,
      ]);
      const off = await create(a, { code: 'OFF' }).expect(201);
      await a.api
        .post(`/shop/partner/coupons/${off.body.data.id}/deactivate`)
        .expect(200);

      const withCode = async (couponCode: string) =>
        (
          await c.api
            .post('/shop/cart/preview', {
              addressId,
              stores: [
                { storeId: storeA.id, paymentMethod: 'cod', couponCode },
              ],
            })
            .expect(200)
        ).body.data.stores[0];

      // 10% of 3000 = 300, capped at 250; 2750 < 6000 so shipping 200.
      const ok = await withCode(' save10 ');
      expect(ok).toMatchObject({
        couponCode: 'SAVE10',
        subtotal: 3000,
        discount: 250,
        shippingFee: 200,
        total: 2950,
        issues: [],
      });

      const cases: Array<[string, string, Record<string, unknown>?]> = [
        [
          'FLAT500',
          'COUPON_MIN_ORDER',
          { minOrder: 5000, subtotal: 3000, shortBy: 2000 },
        ],
        ['OLDIE', 'COUPON_EXPIRED'],
        ['GONE', 'COUPON_LIMIT_REACHED', { scope: 'coupon' }],
        ['OFF', 'COUPON_INVALID'],
        ['LATER', 'COUPON_INVALID'],
        ['NOPE', 'COUPON_INVALID'],
        ['EID15', 'COUPON_INVALID'], // deactivated in the previous test
      ];
      for (const [code, expected, details] of cases) {
        const s = await withCode(code);
        expect({ code, issues: s.issues.map((i: any) => i.code) }).toEqual({
          code,
          issues: [expected],
        });
        if (details) expect(s.issues[0].details).toMatchObject(details);
        expect(s.discount).toBe(0);
      }

      const available = await c.api
        .get(`/shop/stores/${storeA.id}/coupons/available`)
        .expect(200);
      expect(available.body.data.storeSubtotal).toBe(3000);
      expect(
        available.body.data.items.map((x: any) => [
          x.code,
          x.eligible,
          x.discount,
          x.shortBy,
        ]),
      ).toEqual(
        expect.arrayContaining([
          ['SAVE10', true, 250, 0],
          ['FLAT500', false, 0, 2000],
        ]),
      );
      const listed = available.body.data.items.map((x: any) => x.code);
      for (const hidden of ['OLDIE', 'GONE', 'OFF', 'LATER', 'EID15'])
        expect(listed).not.toContain(hidden);
      await c.api
        .get(
          `/shop/stores/00000000-0000-4000-8000-000000000002/coupons/available`,
        )
        .expect(404);
    });
  });

  describe('wishlist', () => {
    it('saves, flags in the catalogue, survives a paused store, and unsaves', async () => {
      const c = await shopper(t);
      const saved = await c.api.post(`/shop/wishlist/${kurta.id}`).expect(200);
      expect(saved.body.data).toEqual({
        productId: kurta.id,
        isWishlisted: true,
      });
      await c.api.post(`/shop/wishlist/${kurta.id}`).expect(200); // idempotent
      await c.api.post(`/shop/wishlist/${shawl.id}`).expect(200);

      const detail = await c.api.get(`/shop/products/${kurta.id}`).expect(200);
      expect(detail.body.data.isWishlisted).toBe(true);
      const list = await c.api
        .get(`/shop/products?storeId=${storeA.id}`)
        .expect(200);
      expect(
        list.body.data.items.find((i: any) => i.id === kurta.id).isWishlisted,
      ).toBe(true);

      await b.api
        .patch('/shop/partner/store/settings', { isPaused: true })
        .expect(200);
      const mine = await c.api.get('/shop/wishlist').expect(200);
      expect(mine.body.data.total).toBe(2);
      expect(
        mine.body.data.items.map((i: any) => [i.name, i.available]),
      ).toEqual([
        ['Pashmina shawl', false],
        ['Chikankari kurta', true],
      ]);
      await b.api
        .patch('/shop/partner/store/settings', { isPaused: false })
        .expect(200);

      const draft = await listProduct(t, a, {
        name: 'Hidden kurta',
        status: 'draft',
      });
      await c.api.post(`/shop/wishlist/${draft.id}`).expect(404);

      const unsaved = await c.api
        .delete(`/shop/wishlist/${kurta.id}`)
        .expect(200);
      expect(unsaved.body.data.isWishlisted).toBe(false);
      await c.api.delete(`/shop/wishlist/${kurta.id}`).expect(200);
      expect(
        (await c.api.get(`/shop/products/${kurta.id}`).expect(200)).body.data
          .isWishlisted,
      ).toBe(false);
    });

    it('deleting the account deletes its cart and wishlist', async () => {
      const c = await shopper(t);
      await c.api
        .post('/shop/cart/items', {
          variantId: variant(kurta, 'S'),
          quantity: 1,
        })
        .expect(200);
      await c.api.post(`/shop/wishlist/${kurta.id}`).expect(200);
      await c.api.delete('/auth/account', { password: c.password }).expect(200);
      const [{ carts, wishes }] = await t.ds.query(
        `SELECT (SELECT count(*)::int FROM carts WHERE user_id = $1) AS carts,
                (SELECT count(*)::int FROM wishlist_items WHERE user_id = $1) AS wishes`,
        [c.userId],
      );
      expect({ carts, wishes }).toEqual({ carts: 0, wishes: 0 });
    });
  });
});
