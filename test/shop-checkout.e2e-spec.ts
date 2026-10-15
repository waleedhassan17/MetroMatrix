import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
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
import {
  CHECKOUT_FAULT_INJECTOR,
  CheckoutFaultInjector,
} from '../src/modules/shopping/checkout/checkout.service';
import { OrderJobsService } from '../src/modules/shopping/orders/order-jobs.service';

/** Armed by a test to fail checkout right after the stock decrement. */
const fault: CheckoutFaultInjector & { armed: boolean } = {
  armed: false,
  afterStockDecrement(_m: EntityManager) {
    if (fault.armed) throw new Error('injected failure after stock decrement');
  },
};

type Customer = SignedUp & { addressId: string };

describe('Shopping P4: checkout, orders, state machines, jobs (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: OrderJobsService;
  // A: COD + coupon SAVE10. B: transfer (bank account). C: COD, free shipping from 2000.
  let a: Partner, b: Partner, c: Partner;
  let storeA: { id: string }, storeB: { id: string }, storeC: { id: string };
  let iban: string;

  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const stockOf = async (variantId: string) =>
    (
      await sql(`SELECT stock FROM product_variants WHERE id = $1`, [variantId])
    )[0].stock;

  async function customer(): Promise<Customer> {
    const s = await shopper(t);
    return { ...s, addressId: await addAddress(s) };
  }
  async function fill(cust: SignedUp, lines: Array<[string, number]>) {
    for (const [variantId, quantity] of lines) {
      await cust.api
        .post('/shop/cart/items', { variantId, quantity })
        .expect(200);
    }
  }
  const body = (
    cust: Customer,
    ...stores: Array<[string, 'cod' | 'transfer', string?]>
  ) => ({
    addressId: cust.addressId,
    stores: stores.map(([storeId, paymentMethod, couponCode]) => ({
      storeId,
      paymentMethod,
      couponCode,
    })),
  });
  const checkout = (
    cust: SignedUp,
    payload: object,
    key: string = randomUUID(),
  ) => cust.api.post('/shop/checkout', payload).set('Idempotency-Key', key);

  /** A one-store order, returned as its store order (customer view). */
  async function placeOne(
    cust: Customer,
    variantId: string,
    storeId: string,
    method: 'cod' | 'transfer' = 'cod',
    qty = 1,
  ) {
    await fill(cust, [[variantId, qty]]);
    const res = await checkout(cust, body(cust, [storeId, method])).expect(201);
    return res.body.data.storeOrders[0];
  }

  async function product(
    p: Partner,
    name: string,
    price: number,
    stock: number,
  ) {
    const made = await listProduct(t, p, {
      name,
      basePrice: price,
      variants: [{ option1: 'One', stock }],
    });
    return { id: made.id as string, variantId: made.variants[0].id as string };
  }

  beforeAll(async () => {
    t = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(CHECKOUT_FAULT_INJECTOR).useValue(fault),
    });
    jobs = t.app.get(OrderJobsService);
    admin = await enrolledAdmin(t);
    a = await approvedPartner(t, admin, 'store', 'Order Atelier');
    b = await approvedPartner(t, admin, 'store', 'Transfer Traders');
    c = await approvedPartner(t, admin, 'store', 'Cash Corner');
    [storeA, storeB, storeC] = await Promise.all([
      storeOf(a),
      storeOf(b),
      storeOf(c),
    ]);
    await a.api
      .patch('/shop/partner/store/settings', {
        shippingFlatFee: 200,
        freeShippingOver: 10000,
      })
      .expect(200);
    await b.api
      .patch('/shop/partner/store/settings', { shippingFlatFee: 150 })
      .expect(200);
    await c.api
      .patch('/shop/partner/store/settings', {
        shippingFlatFee: 100,
        freeShippingOver: 2000,
      })
      .expect(200);
    iban = testIban();
    await b.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Transfer Traders',
        accountNumber: iban,
        bankName: 'Meezan Bank',
      })
      .expect(201);
    await a.api
      .post('/shop/partner/coupons', {
        code: 'SAVE10',
        type: 'percent',
        value: 10,
        endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        perUserLimit: 5,
      })
      .expect(201);
  });
  afterAll(() => t.close());

  it('3-store checkout: group = Σ store orders to the rupee; preview = checkout; snapshots stick', async () => {
    const suit = await product(a, 'Lawn suit', 4500, 10);
    const shawl = await product(b, 'Wool shawl', 2500, 10);
    const mug = await product(c, 'Blue pottery mug', 800, 10);
    const cust = await customer();
    await fill(cust, [
      [suit.variantId, 2],
      [shawl.variantId, 1],
      [mug.variantId, 3],
    ]);
    const payload = body(
      cust,
      [storeA.id, 'cod', 'SAVE10'],
      [storeB.id, 'transfer'],
      [storeC.id, 'cod'],
    );

    const preview = (
      await cust.api.post('/shop/cart/preview', payload).expect(200)
    ).body.data;
    expect(preview.ok).toBe(true);
    const res = await checkout(cust, payload).expect(201);
    const g = res.body.data;

    // A: 9000 − 900 (10%) + 200 = 8300 · B: 2500 + 150 = 2650 · C: 2400, free from 2000.
    expect(
      g.storeOrders.map((o: any) => [
        o.subtotal,
        o.discount,
        o.shippingFee,
        o.total,
      ]),
    ).toEqual([
      [9000, 900, 200, 8300],
      [2500, 0, 150, 2650],
      [2400, 0, 0, 2400],
    ]);
    expect(g).toMatchObject({
      itemsTotal: 13900,
      discountTotal: 900,
      shippingTotal: 350,
      grandTotal: 13350,
    });
    expect(g.code).toMatch(/^MM-[A-HJKMNP-Z2-9]{6}$/);
    expect(g.storeOrders.map((o: any) => o.code)).toEqual(
      [1, 2, 3].map((n) => `${g.code}-${n}`),
    );
    // Preview and checkout ran the same code: identical numbers.
    expect(preview.totals).toEqual({
      itemsTotal: g.itemsTotal,
      discountTotal: g.discountTotal,
      shippingTotal: g.shippingTotal,
      grandTotal: g.grandTotal,
    });
    expect(preview.stores.map((s: any) => s.total)).toEqual(
      g.storeOrders.map((o: any) => o.total),
    );

    // The integrity gate, in SQL: difference 0 at both levels.
    const [gate] = await sql(
      `SELECT (g.grand_total - sum(so.total))::int AS group_diff,
              sum(abs(so.total - (so.subtotal - so.discount + so.shipping_fee)))::int AS store_diff,
              (sum(so.subtotal) - (SELECT sum(i.line_total) FROM store_order_items i
                                     JOIN store_orders x ON x.id = i.store_order_id WHERE x.group_id = g.id))::int AS line_diff
         FROM order_groups g JOIN store_orders so ON so.group_id = g.id
        WHERE g.code = $1 GROUP BY g.id`,
      [g.code],
    );
    expect(gate).toEqual({ group_diff: 0, store_diff: 0, line_diff: 0 });

    expect([
      await stockOf(suit.variantId),
      await stockOf(shawl.variantId),
      await stockOf(mug.variantId),
    ]).toEqual([8, 9, 7]);
    const movements = await sql(
      `SELECT delta, reason, balance_after FROM inventory_movements WHERE variant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [suit.variantId],
    );
    expect(movements).toEqual([
      { delta: -2, reason: 'order', balance_after: 8 },
    ]);
    expect(
      (await cust.api.get('/shop/cart').expect(200)).body.data.lineCount,
    ).toBe(0);
    const [coupon] = await sql(
      `SELECT used_count FROM coupons WHERE store_id = $1 AND code = 'SAVE10'`,
      [storeA.id],
    );
    expect(coupon.used_count).toBe(1);
    const [{ sold }] = await sql(
      `SELECT sold_count AS sold FROM products WHERE id = $1`,
      [suit.id],
    );
    expect(sold).toBe(2);

    // Three store notifications, one customer notification.
    const owners = new Map([
      [storeA.id, a],
      [storeB.id, b],
      [storeC.id, c],
    ]);
    for (const o of g.storeOrders) {
      const n = await sql(
        `SELECT title FROM notifications WHERE user_id = $1 AND type = 'shop.order.new' AND data->>'code' = $2`,
        [owners.get(o.store.id)!.userId, o.code],
      );
      expect(n).toEqual([{ title: `New order ${o.code}` }]);
    }
    expect(
      await sql(`SELECT type FROM notifications WHERE user_id = $1`, [
        cust.userId,
      ]),
    ).toEqual([{ type: 'shop.order.placed' }]);

    // The transfer order carries the payment instructions.
    const transfer = g.storeOrders[1];
    expect(transfer.payment).toMatchObject({
      method: 'transfer',
      status: 'awaiting_transfer',
      accounts: [
        {
          kind: 'bank',
          accountNumber: iban,
          accountTitle: 'Transfer Traders',
          bankName: 'Meezan Bank',
        },
      ],
    });
    const payBy = new Date(transfer.payment.payBy).getTime();
    expect(Math.abs(payBy - (Date.now() + 24 * 3_600_000))).toBeLessThan(
      60_000,
    );

    // Editing the product and the account later changes nothing on the order.
    await b.api
      .patch(`/shop/partner/products/${shawl.id}`, {
        name: 'Renamed shawl',
        basePrice: 9999,
      })
      .expect(200);
    const accounts = await b.api
      .get('/shop/partner/store/payment-accounts')
      .expect(200);
    await b.api
      .delete(
        `/shop/partner/store/payment-accounts/${accounts.body.data[0].id}`,
      )
      .expect(200);
    const again = (
      await cust.api.get(`/shop/orders/${g.code.toLowerCase()}`).expect(200)
    ).body.data;
    expect(again.storeOrders[1].items[0]).toMatchObject({
      productName: 'Wool shawl',
      unitPrice: 2500,
    });
    expect(again.storeOrders[1].payment.accounts[0].accountNumber).toBe(iban);
    await b.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Transfer Traders',
        accountNumber: testIban(),
        bankName: 'Meezan Bank',
      })
      .expect(201);

    const list = await cust.api.get('/shop/orders?status=active').expect(200);
    expect(list.body.data.items.map((x: any) => x.code)).toEqual([g.code]);
    expect(
      (await cust.api.get('/shop/orders?status=cancelled').expect(200)).body
        .data.total,
    ).toBe(0);
  });

  it('two buyers, last unit, at the same instant: exactly one wins; stock ends at 0', async () => {
    const last = await product(c, 'Last kurta', 1500, 1);
    const [x, y] = await Promise.all([customer(), customer()]);
    await fill(x, [[last.variantId, 1]]);
    await fill(y, [[last.variantId, 1]]);

    const results = await Promise.all([
      checkout(x, body(x, [storeC.id, 'cod'])),
      checkout(y, body(y, [storeC.id, 'cod'])),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error).toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(loser.body.error.details.lines[0]).toMatchObject({
      variantId: last.variantId,
      requested: 1,
      available: 0,
    });

    expect(await stockOf(last.variantId)).toBe(0);
    const [{ lines }] = await sql(
      `SELECT count(*)::int AS lines FROM store_order_items WHERE variant_id = $1`,
      [last.variantId],
    );
    expect(lines).toBe(1);
    const [{ orphans }] = await sql(
      `SELECT count(*)::int AS orphans FROM order_groups g
        WHERE NOT EXISTS (SELECT 1 FROM store_orders so WHERE so.group_id = g.id)`,
    );
    expect(orphans).toBe(0);
    const [{ moves }] = await sql(
      `SELECT count(*)::int AS moves FROM inventory_movements WHERE variant_id = $1 AND reason = 'order'`,
      [last.variantId],
    );
    expect(moves).toBe(1);
  });

  it('a failure after the stock decrement leaves stock, coupon and cart untouched', async () => {
    const dress = await product(a, 'Silk dress', 6000, 5);
    const cust = await customer();
    await fill(cust, [[dress.variantId, 1]]);
    const payload = body(cust, [storeA.id, 'cod', 'SAVE10']);
    const snapshot = async () => ({
      stock: await stockOf(dress.variantId),
      used: (
        await sql(
          `SELECT used_count FROM coupons WHERE store_id = $1 AND code = 'SAVE10'`,
          [storeA.id],
        )
      )[0].used_count,
      cart: (await cust.api.get('/shop/cart').expect(200)).body.data.itemCount,
      groups: (
        await sql(
          `SELECT count(*)::int AS n FROM order_groups WHERE user_id = $1`,
          [cust.userId],
        )
      )[0].n,
      redemptions: (
        await sql(
          `SELECT count(*)::int AS n FROM coupon_redemptions WHERE user_id = $1`,
          [cust.userId],
        )
      )[0].n,
      movements: (
        await sql(
          `SELECT count(*)::int AS n FROM inventory_movements WHERE variant_id = $1`,
          [dress.variantId],
        )
      )[0].n,
    });
    const before = await snapshot();

    const key = randomUUID();
    fault.armed = true;
    try {
      const res = await checkout(cust, payload, key).expect(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      fault.armed = false;
    }
    expect(await snapshot()).toEqual(before);

    // The failed attempt released its key: the same retry now goes through.
    await checkout(cust, payload, key).expect(201);
    expect((await snapshot()).stock).toBe(before.stock - 1);
  });

  it('the same Idempotency-Key twice places one order and returns the same body', async () => {
    const tee = await product(c, 'Block print tee', 1200, 10);
    const cust = await customer();
    await fill(cust, [[tee.variantId, 1]]);
    const payload = body(cust, [storeC.id, 'cod']);

    const missing = await cust.api.post('/shop/checkout', payload).expect(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = randomUUID();
    const first = await checkout(cust, payload, key).expect(201);
    const second = await checkout(cust, payload, key).expect(201);
    expect(second.body).toEqual(first.body);
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM order_groups WHERE user_id = $1`,
      [cust.userId],
    );
    expect(n).toBe(1);
    expect(await stockOf(tee.variantId)).toBe(9);
  });

  it('checkout refuses an empty cart, a store mismatch and a COD total over the limit', async () => {
    const cust = await customer();
    const empty = await checkout(cust, body(cust, [storeC.id, 'cod'])).expect(
      400,
    );
    expect(empty.body.error.code).toBe('CART_EMPTY');

    const rug = await product(a, 'Hand-knotted rug', 12000, 3);
    const cap = await product(c, 'Truck art cap', 900, 3);
    await fill(cust, [
      [rug.variantId, 1],
      [cap.variantId, 1],
    ]);
    const mismatch = await checkout(
      cust,
      body(cust, [storeA.id, 'cod']),
    ).expect(400);
    expect(mismatch.body.error).toMatchObject({
      code: 'CHECKOUT_MISMATCH',
      details: { missing: [storeC.id] },
    });

    const overLimit = await checkout(
      cust,
      body(cust, [storeA.id, 'cod'], [storeC.id, 'cod']),
    ).expect(400);
    expect(overLimit.body.error).toMatchObject({
      code: 'COD_LIMIT_EXCEEDED',
      details: { storeId: storeA.id, codLimit: 10000, total: 12000 },
    });
    expect(
      overLimit.body.error.details.stores.map((s: any) => s.storeId),
    ).toEqual([storeA.id]);
    await expect(stockOf(rug.variantId)).resolves.toBe(3);
  });

  it('COD lifecycle with every illegal move refused as INVALID_TRANSITION', async () => {
    const vase = await product(a, 'Onyx vase', 3000, 5);
    const cust = await customer();
    const order = await placeOne(cust, vase.variantId, storeA.id);
    const p = (action: string, payload?: object) =>
      a.api.post(`/shop/partner/orders/${order.id}/${action}`, payload);
    const mine = (action: string, payload?: object) =>
      cust.api.post(`/shop/store-orders/${order.id}/${action}`, payload);
    const illegal = async (res: Promise<any>, from: string) => {
      const r = await res;
      expect({
        status: r.status,
        code: r.body.error?.code,
        from: r.body.error?.details?.from,
      }).toEqual({
        status: 409,
        code: 'INVALID_TRANSITION',
        from,
      });
    };

    await illegal(p('pack'), 'placed');
    await illegal(
      p('ship', { courierName: 'TCS', trackingRef: 'TCS-1' }),
      'placed',
    );
    await illegal(p('deliver'), 'placed');
    await illegal(p('cash-collected'), 'cod_pending');
    await illegal(p('payment/confirm'), 'cod_pending');
    await illegal(
      p('refund', { amount: 100, refundRef: 'X-1' }),
      'cod_pending',
    );
    await illegal(mine('received'), 'placed');

    const confirmed = await p('confirm').expect(200);
    expect(confirmed.body.data.can.moveTo).toEqual(['packed', 'cancelled']);
    await illegal(p('confirm'), 'confirmed');
    await illegal(mine('cancel', { reason: 'Changed my mind' }), 'confirmed');
    await mine('request-cancel', { reason: 'Changed my mind' }).expect(200);
    expect(
      (await mine('request-cancel', { reason: 'Again please' }).expect(409))
        .body.error.code,
    ).toBe('CONFLICT');

    await p('pack').expect(200);
    const noTracking = await p('ship', { courierName: 'TCS' }).expect(400);
    expect(noTracking.body.error.details.fields.trackingRef).toBeDefined();
    await p('ship', { courierName: 'self', riderName: 'Bilal' }).expect(400);
    await p('ship', { courierName: 'TCS', trackingRef: 'TCS-77120934' }).expect(
      200,
    );
    await illegal(p('cancel', { reason: 'Too late now' }), 'shipped');
    await illegal(mine('cancel', { reason: 'Too late now' }), 'shipped');

    await mine('received').expect(200);
    await illegal(p('deliver'), 'delivered');
    const paid = await p('cash-collected').expect(200);
    expect(paid.body.data).toMatchObject({
      status: 'delivered',
      paymentStatus: 'paid',
    });
    await illegal(p('cash-collected'), 'paid');

    const view = (
      await cust.api.get(`/shop/store-orders/${order.id}`).expect(200)
    ).body.data;
    expect(
      view.events.map((e: any) => [e.kind, e.to ?? e.note, e.actorRole]),
    ).toEqual([
      ['status', 'placed', 'customer'],
      ['status', 'confirmed', 'store'],
      ['note', 'Cancellation requested: Changed my mind', 'customer'],
      ['status', 'packed', 'store'],
      ['status', 'shipped', 'store'],
      ['status', 'delivered', 'customer'],
      ['payment', 'paid', 'store'],
    ]);
    expect(view.shipping).toMatchObject({
      courierName: 'TCS',
      trackingRef: 'TCS-77120934',
    });
    expect(view.returnDeadline).toBeTruthy();

    const storeNotes = await sql(
      `SELECT type FROM notifications WHERE user_id = $1 AND type = 'shop.order.cancel_requested'`,
      [a.userId],
    );
    expect(storeNotes.length).toBeGreaterThanOrEqual(1);
  });

  it('transfer: proof → rejected → proof again → confirmed; shipping before payment is refused', async () => {
    const lamp = await product(b, 'Camel skin lamp', 4200, 5);
    const cust = await customer();
    const order = await placeOne(cust, lamp.variantId, storeB.id, 'transfer');
    const p = (action: string, payload?: object) =>
      b.api.post(`/shop/partner/orders/${order.id}/${action}`, payload);
    const mine = (action: string, payload?: object) =>
      cust.api.post(`/shop/store-orders/${order.id}/${action}`, payload);

    await p('confirm').expect(200);
    await p('pack').expect(200);
    const early = await p('ship', {
      courierName: 'Leopards',
      trackingRef: 'LP-1',
    }).expect(409);
    expect(early.body.error).toMatchObject({
      code: 'PAYMENT_NOT_CONFIRMED',
      details: { paymentStatus: 'awaiting_transfer' },
    });

    const proof = await mine('payment-proof', {
      paymentRef: 'IBFT 1001',
    }).expect(200);
    expect(proof.body.data.paymentStatus).toBe('proof_submitted');
    const payByBefore = new Date(proof.body.data.payment.payBy).getTime();

    const rejected = await p('payment/reject', {
      reason: 'Nothing arrived yet',
    }).expect(200);
    expect(rejected.body.data.payment).toMatchObject({
      status: 'awaiting_transfer',
      rejectedReason: 'Nothing arrived yet',
    });
    expect(
      new Date(rejected.body.data.payment.payBy).getTime(),
    ).toBeGreaterThanOrEqual(payByBefore);
    expect(
      new Date(rejected.body.data.payment.payBy).getTime(),
    ).toBeGreaterThan(Date.now() + 11.9 * 3_600_000);

    await mine('payment-proof', { paymentRef: 'IBFT 1002' }).expect(200);
    const confirmed = await p('payment/confirm').expect(200);
    expect(confirmed.body.data.payment).toMatchObject({
      status: 'paid',
      paymentRef: 'IBFT 1002',
      rejectedReason: null,
    });
    await p('ship', { courierName: 'Leopards', trackingRef: 'LP-77' }).expect(
      200,
    );

    const payments = confirmed.body.data.events
      .filter((e: any) => e.kind === 'payment')
      .map((e: any) => `${e.from}>${e.to}:${e.actorRole}`);
    expect(payments).toEqual([
      'awaiting_transfer>proof_submitted:customer',
      'proof_submitted>awaiting_transfer:store',
      'awaiting_transfer>proof_submitted:customer',
      'proof_submitted>paid:store',
    ]);

    // Proof on a COD order makes no sense.
    const cod = await placeOne(cust, lamp.variantId, storeB.id, 'cod');
    await cust.api
      .post(`/shop/store-orders/${cod.id}/payment-proof`, {
        paymentRef: 'IBFT 9',
      })
      .expect(400);
  });

  it('cancels restock, release the coupon and settle the payment', async () => {
    const scarf = await product(a, 'Ajrak scarf', 2000, 5);
    const cust = await customer();
    await fill(cust, [[scarf.variantId, 2]]);
    const placed = await checkout(
      cust,
      body(cust, [storeA.id, 'cod', 'SAVE10']),
    ).expect(201);
    const order = placed.body.data.storeOrders[0];
    const used = async () =>
      (
        await sql(
          `SELECT used_count FROM coupons WHERE store_id = $1 AND code = 'SAVE10'`,
          [storeA.id],
        )
      )[0].used_count;
    const usedBefore = await used();
    expect(await stockOf(scarf.variantId)).toBe(3);

    await cust.api
      .post(`/shop/store-orders/${order.id}/cancel`, {})
      .expect(400); // reason required
    const cancelled = await cust.api
      .post(`/shop/store-orders/${order.id}/cancel`, {
        reason: 'Ordered twice by mistake',
      })
      .expect(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'void',
      cancelledBy: 'customer',
      cancelReason: 'Ordered twice by mistake',
    });
    expect(await stockOf(scarf.variantId)).toBe(5);
    expect(await used()).toBe(usedBefore - 1);
    expect(
      await sql(`SELECT 1 FROM coupon_redemptions WHERE store_order_id = $1`, [
        order.id,
      ]),
    ).toEqual([]);
    const [m] = await sql(
      `SELECT delta, reason, balance_after FROM inventory_movements WHERE variant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [scarf.variantId],
    );
    expect(m).toEqual({ delta: 2, reason: 'cancel', balance_after: 5 });
    const [{ sold }] = await sql(
      `SELECT sold_count AS sold FROM products WHERE id = $1`,
      [scarf.id],
    );
    expect(sold).toBe(0);

    // Store cancel: a reason is required (QA #17).
    const second = await placeOne(cust, scarf.variantId, storeA.id);
    await a.api.post(`/shop/partner/orders/${second.id}/confirm`).expect(200);
    const noReason = await a.api
      .post(`/shop/partner/orders/${second.id}/cancel`, {})
      .expect(400);
    expect(noReason.body.error.code).toBe('VALIDATION_FAILED');
    await a.api
      .post(`/shop/partner/orders/${second.id}/cancel`, {
        reason: 'Damaged in our store',
      })
      .expect(200);

    // Cancel after payment → refund_due → refunded (recorded, off-platform).
    const lamp = await product(b, 'Brass lamp', 3000, 3);
    const paidOrder = await placeOne(
      cust,
      lamp.variantId,
      storeB.id,
      'transfer',
    );
    await b.api
      .post(`/shop/partner/orders/${paidOrder.id}/payment/confirm`)
      .expect(200);
    const refundDue = await b.api
      .post(`/shop/partner/orders/${paidOrder.id}/cancel`, {
        reason: 'Supplier let us down',
      })
      .expect(200);
    expect(refundDue.body.data).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'refund_due',
    });
    await b.api
      .post(`/shop/partner/orders/${paidOrder.id}/refund`, {
        amount: 999999,
        refundRef: 'IBFT 5',
      })
      .expect(400);
    const refunded = await b.api
      .post(`/shop/partner/orders/${paidOrder.id}/refund`, {
        amount: 3150,
        refundRef: 'IBFT 77',
      })
      .expect(200);
    expect(refunded.body.data.payment).toMatchObject({
      status: 'refunded',
      refundAmount: 3150,
      refundRef: 'IBFT 77',
    });

    // A store rejects a new order.
    const third = await placeOne(cust, scarf.variantId, storeA.id);
    const rej = await a.api
      .post(`/shop/partner/orders/${third.id}/reject`, {
        reason: 'Out of this colour',
      })
      .expect(200);
    expect(rej.body.data).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'store',
    });
  });

  describe('jobs', () => {
    it('an unpaid transfer past pay_by is cancelled by the system, restocked, both told; a rerun does nothing', async () => {
      const pot = await product(b, 'Copper pot', 2200, 4);
      const cust = await customer();
      const order = await placeOne(
        cust,
        pot.variantId,
        storeB.id,
        'transfer',
        2,
      );
      expect(await stockOf(pot.variantId)).toBe(2);
      await sql(
        `UPDATE store_orders SET pay_by = now() - interval '1 minute' WHERE id = $1`,
        [order.id],
      );

      const first = await jobs.cancelUnpaidTransfers();
      expect(first.cancelled).toBeGreaterThanOrEqual(1);
      const [row] = await sql(
        `SELECT status, payment_status, cancelled_by FROM store_orders WHERE id = $1`,
        [order.id],
      );
      expect(row).toEqual({
        status: 'cancelled',
        payment_status: 'void',
        cancelled_by: 'system',
      });
      expect(await stockOf(pot.variantId)).toBe(4);
      for (const userId of [cust.userId, b.userId]) {
        const n = await sql(
          `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'shop.order.cancelled' AND data->>'storeOrderId' = $2`,
          [userId, order.id],
        );
        expect(n).toHaveLength(1);
      }
      expect(await jobs.cancelUnpaidTransfers()).toEqual({ cancelled: 0 });
    });

    it('the completion job completes delivered orders past the window — twice changes nothing more', async () => {
      const bowl = await product(c, 'Wooden bowl', 1100, 5);
      const cust = await customer();
      const order = await placeOne(cust, bowl.variantId, storeC.id);
      for (const step of ['confirm', 'pack'])
        await c.api
          .post(`/shop/partner/orders/${order.id}/${step}`)
          .expect(200);
      await c.api
        .post(`/shop/partner/orders/${order.id}/ship`, {
          courierName: 'TCS',
          trackingRef: 'TCS-9',
        })
        .expect(200);
      await c.api.post(`/shop/partner/orders/${order.id}/deliver`).expect(200);

      const events = async () =>
        (
          await sql(
            `SELECT count(*)::int AS n FROM store_order_events WHERE store_order_id = $1`,
            [order.id],
          )
        )[0].n;
      expect((await jobs.completeDelivered()).completed).toBe(0); // still inside its 7 days
      await sql(
        `UPDATE store_orders SET delivered_at = now() - interval '8 days' WHERE id = $1`,
        [order.id],
      );

      expect((await jobs.completeDelivered()).completed).toBeGreaterThanOrEqual(
        1,
      );
      const after = await events();
      expect(
        (
          await sql(`SELECT status FROM store_orders WHERE id = $1`, [order.id])
        )[0].status,
      ).toBe('completed');
      expect(await jobs.completeDelivered()).toEqual({ completed: 0 });
      expect(await events()).toBe(after);
    });

    it('reminders go out once; the low-stock digest once a day', async () => {
      const jar = await product(c, 'Pickle jar', 700, 2); // already low
      const cust = await customer();
      const order = await placeOne(cust, jar.variantId, storeC.id);
      await sql(
        `UPDATE store_orders SET created_at = now() - interval '49 hours' WHERE id = $1`,
        [order.id],
      );

      const first = await jobs.remindStalePlaced();
      expect(first.storeReminders).toBeGreaterThanOrEqual(1);
      expect(first.customerHints).toBeGreaterThanOrEqual(1);
      expect(await jobs.remindStalePlaced()).toEqual({
        storeReminders: 0,
        customerHints: 0,
      });
      expect(
        await sql(
          `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'shop.order.stale'`,
          [cust.userId],
        ),
      ).toHaveLength(1);

      const digest = await jobs.lowStockDigest();
      expect(digest.stores).toBeGreaterThanOrEqual(1);
      expect(await jobs.lowStockDigest()).toEqual({ stores: 0 });
      expect(
        await sql(
          `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'shop.inventory.low_stock'`,
          [c.userId],
        ),
      ).toHaveLength(1);
    });
  });

  it('isolation: another store and another customer get 404 on every order route', async () => {
    const bag = await product(a, 'Leather bag', 5000, 3);
    const cust = await customer();
    await fill(cust, [[bag.variantId, 1]]);
    const g = (await checkout(cust, body(cust, [storeA.id, 'cod'])).expect(201))
      .body.data;
    const id = g.storeOrders[0].id;

    for (const action of [
      'confirm',
      'reject',
      'pack',
      'ship',
      'deliver',
      'cancel',
      'payment/confirm',
      'payment/reject',
      'cash-collected',
      'refund',
    ]) {
      const res = await c.api.post(`/shop/partner/orders/${id}/${action}`, {
        reason: 'Not mine at all',
        courierName: 'TCS',
        trackingRef: 'TCS-1',
        amount: 1,
        refundRef: 'X-12',
      });
      expect({
        action,
        status: res.status,
        code: res.body.error?.code,
      }).toEqual({ action, status: 404, code: 'NOT_FOUND' });
    }
    await c.api.get(`/shop/partner/orders/${id}`).expect(404);
    const cList = await c.api
      .get('/shop/partner/orders?pageSize=100')
      .expect(200);
    expect(cList.body.data.items.map((o: any) => o.id)).not.toContain(id);
    const aList = await a.api
      .get(`/shop/partner/orders?q=${g.code}`)
      .expect(200);
    expect(aList.body.data.items.map((o: any) => o.id)).toEqual([id]);

    const other = await customer();
    await other.api.get(`/shop/orders/${g.code}`).expect(404);
    await other.api.get(`/shop/store-orders/${id}`).expect(404);
    for (const action of [
      'cancel',
      'request-cancel',
      'payment-proof',
      'received',
    ]) {
      const res = await other.api.post(`/shop/store-orders/${id}/${action}`, {
        reason: 'Not mine',
        paymentRef: 'IBFT 1',
      });
      expect({ action, status: res.status }).toEqual({ action, status: 404 });
    }

    // The store's view shows only what delivery needs.
    const view = (await a.api.get(`/shop/partner/orders/${id}`).expect(200))
      .body.data;
    expect(view.customer).toMatchObject({
      name: 'Ayesha Khan',
      phone: '+923124890176',
      address: { city: 'Lahore' },
    });
    expect(JSON.stringify(view)).not.toContain(cust.email);

    // A product with orders is archived, never deleted.
    const del = await a.api
      .delete(`/shop/partner/products/${bag.id}`)
      .expect(200);
    expect(del.body.data).toEqual({ archived: true, deleted: false });
  });
});
