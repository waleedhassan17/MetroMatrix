import { EntityManager } from 'typeorm';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import {
  Admin,
  Partner,
  approvedPartner,
  checkout,
  checkoutBody,
  customer,
  deliverOrder,
  fillCart,
  listProduct,
  orderFrom,
  simpleProduct,
  storeOf,
  testIban,
} from './utils/shopping';
import {
  CHECKOUT_FAULT_INJECTOR,
  CheckoutFaultInjector,
} from '../src/modules/shopping/checkout/checkout.service';
import { OrderJobsService } from '../src/modules/shopping/orders/order-jobs.service';

const fault: CheckoutFaultInjector & { armed: boolean } = {
  armed: false,
  afterStockDecrement(_m: EntityManager) {
    if (fault.armed) throw new Error('injected failure after stock decrement');
  },
};

/**
 * The Chunk 2 release gate: one test per row of the Shopping QA matrix.
 * Add rows, never delete them.
 */
describe('QA matrix — Shopping (Chunk 2)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: OrderJobsService;
  // A: COD store. B: transfer store with a bank account. C: delivers to Karachi only.
  let a: Partner, b: Partner, c: Partner;
  let A: { id: string; slug: string },
    B: { id: string; slug: string },
    C: { id: string; slug: string };
  let iban: string;
  let anon: ApiClient;

  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const stockOf = async (variantId: string) =>
    (
      await sql(`SELECT stock FROM product_variants WHERE id = $1`, [variantId])
    )[0].stock;
  const notifications = (userId: string, type: string) =>
    sql(`SELECT data FROM notifications WHERE user_id = $1 AND type = $2`, [
      userId,
      type,
    ]);

  beforeAll(async () => {
    t = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(CHECKOUT_FAULT_INJECTOR).useValue(fault),
    });
    jobs = t.app.get(OrderJobsService);
    admin = await enrolledAdmin(t);
    a = await approvedPartner(t, admin, 'store', 'QA Apparel');
    b = await approvedPartner(t, admin, 'store', 'QA Bazaar');
    c = await approvedPartner(t, admin, 'store', 'QA Karachi Crafts');
    [A, B, C] = await Promise.all([storeOf(a), storeOf(b), storeOf(c)]);
    await a.api
      .patch('/shop/partner/store/settings', {
        shippingFlatFee: 200,
        freeShippingOver: null,
        codLimit: 10000,
      })
      .expect(200);
    await b.api
      .patch('/shop/partner/store/settings', { shippingFlatFee: 150 })
      .expect(200);
    await c.api
      .patch('/shop/partner/store/settings', {
        shippingFlatFee: 100,
        deliveryCities: ['Karachi'],
      })
      .expect(200);
    iban = testIban();
    await b.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'bank',
        accountTitle: 'QA Bazaar',
        accountNumber: iban,
        bankName: 'Meezan Bank',
      })
      .expect(201);
    anon = new ApiClient(t.http);
  });
  afterAll(() => t.close());

  it('QA #1 guest lists products: 200 without auth, no account numbers in any catalogue payload', async () => {
    const p = await simpleProduct(t, b, 'QA guest kurta', 2000, 5);
    const payloads = await Promise.all(
      [
        '/shop/home',
        '/shop/categories',
        '/shop/stores',
        `/shop/stores/${B.slug}`,
        '/shop/products',
        `/shop/products/${p.id}`,
        `/shop/products/${p.id}/related`,
        `/shop/products/${p.id}/reviews`,
        '/shop/products/suggest?q=qa',
      ].map(async (path) => {
        const res = await anon.get(path);
        expect({ path, status: res.status }).toEqual({ path, status: 200 });
        return JSON.stringify(res.body);
      }),
    );
    const digits = iban.slice(4);
    payloads.forEach((body) => expect(body).not.toContain(digits));
    const store = (await anon.get(`/shop/stores/${B.slug}`)).body.data;
    expect(store.policies.transferVia).toEqual(['bank']);
  });

  it('QA #2 onSale=true returns only products with a sale price', async () => {
    await listProduct(t, a, {
      name: 'QA sale lawn',
      basePrice: 3000,
      salePrice: 2500,
      variants: [{ option1: 'M', stock: 3 }],
    });
    await listProduct(t, a, {
      name: 'QA full-price lawn',
      basePrice: 2800,
      variants: [{ option1: 'M', stock: 3 }],
    });
    const items = (
      await anon.get(`/shop/products?storeId=${A.id}&onSale=true`).expect(200)
    ).body.data.items;
    expect(items.length).toBeGreaterThan(0);
    items.forEach((i: any) =>
      expect(i).toMatchObject({ onSale: true, salePrice: expect.any(Number) }),
    );
    expect(items.map((i: any) => i.name)).not.toContain('QA full-price lawn');
  });

  it('QA #3 price_asc sorts by the effective price (sale when on sale)', async () => {
    const items = (
      await anon
        .get(`/shop/products?storeId=${A.id}&sort=price_asc`)
        .expect(200)
    ).body.data.items;
    const prices = items.map((i: any) => i.price);
    expect(prices).toEqual([...prices].sort((x: number, y: number) => x - y));
    // The 3000 lawn on sale at 2500 sorts before the 2800 one.
    const names = items.map((i: any) => i.name);
    expect(names.indexOf('QA sale lawn')).toBeLessThan(
      names.indexOf('QA full-price lawn'),
    );
  });

  it('QA #4 a typo still finds the product (trigram fallback)', async () => {
    await simpleProduct(t, a, 'QA chikankari kurta', 4000, 3);
    const items = (
      await anon.get(`/shop/products?storeId=${A.id}&q=chikenkari`).expect(200)
    ).body.data.items;
    expect(items.map((i: any) => i.name)).toContain('QA chikankari kurta');
  });

  it('QA #5 adding the same variant twice makes one line, summed and capped at stock', async () => {
    const p = await simpleProduct(t, a, 'QA cap test', 1000, 3);
    const cust = await customer(t);
    await cust.api
      .post('/shop/cart/items', { variantId: p.variantId, quantity: 2 })
      .expect(200);
    const res = await cust.api
      .post('/shop/cart/items', { variantId: p.variantId, quantity: 2 })
      .expect(200);
    expect(res.body.data.lineCount).toBe(1);
    expect(res.body.data.stores[0].items[0].quantity).toBe(3);
    expect(res.body.data.adjusted).toMatchObject({
      requested: 4,
      quantity: 3,
      reason: 'stock',
    });
  });

  it('QA #6 a price edit flags PRICE_CHANGED in the cart and checkout charges the new price', async () => {
    const p = await simpleProduct(t, a, 'QA reprice', 2000, 5);
    const cust = await customer(t);
    await fillCart(cust, [[p.variantId, 1]]);
    await a.api
      .patch(`/shop/partner/products/${p.id}`, { basePrice: 2400 })
      .expect(200);
    const line = (await cust.api.get('/shop/cart').expect(200)).body.data
      .stores[0].items[0];
    expect(line.warnings.map((w: any) => w.code)).toContain('PRICE_CHANGED');
    const g = (
      await checkout(cust, checkoutBody(cust, [A.id, 'cod'])).expect(201)
    ).body.data;
    expect(g.storeOrders[0].items[0].unitPrice).toBe(2400);
    expect(g.storeOrders[0].total).toBe(2600);
  });

  it('QA #7 3-store checkout: group = Σ stores (difference 0) and each store is notified', async () => {
    const pa = await simpleProduct(t, a, 'QA three A', 1500, 5);
    const pb = await simpleProduct(t, b, 'QA three B', 2500, 5);
    const pc = await simpleProduct(t, c, 'QA three C', 900, 5);
    const cust = await customer(t, { city: 'Karachi' });
    await fillCart(cust, [
      [pa.variantId, 2],
      [pb.variantId, 1],
      [pc.variantId, 3],
    ]);
    const g = (
      await checkout(
        cust,
        checkoutBody(cust, [A.id, 'cod'], [B.id, 'transfer'], [C.id, 'cod']),
      ).expect(201)
    ).body.data;
    const sum = g.storeOrders.reduce((n: number, o: any) => n + o.total, 0);
    expect(g.grandTotal - sum).toBe(0);
    g.storeOrders.forEach((o: any) =>
      expect(o.total - (o.subtotal - o.discount + o.shippingFee)).toBe(0),
    );
    for (const [p, o] of [
      [a, g.storeOrders[0]],
      [b, g.storeOrders[1]],
      [c, g.storeOrders[2]],
    ] as const) {
      const n = await notifications(p.userId, 'shop.order.new');
      expect(n.map((x: any) => x.data.code)).toContain(o.code);
    }
  });

  it('QA #8 two buyers for the last unit at once: one wins, one OUT_OF_STOCK, stock 0', async () => {
    const p = await simpleProduct(t, a, 'QA last unit', 1800, 1);
    const [x, y] = await Promise.all([customer(t), customer(t)]);
    await fillCart(x, [[p.variantId, 1]]);
    await fillCart(y, [[p.variantId, 1]]);
    const res = await Promise.all(
      [x, y].map((u) => checkout(u, checkoutBody(u, [A.id, 'cod']))),
    );
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.error.code).toBe(
      'OUT_OF_STOCK',
    );
    expect(await stockOf(p.variantId)).toBe(0);
  });

  it('QA #9 an injected failure after the decrement persists nothing', async () => {
    const p = await simpleProduct(t, a, 'QA fault', 1200, 4);
    const cust = await customer(t);
    await fillCart(cust, [[p.variantId, 2]]);
    fault.armed = true;
    try {
      await checkout(cust, checkoutBody(cust, [A.id, 'cod'])).expect(500);
    } finally {
      fault.armed = false;
    }
    expect(await stockOf(p.variantId)).toBe(4);
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM order_groups WHERE user_id = $1`,
      [cust.userId],
    );
    expect(n).toBe(0);
    expect(
      (await cust.api.get('/shop/cart').expect(200)).body.data.itemCount,
    ).toBe(2);
  });

  it('QA #10 replaying the same Idempotency-Key places a single order', async () => {
    const p = await simpleProduct(t, a, 'QA replay', 700, 5);
    const cust = await customer(t);
    await fillCart(cust, [[p.variantId, 1]]);
    const body = checkoutBody(cust, [A.id, 'cod']);
    const first = await checkout(cust, body, 'qa-10-key').expect(201);
    const second = await checkout(cust, body, 'qa-10-key').expect(201);
    expect(second.body).toEqual(first.body);
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM order_groups WHERE user_id = $1`,
      [cust.userId],
    );
    expect(n).toBe(1);
  });

  it('QA #11 COD above the store limit → COD_LIMIT_EXCEEDED', async () => {
    const p = await simpleProduct(t, a, 'QA big ticket', 11000, 2);
    const cust = await customer(t);
    await fillCart(cust, [[p.variantId, 1]]);
    const res = await checkout(cust, checkoutBody(cust, [A.id, 'cod'])).expect(
      400,
    );
    expect(res.body.error).toMatchObject({
      code: 'COD_LIMIT_EXCEEDED',
      details: { codLimit: 10000, total: 11200 },
    });
  });

  it('QA #12 a city outside one store’s cities → DELIVERY_UNAVAILABLE for that store only (preview)', async () => {
    const pa = await simpleProduct(t, a, 'QA city A', 1000, 5);
    const pc = await simpleProduct(t, c, 'QA city C', 1000, 5);
    const cust = await customer(t, { city: 'Lahore' });
    await fillCart(cust, [
      [pa.variantId, 1],
      [pc.variantId, 1],
    ]);
    const res = (
      await cust.api
        .post(
          '/shop/cart/preview',
          checkoutBody(cust, [A.id, 'cod'], [C.id, 'cod']),
        )
        .expect(200)
    ).body.data;
    expect(
      res.stores.map((s: any) => [s.storeId, s.issues.map((i: any) => i.code)]),
    ).toEqual([
      [A.id, []],
      [C.id, ['DELIVERY_UNAVAILABLE']],
    ]);
  });

  it('QA #13 transfer: proof → store rejects → proof again → confirmed; statuses and events correct', async () => {
    const p = await simpleProduct(t, b, 'QA transfer', 3000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, B.id, [[p.variantId, 1]], 'transfer');
    await cust.api
      .post(`/shop/store-orders/${o.id}/payment-proof`, {
        paymentRef: 'IBFT 1',
      })
      .expect(200);
    await b.api
      .post(`/shop/partner/orders/${o.id}/payment/reject`, {
        reason: 'Not received',
      })
      .expect(200);
    await cust.api
      .post(`/shop/store-orders/${o.id}/payment-proof`, {
        paymentRef: 'IBFT 2',
      })
      .expect(200);
    const done = (
      await b.api
        .post(`/shop/partner/orders/${o.id}/payment/confirm`)
        .expect(200)
    ).body.data;
    expect(done).toMatchObject({
      status: 'placed',
      paymentStatus: 'paid',
      payment: { paymentRef: 'IBFT 2' },
    });
    expect(
      done.events
        .filter((e: any) => e.kind === 'payment')
        .map((e: any) => e.to),
    ).toEqual([
      'proof_submitted',
      'awaiting_transfer',
      'proof_submitted',
      'paid',
    ]);
  });

  it('QA #14 shipping a transfer order before payment is confirmed → PAYMENT_NOT_CONFIRMED', async () => {
    const p = await simpleProduct(t, b, 'QA early ship', 3000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, B.id, [[p.variantId, 1]], 'transfer');
    await b.api.post(`/shop/partner/orders/${o.id}/confirm`).expect(200);
    await b.api.post(`/shop/partner/orders/${o.id}/pack`).expect(200);
    const res = await b.api
      .post(`/shop/partner/orders/${o.id}/ship`, {
        courierName: 'TCS',
        trackingRef: 'TCS-1',
      })
      .expect(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_CONFIRMED');
  });

  it('QA #15 an unpaid transfer at 24 h is system-cancelled, restocked, both sides notified', async () => {
    const p = await simpleProduct(t, b, 'QA unpaid', 2000, 3);
    const cust = await customer(t);
    const o = await orderFrom(cust, B.id, [[p.variantId, 2]], 'transfer');
    await sql(
      `UPDATE store_orders SET pay_by = now() - interval '1 second' WHERE id = $1`,
      [o.id],
    );
    await jobs.cancelUnpaidTransfers();
    const [row] = await sql(
      `SELECT status, cancelled_by FROM store_orders WHERE id = $1`,
      [o.id],
    );
    expect(row).toEqual({ status: 'cancelled', cancelled_by: 'system' });
    expect(await stockOf(p.variantId)).toBe(3);
    for (const userId of [cust.userId, b.userId]) {
      const n = await notifications(userId, 'shop.order.cancelled');
      expect(n.map((x: any) => x.data.storeOrderId)).toContain(o.id);
    }
  });

  it('QA #16 a customer “cancel” after confirmation only records a cancel request', async () => {
    const p = await simpleProduct(t, a, 'QA late cancel', 1000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 1]]);
    await a.api.post(`/shop/partner/orders/${o.id}/confirm`).expect(200);
    expect(
      (
        await cust.api
          .post(`/shop/store-orders/${o.id}/cancel`, {
            reason: 'Changed my mind',
          })
          .expect(409)
      ).body.error.code,
    ).toBe('INVALID_TRANSITION');
    const req = (
      await cust.api
        .post(`/shop/store-orders/${o.id}/request-cancel`, {
          reason: 'Changed my mind',
        })
        .expect(200)
    ).body.data;
    expect(req.status).toBe('confirmed');
    expect(req.cancelRequestedAt).toBeTruthy();
    expect(req.events.at(-1)).toMatchObject({
      kind: 'note',
      note: 'Cancellation requested: Changed my mind',
    });
  });

  it('QA #17 a store cancelling a confirmed order without a reason → 400', async () => {
    const p = await simpleProduct(t, a, 'QA no reason', 1000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 1]]);
    await a.api.post(`/shop/partner/orders/${o.id}/confirm`).expect(200);
    const res = await a.api
      .post(`/shop/partner/orders/${o.id}/cancel`, {})
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('QA #18 a return on day 8 of a 7-day window → RETURN_WINDOW_CLOSED', async () => {
    const p = await simpleProduct(t, a, 'QA late return', 1000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 1]]);
    await deliverOrder(a, o.id);
    await sql(
      `UPDATE store_orders SET delivered_at = now() - interval '8 days' WHERE id = $1`,
      [o.id],
    );
    const res = await cust.api
      .post(`/shop/store-orders/${o.id}/returns`, {
        items: [{ orderItemId: o.items[0].id, quantity: 1 }],
        reason: 'size_issue',
      })
      .expect(400);
    expect(res.body.error.code).toBe('RETURN_WINDOW_CLOSED');
  });

  it('QA #19 a return received with restock raises stock and writes a movement', async () => {
    const p = await simpleProduct(t, a, 'QA restock', 1000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 2]]);
    await deliverOrder(a, o.id);
    const r = (
      await cust.api
        .post(`/shop/store-orders/${o.id}/returns`, {
          items: [{ orderItemId: o.items[0].id, quantity: 2 }],
          reason: 'damaged',
        })
        .expect(201)
    ).body.data;
    await a.api.post(`/shop/partner/returns/${r.id}/approve`, {}).expect(200);
    await a.api
      .post(`/shop/partner/returns/${r.id}/receive`, {
        items: [{ returnItemId: r.items[0].id, restock: true }],
      })
      .expect(200);
    expect(await stockOf(p.variantId)).toBe(5);
    const [m] = await sql(
      `SELECT delta, reason FROM inventory_movements WHERE variant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [p.variantId],
    );
    expect(m).toEqual({ delta: 2, reason: 'return_restock' });
  });

  it('QA #20 review before delivery → REVIEW_NOT_ALLOWED; after delivery once only', async () => {
    const p = await simpleProduct(t, a, 'QA review', 1000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 1]]);
    const path = `/shop/order-items/${o.items[0].id}/review`;
    expect(
      (await cust.api.post(path, { rating: 5 }).expect(403)).body.error.code,
    ).toBe('REVIEW_NOT_ALLOWED');
    await deliverOrder(a, o.id);
    await cust.api.post(path, { rating: 5 }).expect(201);
    expect(
      (await cust.api.post(path, { rating: 4 }).expect(409)).body.error.code,
    ).toBe('REVIEW_EXISTS');
  });

  it('QA #21 store B reading store A’s order, product and inventory gets 404 each; A’s data unchanged', async () => {
    const p = await simpleProduct(t, a, 'QA private', 1000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 1]]);
    for (const res of [
      await b.api.get(`/shop/partner/orders/${o.id}`),
      await b.api.post(`/shop/partner/orders/${o.id}/confirm`),
      await b.api.get(`/shop/partner/products/${p.id}`),
      await b.api.patch(`/shop/partner/products/${p.id}`, {
        name: 'Taken over',
      }),
      await b.api.patch(`/shop/partner/inventory/${p.variantId}`, { setTo: 0 }),
      await b.api.get(`/shop/partner/inventory/${p.variantId}/movements`),
    ]) {
      expect({ status: res.status, code: res.body.error?.code }).toEqual({
        status: 404,
        code: 'NOT_FOUND',
      });
    }
    const [row] = await sql(
      `SELECT p.name, v.stock, so.status FROM products p JOIN product_variants v ON v.product_id = p.id
         JOIN store_orders so ON so.id = $2 WHERE p.id = $1`,
      [p.id, o.id],
    );
    expect(row).toEqual({ name: 'QA private', stock: 4, status: 'placed' });
  });

  it('QA #22 a doctor partner on /shop/partner/products → 403 WRONG_SERVICE', async () => {
    const doctor = await approvedPartner(t, admin, 'doctor');
    const res = await doctor.api.get('/shop/partner/products').expect(403);
    expect(res.body.error).toMatchObject({
      code: 'WRONG_SERVICE',
      details: { required: 'shopping', actual: 'healthcare' },
    });
  });

  it('QA #23 admin removes a product: hidden from catalogue and search, store notified, orders intact', async () => {
    const p = await simpleProduct(t, a, 'QA removable lamp', 1500, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 1]]);
    await admin.api
      .post(`/admin/shop/products/${p.id}/remove`, { reason: 'Unsafe wiring' })
      .expect(200);
    await anon.get(`/shop/products/${p.id}`).expect(404);
    expect(
      (await anon.get('/shop/products?q=removable').expect(200)).body.data
        .items,
    ).toEqual([]);
    expect(
      (
        await anon
          .get(`/shop/products?storeId=${A.id}&pageSize=100`)
          .expect(200)
      ).body.data.items.map((i: any) => i.id),
    ).not.toContain(p.id);
    expect(
      (await notifications(a.userId, 'shop.product.removed')).map(
        (n: any) => n.data.productId,
      ),
    ).toContain(p.id);
    const view = (await cust.api.get(`/shop/store-orders/${o.id}`).expect(200))
      .body.data;
    expect(view).toMatchObject({
      status: 'placed',
      items: [{ productName: 'QA removable lamp', unitPrice: 1500 }],
    });
  });

  it('QA #24 the daily completion job run twice gives the same result and no duplicate events', async () => {
    const p = await simpleProduct(t, a, 'QA complete', 1000, 5);
    const cust = await customer(t);
    const o = await orderFrom(cust, A.id, [[p.variantId, 1]]);
    await deliverOrder(a, o.id);
    await sql(
      `UPDATE store_orders SET delivered_at = now() - interval '8 days' WHERE id = $1`,
      [o.id],
    );
    const events = async () =>
      (
        await sql(
          `SELECT count(*)::int AS n FROM store_order_events WHERE store_order_id = $1`,
          [o.id],
        )
      )[0].n;
    await jobs.completeDelivered();
    const once = {
      status: (
        await sql(`SELECT status FROM store_orders WHERE id = $1`, [o.id])
      )[0].status,
      events: await events(),
    };
    expect(once.status).toBe('completed');
    const second = await jobs.completeDelivered();
    expect(second).toEqual({ completed: 0 });
    expect({
      status: (
        await sql(`SELECT status FROM store_orders WHERE id = $1`, [o.id])
      )[0].status,
      events: await events(),
    }).toEqual(once);
  });
});
