import { Socket } from 'socket.io-client';
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
import {
  foodSocket,
  nextEvent,
  record,
  until,
  vendorSocket,
} from './utils/socket';

describe('Food P5: order lifecycle, realtime, tracking, reorder (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const sockets: Socket[] = [];
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const add = (
    c: { api: ApiClient },
    v: Vendor,
    item: string,
    extra: Record<string, unknown> = {},
  ) =>
    c.api.post('/food/cart/items', {
      vendorId: v.brandId,
      itemId: item,
      quantity: 1,
      ...extra,
    });
  const open = async (token: string) => {
    const s = await foodSocket(t.url!, token);
    sockets.push(s);
    return s;
  };
  const openVendor = async (v: Vendor) => {
    const r = await vendorSocket(t.url!, v.api.token!);
    sockets.push(r.socket);
    return r;
  };
  const act = (v: Vendor, id: string, step: string, body: object = {}) =>
    v.api.post(`/food/vendor/orders/${id}/${step}`, body);

  beforeAll(async () => {
    t = await createTestApp({ listen: true });
    admin = await enrolledAdmin(t);
  });
  afterAll(async () => {
    for (const s of sockets) s.close();
    await t.close();
  });

  async function liveVendor(
    name: string,
    settings: Record<string, unknown> = {},
  ) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect(
      (await setUpVendor(t, v, {
        settings: { acceptsPickup: true, ...settings },
      }))!.status,
    ).toBe(200);
    return { v, karahi: await itemId(t, v) };
  }

  it('delivery with the vendor’s own rider: the kitchen gets order.new, the customer every order.updated (QA #18)', async () => {
    const { v, karahi } = await liveVendor('Socket Karahi');
    const { socket: kitchen, board } = await openVendor(v);
    expect(board.orders).toEqual([]);
    const news = record(kitchen, 'order.new');

    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const order = await expectStatus(await checkout(c), 201);
    await until(() => news.length === 1);
    expect(news[0].order).toMatchObject({
      id: order.id,
      code: order.code,
      status: 'placed',
      itemsSummary: '1× Chicken Karahi',
      customerName: 'Ayesha Khan',
      total: 1699,
    });

    const phone = await open(c.api.token!);
    expect(await phone.emitWithAck('subscribe', { orderId: order.id })).toEqual(
      { ok: true, orderId: order.id },
    );
    const updates = record(phone, 'order.updated');

    const accepted = await expectStatus(
      await act(v, order.id, 'accept', { etaMinutes: 35 }),
      200,
    );
    expect(accepted).toMatchObject({
      status: 'accepted',
      eta: { minutes: 35 },
      actions: { status: ['preparing', 'cancelled'] },
    });
    await expectStatus(await act(v, order.id, 'preparing'), 200);
    await expectStatus(await act(v, order.id, 'ready'), 200);
    const onTheWay = await expectStatus(
      await act(v, order.id, 'handed-external'),
      200,
    );
    expect(onTheWay).toMatchObject({
      status: 'on_the_way',
      handedToExternal: true,
      rider: null,
    });
    const delivered = await expectStatus(
      await act(v, order.id, 'delivered', {}),
      200,
    );
    expect(delivered).toMatchObject({
      status: 'delivered',
      codCollected: 1699,
      payment: { status: 'paid' },
    });

    await until(() => updates.length === 5);
    expect(updates.map((u) => u.status)).toEqual([
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'delivered',
    ]);
    expect(updates[4].order).toMatchObject({
      code: order.code,
      canReorder: true,
      payment: { status: 'paid' },
    });
    expect(updates[4].order.codCollected).toBeUndefined();

    const mine = await expectStatus(
      await c.api.get(`/food/orders/${order.code}`),
      200,
    );
    expect(
      mine.events.filter((e: any) => e.kind === 'status').map((e: any) => e.to),
    ).toEqual([
      'placed',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'delivered',
    ]);
    expect(mine.events.find((e: any) => e.to === 'on_the_way').note).toBe(
      'Handed to own rider',
    );
    const kinds = (
      await sql(
        `SELECT type FROM notifications WHERE user_id = $1 ORDER BY created_at`,
        [c.userId],
      )
    ).map((r: any) => r.type);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'food.order.accepted',
        'food.order.preparing',
        'food.order.on_the_way',
        'food.order.delivered',
      ]),
    );
  });

  it('nobody joins another order’s or vendor’s room; bad and signed-out tokens are refused (QA #16)', async () => {
    const a = await liveVendor('Room Vendor A');
    const b = await liveVendor('Room Vendor B');
    const { socket: kitchenB } = await openVendor(b.v);
    const leakedToB = record(kitchenB, 'order.new');
    const owner = await foodCustomer(t);
    await expectStatus(await add(owner, a.v, a.karahi), 201);
    const order = await expectStatus(await checkout(owner), 201);

    const stranger = await foodCustomer(t);
    const snoop = await open(stranger.api.token!);
    expect(await snoop.emitWithAck('subscribe', { orderId: order.id })).toEqual(
      { ok: false, code: 'NOT_FOUND' },
    );
    expect(
      await kitchenB.emitWithAck('subscribe', { orderId: order.id }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(
      await snoop.emitWithAck('subscribe', { orderId: 'not-a-uuid' }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    const snooped = record(snoop, 'order.updated');
    const bSaw = record(kitchenB, 'order.updated');
    await expectStatus(await act(a.v, order.id, 'accept'), 200);
    await new Promise((r) => setTimeout(r, 200));
    expect(snooped).toEqual([]);
    expect(bSaw).toEqual([]);
    expect(leakedToB).toEqual([]);
    // REST agrees: another vendor's order is 404.
    expect((await b.v.api.get(`/food/vendor/orders/${order.id}`)).status).toBe(
      404,
    );
    expect((await act(b.v, order.id, 'ready')).status).toBe(404);

    await expect(foodSocket(t.url!)).rejects.toMatchObject({
      message: 'UNAUTHORIZED',
    });
    await expect(foodSocket(t.url!, 'nonsense')).rejects.toMatchObject({
      message: 'UNAUTHORIZED',
    });
    const leaving = await foodCustomer(t);
    const token = leaving.api.token!;
    await expectStatus(await leaving.api.post('/auth/signout'), 200);
    await expect(foodSocket(t.url!, token)).rejects.toMatchObject({
      message: 'TOKEN_REVOKED',
    });
  });

  it('a transfer blocks preparing until the vendor confirms it (QA #12); proof, reject, confirm on the socket', async () => {
    const { v, karahi } = await liveVendor('Transfer Tandoor');
    await expectStatus(
      await v.api.post('/food/vendor/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Tandoor',
        accountNumber: testIban(),
        bankName: 'MCB',
      }),
      201,
    );
    const { socket: kitchen } = await openVendor(v);
    const payments = record(kitchen, 'order.payment');
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const order = await expectStatus(
      await checkout(c, { paymentMethod: 'transfer' }),
      201,
    );
    await expectStatus(await act(v, order.id, 'accept'), 200);
    const early = await act(v, order.id, 'preparing');
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({
      code: 'PAYMENT_NOT_CONFIRMED',
      details: { paymentStatus: 'awaiting_transfer' },
    });

    const sent = await expectStatus(
      await c.api.post(`/food/orders/${order.code}/payment-proof`, {
        paymentRef: 'IBFT 556677',
      }),
      200,
    );
    expect(sent.payment).toMatchObject({
      status: 'proof_submitted',
      reference: 'IBFT 556677',
    });
    await until(() => payments.length === 1);
    expect(payments[0]).toMatchObject({
      code: order.code,
      paymentStatus: 'proof_submitted',
    });
    const detail = await expectStatus(
      await v.api.get(`/food/vendor/orders/${order.id}`),
      200,
    );
    expect(detail.actions.payment.sort()).toEqual([
      'awaiting_transfer',
      'paid',
    ]);

    const rejected = await expectStatus(
      await act(v, order.id, 'payment/reject', {
        reason: 'Nothing arrived yet',
      }),
      200,
    );
    expect(rejected.payment).toMatchObject({
      status: 'awaiting_transfer',
      rejectedReason: 'Nothing arrived yet',
    });
    await expectStatus(
      await c.api.post(`/food/orders/${order.code}/payment-proof`, {
        paymentRef: 'IBFT 556678',
      }),
      200,
    );
    const confirmed = await expectStatus(
      await act(v, order.id, 'payment/confirm'),
      200,
    );
    expect(confirmed.payment.status).toBe('paid');
    await expectStatus(await act(v, order.id, 'preparing'), 200);
    await until(() => payments.length === 4);
    expect(payments.map((p) => p.paymentStatus)).toEqual([
      'proof_submitted',
      'awaiting_transfer',
      'proof_submitted',
      'paid',
    ]);
    // Cancelled after paying → the vendor owes a refund.
    const cancelled = await expectStatus(
      await act(v, order.id, 'cancel', { reason: 'Gas ran out' }),
      200,
    );
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'vendor',
      payment: { status: 'refund_due' },
    });
  });

  it('illegal moves are 409 INVALID_TRANSITION; the customer cancels only while placed', async () => {
    const { v, karahi } = await liveVendor('Strict Kitchen');
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const a = await expectStatus(await checkout(c), 201);
    const tooSoon = await act(v, a.id, 'ready');
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: {
        from: 'placed',
        to: 'ready',
        allowed: ['accepted', 'rejected'],
      },
    });
    await expectStatus(await act(v, a.id, 'accept'), 200);
    const late = await c.api.post(`/food/orders/${a.code}/cancel`, {
      reason: 'Changed my mind',
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_TRANSITION');
    expect(late.body.error.message).toMatch(/call them/);
    expect((await act(v, a.id, 'picked-up')).body.error.code).toBe(
      'INVALID_TRANSITION',
    ); // a delivery order
    expect(
      (await act(v, a.id, 'reject', { reason: 'Too late now' })).body.error
        .code,
    ).toBe('INVALID_TRANSITION');
    await expectStatus(await act(v, a.id, 'preparing'), 200);
    await expectStatus(await act(v, a.id, 'ready'), 200);
    await expectStatus(await act(v, a.id, 'handed-external'), 200);
    const over = await act(v, a.id, 'delivered', { codCollected: 99999 });
    expect(over.status).toBe(400);
    await expectStatus(
      await act(v, a.id, 'delivered', { codCollected: 1500 }),
      200,
    );
    expect(
      (await act(v, a.id, 'cancel', { reason: 'Oops' })).body.error.code,
    ).toBe('INVALID_TRANSITION');

    // While placed: the customer cancels and the kitchen hears about it.
    await expectStatus(await add(c, v, karahi), 201);
    const b = await expectStatus(await checkout(c), 201);
    const gone = await expectStatus(
      await c.api.post(`/food/orders/${b.code}/cancel`, {
        reason: 'Ordered twice',
      }),
      200,
    );
    expect(gone).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'customer',
      canCancel: false,
      payment: { status: 'void' },
    });
    const [n] = await sql(
      `SELECT n.title FROM notifications n JOIN businesses b ON b.owner_user_id = n.user_id
        WHERE b.id = $1 AND n.type = 'food.order.cancelled'`,
      [v.businessId],
    );
    expect(n.title).toBe(`${b.code} cancelled by the customer`);
    // Vendor reject with a reason.
    await expectStatus(await add(c, v, karahi), 201);
    const r = await expectStatus(await checkout(c), 201);
    const no = await expectStatus(
      await act(v, r.id, 'reject', { reason: 'Kitchen closing' }),
      200,
    );
    expect(no).toMatchObject({
      status: 'rejected',
      cancelReason: 'Kitchen closing',
      cancelledBy: 'vendor',
    });
  });

  it('pickup: pay at the counter; collected settles it', async () => {
    const v = await liveHomeKitchen(t, admin, 'Pickup Pantry');
    const karahi = await itemId(t, v);
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi, { quantity: 2 }), 201);
    await expectStatus(
      await c.api.patch('/food/cart', { fulfilment: 'pickup' }),
      200,
    );
    const o = await expectStatus(
      await checkout(c, { paymentMethod: 'pay_at_pickup' }),
      201,
    );
    for (const step of ['accept', 'preparing', 'ready'])
      await expectStatus(await act(v, o.id, step), 200);
    expect((await act(v, o.id, 'handed-external')).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
    const done = await expectStatus(await act(v, o.id, 'picked-up'), 200);
    expect(done).toMatchObject({
      status: 'picked_up',
      payment: { status: 'paid' },
    });
    const board = await expectStatus(
      await v.api.get('/food/vendor/orders?status=done'),
      200,
    );
    expect(board.items.map((x: any) => x.code)).toContain(o.code);
    expect(
      (
        await expectStatus(
          await v.api.get('/food/vendor/orders?status=active'),
          200,
        )
      ).total,
    ).toBe(0);
  });

  it('tracking: status, ETA, the two ends', async () => {
    const { v, karahi } = await liveVendor('Track Me Tikka');
    const c = await foodCustomer(t, {
      lat: LAHORE.lat + 0.01,
      lng: LAHORE.lng,
    });
    await expectStatus(await add(c, v, karahi), 201);
    const o = await expectStatus(await checkout(c), 201);
    await expectStatus(await act(v, o.id, 'accept', { etaMinutes: 40 }), 200);
    const tr = await expectStatus(
      await c.api.get(`/food/orders/${o.code}/tracking`),
      200,
    );
    expect(tr).toMatchObject({
      code: o.code,
      status: 'accepted',
      branch: { name: 'Track Me Tikka', lat: LAHORE.lat, lng: LAHORE.lng },
      drop: { lat: LAHORE.lat + 0.01, lng: LAHORE.lng },
      rider: null,
    });
    expect(tr.eta.minutesLeft).toBeGreaterThanOrEqual(39);
    expect(tr.eta.minutesLeft).toBeLessThanOrEqual(40);
    const other = await foodCustomer(t);
    expect(
      (await other.api.get(`/food/orders/${o.code}/tracking`)).status,
    ).toBe(404);
  });

  it('reorder after a menu change: cart rebuilt at today’s prices, dropped lines reported (QA #23)', async () => {
    const { v, karahi } = await liveVendor('Reorder Royal');
    const [cat] = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const naan = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Garlic Naan',
        basePrice: 120,
      }),
      201,
    );
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    await expectStatus(await add(c, v, naan.id, { quantity: 3 }), 201);
    const o = await expectStatus(await checkout(c), 201);
    for (const step of [
      'accept',
      'preparing',
      'ready',
      'handed-external',
      'delivered',
    ])
      await expectStatus(await act(v, o.id, step), 200);

    await expectStatus(
      await v.api.patch(`/food/vendor/menu/items/${karahi}`, {
        basePrice: 1750,
      }),
      200,
    );
    await expectStatus(
      await v.api.delete(`/food/vendor/menu/items/${naan.id}`),
      200,
    );
    const again = await expectStatus(
      await c.api.post(`/food/orders/${o.code}/reorder`),
      200,
    );
    expect(again.dropped).toEqual([
      {
        name: 'Garlic Naan',
        reason: 'not_on_menu',
        message: 'Garlic Naan is no longer on the menu.',
      },
    ]);
    expect(again.priceChanges).toEqual([
      { name: 'Chicken Karahi', was: 1600, now: 1750 },
    ]);
    expect(again.cart.lines).toMatchObject([
      { itemId: karahi, quantity: 1, unitPrice: 1750 },
    ]);
    expect(again.cart.vendor.id).toBe(v.brandId);

    // The home's "order again" row and favourites.
    const home = await expectStatus(
      await c.api.get(`/food/home?lat=${LAHORE.lat}&lng=${LAHORE.lng}`),
      200,
    );
    expect(home.orderAgain.map((x: any) => x.id)).toContain(v.brandId);
    await expectStatus(await c.api.post(`/food/favourites/${v.brandId}`), 201);
    await expectStatus(await c.api.post(`/food/favourites/${v.brandId}`), 201);
    const favs = await expectStatus(await c.api.get('/food/favourites'), 200);
    expect(favs.items).toMatchObject([
      { id: v.brandId, name: 'Reorder Royal', openState: { open: true } },
    ]);
    expect(
      (
        await expectStatus(
          await c.api.delete(`/food/favourites/${v.brandId}`),
          200,
        )
      ).favourite,
    ).toBe(false);
    expect(
      (await expectStatus(await c.api.get('/food/favourites'), 200)).items,
    ).toEqual([]);
  });

  it('after time offline, reconnecting resyncs from board.sync and REST (QA #28)', async () => {
    const { v, karahi } = await liveVendor('Reconnect Rolls');
    const first = await openVendor(v);
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const news = record(first.socket, 'order.new');
    const o = await expectStatus(await checkout(c), 201);
    await until(() => news.some((p: any) => p.order.id === o.id));
    first.socket.close();
    // While the kitchen tablet is offline, the order moves on.
    await expectStatus(await act(v, o.id, 'accept'), 200);
    await expectStatus(await act(v, o.id, 'preparing'), 200);
    const again = await openVendor(v);
    expect(again.board.orders).toMatchObject([
      { id: o.id, status: 'preparing' },
    ]);
    const rest = await expectStatus(
      await v.api.get(`/food/vendor/orders/${o.id}`),
      200,
    );
    expect(rest.status).toBe('preparing');
    const phone = await open(c.api.token!);
    expect((await phone.emitWithAck('subscribe', { orderId: o.id })).ok).toBe(
      true,
    );
    const next = nextEvent(phone, 'order.updated');
    await expectStatus(await act(v, o.id, 'ready'), 200);
    expect((await next).status).toBe('ready');
  });
});
