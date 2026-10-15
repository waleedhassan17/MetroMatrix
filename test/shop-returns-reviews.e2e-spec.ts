import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import {
  Admin,
  Partner,
  approvedPartner,
  asset,
  customer,
  deliverOrder,
  orderFrom,
  simpleProduct,
  storeOf,
} from './utils/shopping';
import { ReviewsService } from '../src/modules/shopping/reviews/reviews.service';
import { OrderJobsService } from '../src/modules/shopping/orders/order-jobs.service';

describe('Shopping P5: returns, reviews, reports, insights (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let p: Partner; // the store under test
  let q: Partner; // another store, for isolation
  let storeP: { id: string };

  const sql = (s: string, params: unknown[] = []) => t.ds.query(s, params);
  const stockOf = async (variantId: string) =>
    (
      await sql(`SELECT stock FROM product_variants WHERE id = $1`, [variantId])
    )[0].stock;
  const deliveredDaysAgo = (orderId: string, days: number) =>
    sql(
      `UPDATE store_orders SET delivered_at = now() - make_interval(days => $2) WHERE id = $1`,
      [orderId, days],
    );

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    p = await approvedPartner(t, admin, 'store', 'Return Rasta');
    q = await approvedPartner(t, admin, 'store', 'Quiet Quarters');
    storeP = await storeOf(p);
    await p.api
      .patch('/shop/partner/store/settings', {
        shippingFlatFee: 0,
        returnWindowDays: 7,
      })
      .expect(200);
  });
  afterAll(() => t.close());

  describe('returns', () => {
    it('only inside the window, after delivery, one open at a time', async () => {
      const shirt = await simpleProduct(t, p, 'Linen shirt', 2500, 10);
      const c = await customer(t);
      const order = await orderFrom(c, storeP.id, [[shirt.variantId, 2]]);
      const line = order.items[0];
      const ask = (who = c, qty = 1) =>
        who.api.post(`/shop/store-orders/${order.id}/returns`, {
          items: [{ orderItemId: line.id, quantity: qty }],
          reason: 'size_issue',
          details: 'Too tight on the shoulders.',
        });

      const early = await ask().expect(409);
      expect(early.body.error.code).toBe('INVALID_TRANSITION');

      await deliverOrder(p, order.id);
      await deliveredDaysAgo(order.id, 8); // day 8 of a 7-day window
      const late = await ask().expect(400);
      expect(late.body.error).toMatchObject({
        code: 'RETURN_WINDOW_CLOSED',
        details: { returnWindowDays: 7 },
      });

      await deliveredDaysAgo(order.id, 6);
      await ask(c, 3).expect(400); // only 2 were bought
      await c.api
        .post(`/shop/store-orders/${order.id}/returns`, {
          items: [
            {
              orderItemId: '00000000-0000-4000-8000-000000000009',
              quantity: 1,
            },
          ],
          reason: 'other',
        })
        .expect(404);
      const stranger = await customer(t);
      await ask(stranger).expect(404);
      await c.api
        .post(`/shop/store-orders/${order.id}/returns`, {
          items: [{ orderItemId: line.id, quantity: 1 }],
          reason: 'damaged',
          photos: [asset(stranger.userId, 'return_photo').url],
        })
        .expect(400);

      const made = await c.api
        .post(`/shop/store-orders/${order.id}/returns`, {
          items: [{ orderItemId: line.id, quantity: 1 }],
          reason: 'damaged',
          photos: [asset(c.userId, 'return_photo').url],
        })
        .expect(201);
      expect(made.body.data).toMatchObject({
        status: 'requested',
        reason: 'damaged',
        value: 2500,
        storeOrderCode: order.code,
        items: [{ orderItemId: line.id, quantity: 1, restocked: null }],
      });
      const again = await ask().expect(409);
      expect(again.body.error.code).toBe('RETURN_ALREADY_OPEN');

      const view = (
        await c.api.get(`/shop/store-orders/${order.id}`).expect(200)
      ).body.data;
      expect(view.can.requestReturn).toBe(false);
      expect(view.events.at(-1)).toMatchObject({
        kind: 'note',
        note: 'Return requested: 1 item(s), damaged',
      });
      const mine = await c.api.get('/shop/returns').expect(200);
      expect(mine.body.data.items.map((r: any) => r.id)).toEqual([
        made.body.data.id,
      ]);
      const notified = await sql(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'shop.return.requested'`,
        [p.userId],
      );
      expect(notified.length).toBeGreaterThanOrEqual(1);

      // A rejection closes it, so the customer may ask again.
      const id = made.body.data.id;
      await p.api.post(`/shop/partner/returns/${id}/reject`, {}).expect(400); // note required
      const rejected = await p.api
        .post(`/shop/partner/returns/${id}/reject`, {
          note: 'Damage is from use',
        })
        .expect(200);
      expect(rejected.body.data).toMatchObject({
        status: 'rejected',
        storeNote: 'Damage is from use',
      });
      await ask().expect(201);
    });

    it('receive restocks only the flagged lines, once; the refund is capped and recorded', async () => {
      const kurta = await simpleProduct(t, p, 'Cotton kurta', 3000, 10);
      const cap = await simpleProduct(t, p, 'Prayer cap', 400, 5);
      const c = await customer(t);
      const order = await orderFrom(c, storeP.id, [
        [kurta.variantId, 2],
        [cap.variantId, 1],
      ]);
      await deliverOrder(p, order.id);
      expect([
        await stockOf(kurta.variantId),
        await stockOf(cap.variantId),
      ]).toEqual([8, 4]);
      const [kurtaLine, capLine] = order.items;

      const r = (
        await c.api
          .post(`/shop/store-orders/${order.id}/returns`, {
            items: [
              { orderItemId: kurtaLine.id, quantity: 2 },
              { orderItemId: capLine.id, quantity: 1 },
            ],
            reason: 'not_as_described',
          })
          .expect(201)
      ).body.data;
      expect(r.value).toBe(6400);

      // Another store sees none of it.
      for (const call of [
        () => q.api.get(`/shop/partner/returns/${r.id}`),
        () => q.api.post(`/shop/partner/returns/${r.id}/approve`, {}),
        () => q.api.post(`/shop/partner/returns/${r.id}/receive`, {}),
        () =>
          q.api.post(`/shop/partner/returns/${r.id}/refund`, {
            amount: 1,
            refundRef: 'X-1',
          }),
      ]) {
        expect((await call()).status).toBe(404);
      }

      const early = await p.api
        .post(`/shop/partner/returns/${r.id}/receive`, {})
        .expect(409);
      expect(early.body.error).toMatchObject({
        code: 'INVALID_TRANSITION',
        details: { from: 'requested', to: 'received' },
      });
      await p.api
        .post(`/shop/partner/returns/${r.id}/approve`, {
          note: 'Send with tags',
        })
        .expect(200);
      const [kItem, cItem] = r.items;
      const received = await p.api
        .post(`/shop/partner/returns/${r.id}/receive`, {
          items: [
            { returnItemId: kItem.id, restock: true },
            { returnItemId: cItem.id, restock: false },
          ],
        })
        .expect(200);
      expect(received.body.data.items.map((i: any) => i.restocked)).toEqual([
        true,
        false,
      ]);
      expect([
        await stockOf(kurta.variantId),
        await stockOf(cap.variantId),
      ]).toEqual([10, 4]);
      const [m] = await sql(
        `SELECT delta, reason, ref_type, balance_after FROM inventory_movements WHERE variant_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [kurta.variantId],
      );
      expect(m).toEqual({
        delta: 2,
        reason: 'return_restock',
        ref_type: 'return_request',
        balance_after: 10,
      });
      const returned = await sql(
        `SELECT returned_qty FROM store_order_items WHERE store_order_id = $1 ORDER BY created_at, id`,
        [order.id],
      );
      expect(returned.map((x: any) => x.returned_qty).sort()).toEqual([1, 2]);

      await p.api.post(`/shop/partner/returns/${r.id}/receive`, {}).expect(409);
      await p.api
        .post(`/shop/partner/returns/${r.id}/refund`, {
          amount: 6401,
          refundRef: 'IBFT 1',
        })
        .expect(400);
      const refunded = await p.api
        .post(`/shop/partner/returns/${r.id}/refund`, {
          amount: 6400,
          refundRef: 'IBFT 4410',
        })
        .expect(200);
      expect(refunded.body.data).toMatchObject({
        status: 'refunded',
        refundAmount: 6400,
        refundRef: 'IBFT 4410',
      });
      await p.api
        .post(`/shop/partner/returns/${r.id}/refund`, {
          amount: 1,
          refundRef: 'IBFT 2',
        })
        .expect(409);
      // The FYP restocked twice on refund; here stock moved only at receive.
      expect(await stockOf(kurta.variantId)).toBe(10);
      // The store order's own payment status is untouched by a return.
      const view = (
        await c.api.get(`/shop/store-orders/${order.id}`).expect(200)
      ).body.data;
      expect(view).toMatchObject({
        status: 'delivered',
        paymentStatus: 'cod_pending',
      });
      expect(view.items.map((i: any) => i.returnedQty).sort()).toEqual([1, 2]);
    });

    it('the completion job waits for an open return to settle', async () => {
      const jobs = t.app.get(OrderJobsService);
      const bag = await simpleProduct(t, p, 'Jute bag', 900, 5);
      const c = await customer(t);
      const order = await orderFrom(c, storeP.id, [[bag.variantId, 1]]);
      await deliverOrder(p, order.id);
      const r = (
        await c.api
          .post(`/shop/store-orders/${order.id}/returns`, {
            items: [{ orderItemId: order.items[0].id, quantity: 1 }],
            reason: 'wrong_item',
          })
          .expect(201)
      ).body.data;
      await deliveredDaysAgo(order.id, 9);
      await jobs.completeDelivered();
      const status = async () =>
        (
          await sql(`SELECT status FROM store_orders WHERE id = $1`, [order.id])
        )[0].status;
      expect(await status()).toBe('delivered');
      await p.api
        .post(`/shop/partner/returns/${r.id}/reject`, {
          note: 'Item was correct',
        })
        .expect(200);
      await jobs.completeDelivered();
      expect(await status()).toBe('completed');
    });
  });

  describe('reviews', () => {
    it('only after delivery, once per line; ratings follow create, hide and unhide', async () => {
      const reviews = t.app.get(ReviewsService);
      const lamp = await simpleProduct(t, p, 'Clay lamp', 1500, 10);
      const [c1, c2] = [await customer(t), await customer(t)];
      const o1 = await orderFrom(c1, storeP.id, [[lamp.variantId, 1]]);
      const o2 = await orderFrom(c2, storeP.id, [[lamp.variantId, 1]]);
      const review = (c: typeof c1, lineId: string, body: object) =>
        c.api.post(`/shop/order-items/${lineId}/review`, body);

      const early = await review(c1, o1.items[0].id, { rating: 5 }).expect(403);
      expect(early.body.error.code).toBe('REVIEW_NOT_ALLOWED');
      await deliverOrder(p, o1.id);
      await deliverOrder(p, o2.id);
      await review(c2, o1.items[0].id, { rating: 1 }).expect(404); // not their line

      const first = await review(c1, o1.items[0].id, {
        rating: 5,
        text: 'Lovely glaze.',
        photos: [asset(c1.userId, 'review_photo').url],
      }).expect(201);
      expect(first.body.data).toMatchObject({
        rating: 5,
        author: { name: 'Test U.' },
      });
      expect(
        (await review(c1, o1.items[0].id, { rating: 4 }).expect(409)).body.error
          .code,
      ).toBe('REVIEW_EXISTS');
      const second = await review(c2, o2.items[0].id, {
        rating: 2,
        text: 'Arrived chipped.',
      }).expect(201);

      const ratings = async () => {
        const [prod] = await sql(
          `SELECT rating_avg::float AS avg, rating_count AS n FROM products WHERE id = $1`,
          [lamp.id],
        );
        const [store] = await sql(
          `SELECT rating_avg::float AS avg, rating_count AS n FROM stores WHERE id = $1`,
          [storeP.id],
        );
        return { prod, store };
      };
      expect((await ratings()).prod).toEqual({ avg: 3.5, n: 2 });

      const detail = await t.app.get(ReviewsService).breakdown(lamp.id);
      expect(detail).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 });
      const pub = await c1.api.get(`/shop/products/${lamp.id}`).expect(200);
      expect(pub.body.data).toMatchObject({
        ratingAvg: 3.5,
        ratingCount: 2,
        ratingBreakdown: { 2: 1, 5: 1 },
      });

      await reviews.setHidden(second.body.data.id, true, 'Abusive language');
      expect((await ratings()).prod).toEqual({ avg: 5, n: 1 });
      const storeAfterHide = (await ratings()).store;
      expect(storeAfterHide.n).toBeGreaterThanOrEqual(1);
      const list = await c1.api
        .get(`/shop/products/${lamp.id}/reviews`)
        .expect(200);
      expect(list.body.data.items.map((r: any) => r.rating)).toEqual([5]);
      expect(list.body.data.summary).toEqual({
        ratingAvg: 5,
        ratingCount: 1,
        breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      });
      await reviews.setHidden(second.body.data.id, false, null);
      expect((await ratings()).prod).toEqual({ avg: 3.5, n: 2 });

      const withPhotos = await c1.api
        .get(`/shop/products/${lamp.id}/reviews?withPhotos=true`)
        .expect(200);
      expect(withPhotos.body.data.items.map((r: any) => r.text)).toEqual([
        'Lovely glaze.',
      ]);
      const twos = await c1.api
        .get(`/shop/products/${lamp.id}/reviews?rating=2`)
        .expect(200);
      expect(twos.body.data.total).toBe(1);

      const view = (await c1.api.get(`/shop/store-orders/${o1.id}`).expect(200))
        .body.data;
      expect(view.items[0]).toMatchObject({ reviewed: true, canReview: false });
    });

    it('a store replies once and may edit for 24 hours', async () => {
      const mat = await simpleProduct(t, p, 'Prayer mat', 1800, 5);
      const c = await customer(t);
      const o = await orderFrom(c, storeP.id, [[mat.variantId, 1]]);
      await deliverOrder(p, o.id);
      const r = (
        await c.api
          .post(`/shop/order-items/${o.items[0].id}/review`, { rating: 4 })
          .expect(201)
      ).body.data;

      const unreplied = await p.api
        .get('/shop/partner/reviews?unreplied=true&pageSize=100')
        .expect(200);
      expect(unreplied.body.data.items.map((x: any) => x.id)).toContain(r.id);
      await q.api
        .post(`/shop/partner/reviews/${r.id}/reply`, { text: 'Not my review' })
        .expect(404);
      const replied = await p.api
        .post(`/shop/partner/reviews/${r.id}/reply`, { text: 'Thank you!' })
        .expect(200);
      expect(replied.body.data.storeReply).toBe('Thank you!');
      await p.api
        .post(`/shop/partner/reviews/${r.id}/reply`, {
          text: 'Thank you so much!',
        })
        .expect(200);
      await sql(
        `UPDATE product_reviews SET replied_at = now() - interval '25 hours' WHERE id = $1`,
        [r.id],
      );
      expect(
        (
          await p.api
            .post(`/shop/partner/reviews/${r.id}/reply`, { text: 'Edit' })
            .expect(409)
        ).body.error.code,
      ).toBe('CONFLICT');
      const after = await p.api
        .get('/shop/partner/reviews?unreplied=true&pageSize=100')
        .expect(200);
      expect(after.body.data.items.map((x: any) => x.id)).not.toContain(r.id);
    });
  });

  it('customers report a product once while the report is open', async () => {
    const odd = await simpleProduct(t, p, 'Suspicious watch', 9000, 2);
    const c = await customer(t);
    const made = await c.api
      .post(`/shop/products/${odd.id}/report`, {
        reason: 'counterfeit',
        details: 'Fake logo',
      })
      .expect(201);
    expect(made.body.data).toMatchObject({
      status: 'open',
      reason: 'counterfeit',
    });
    expect(
      (
        await c.api
          .post(`/shop/products/${odd.id}/report`, { reason: 'other' })
          .expect(409)
      ).body.error.code,
    ).toBe('CONFLICT');
    await c.api
      .post(`/shop/products/00000000-0000-4000-8000-00000000000a/report`, {
        reason: 'other',
      })
      .expect(404);
    await c.api
      .post(`/shop/products/${odd.id}/report`, { reason: 'because' })
      .expect(400);
  });

  it('dashboard and insights match a hand-computed day', async () => {
    const s = await approvedPartner(t, admin, 'store', 'Insight Ink');
    const store = await storeOf(s);
    await s.api
      .patch('/shop/partner/store/settings', { shippingFlatFee: 0 })
      .expect(200);
    const x = await simpleProduct(t, s, 'Ink pot', 1000, 20);
    const y = await simpleProduct(t, s, 'Reed pen', 500, 20);
    const [c1, c2, c3] = [
      await customer(t),
      await customer(t),
      await customer(t),
    ];

    const o1 = await orderFrom(c1, store.id, [[x.variantId, 2]]); // 2000, delivered
    const o2 = await orderFrom(c1, store.id, [[y.variantId, 1]]); // 500, delivered (c1 repeats)
    await orderFrom(c2, store.id, [
      [x.variantId, 1],
      [y.variantId, 2],
    ]); // 2000, left placed
    const o4 = await orderFrom(c3, store.id, [[y.variantId, 1]]); // 500, cancelled
    await deliverOrder(s, o1.id);
    await deliverOrder(s, o2.id);
    await c3.api
      .post(`/shop/store-orders/${o4.id}/cancel`, { reason: 'Changed my mind' })
      .expect(200);

    const dash = (await s.api.get('/shop/partner/dashboard').expect(200)).body
      .data;
    expect(dash).toMatchObject({
      todayNewOrders: 4,
      newOrders: 1,
      toShip: 0,
      awaitingPaymentConfirmation: 0,
      openReturns: 0,
      recordedSales: { last7Days: 2500, last30Days: 2500 },
    });

    const ins = (await s.api.get('/shop/partner/insights?range=7d').expect(200))
      .body.data;
    expect(ins.ordersPerDay).toHaveLength(7);
    expect(ins.ordersPerDay.at(-1).orders).toBe(4);
    expect(ins.ordersPerDay.slice(0, 6).every((d: any) => d.orders === 0)).toBe(
      true,
    );
    expect(ins.recordedSalesPerDay.at(-1).amount).toBe(2500);
    expect(ins.totals).toEqual({ orders: 4, recordedSales: 2500 });
    // Not cancelled: X 2 + 1 = 3 units (Rs 3000); Y 1 + 2 = 3 units (Rs 1500).
    expect(ins.topProducts).toEqual([
      { productId: x.id, name: 'Ink pot', units: 3, value: 3000 },
      { productId: y.id, name: 'Reed pen', units: 3, value: 1500 },
    ]);
    // c1 (2 orders) and c2 (1); c3's only order was cancelled.
    expect(ins.repeatCustomers).toEqual({
      customers: 2,
      repeat: 1,
      share: 0.5,
    });
    expect(ins.conversion).toEqual({
      placed: 4,
      delivered: 2,
      cancelled: 1,
      rate: 0.5,
    });

    await s.api.get('/shop/partner/insights?range=1y').expect(400);
    const doctor = await approvedPartner(t, admin, 'doctor');
    expect(
      (await doctor.api.get('/shop/partner/dashboard').expect(403)).body.error
        .code,
    ).toBe('WRONG_SERVICE');
  });
});
