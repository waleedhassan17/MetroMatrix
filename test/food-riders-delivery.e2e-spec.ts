import { Socket } from 'socket.io-client';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import {
  LAHORE,
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  setUpVendor,
  vendorRider,
} from './utils/food';
import { foodSocket, record, until } from './utils/socket';

const KM = 0.009;

describe('Food P6: riders on orders, live location, cash (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const sockets: Socket[] = [];
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const open = async (token: string) => {
    const s = await foodSocket(t.url!, token);
    sockets.push(s);
    return s;
  };
  const act = (v: Vendor, id: string, step: string, body: object = {}) =>
    v.api.post(`/food/vendor/orders/${id}/${step}`, body);
  const userOf = async (riderId: string) =>
    (await sql(`SELECT user_id FROM riders WHERE id = $1`, [riderId]))[0]
      .user_id as string;
  const ride = (
    r: { api: ApiClient },
    id: string,
    step: string,
    body: object = {},
  ) => r.api.post(`/food/rider/orders/${id}/${step}`, body);

  beforeAll(async () => {
    t = await createTestApp({ listen: true });
    admin = await enrolledAdmin(t);
  });
  afterAll(async () => {
    for (const s of sockets) s.close();
    await t.close();
  });

  /** A live restaurant with a Rs 1,351 dish: with the Rs 99 fee, a Rs 1,450 order. */
  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v))!.status).toBe(200);
    const [cat] = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const deal = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Biryani Deal',
        basePrice: 1351,
      }),
      201,
    );
    return { v, deal: deal.id as string };
  }

  async function placed(v: Vendor, item: string, at = LAHORE) {
    const c = await foodCustomer(t, at);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: item,
        quantity: 1,
      }),
      201,
    );
    const o = await expectStatus(await checkout(c), 201);
    await expectStatus(await act(v, o.id, 'accept'), 200);
    return { c, o };
  }

  async function onDuty(v: Vendor, name: string) {
    const r = await vendorRider(t, v, name);
    await expectStatus(
      await r.api.patch('/food/rider/duty', { onDuty: true }),
      200,
    );
    return r;
  }

  it('a full delivery: assign, steps, live location (throttled), COD Rs 1,450 → ledger, handover → 0 (QA #17)', async () => {
    const { v, deal } = await kitchen('Rider Biryani');
    const rider = await onDuty(v, 'Imran Ali');
    const { c, o } = await placed(v, deal);
    expect(o.totals.total).toBe(1450);

    const riderSocket = await open(rider.api.token!);
    const riderUpdates = record(riderSocket, 'order.updated');
    const assigned = await expectStatus(
      await act(v, o.id, 'assign', { riderId: rider.rider.id }),
      200,
    );
    expect(assigned.rider).toMatchObject({
      name: 'Imran Ali',
      vehicle: 'bike',
      step: 'assigned',
      locationLive: false,
    });
    await until(() => riderUpdates.length >= 1);
    expect(riderUpdates[0]).toMatchObject({ code: o.code, status: 'accepted' });
    const [push] = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'food.rider.assigned'`,
      [await userOf(rider.rider.id)],
    );
    expect(push.title).toBe(`New delivery ${o.code}`);
    expect(
      (
        await sql(`SELECT active_order_count FROM riders WHERE id = $1`, [
          rider.rider.id,
        ])
      )[0].active_order_count,
    ).toBe(1);

    const mine = await expectStatus(
      await rider.api.get('/food/rider/orders?scope=active'),
      200,
    );
    expect(mine.items).toMatchObject([
      {
        code: o.code,
        riderStep: 'assigned',
        cashToCollect: 1450,
        pickup: { name: 'Rider Biryani', lat: LAHORE.lat, lng: LAHORE.lng },
        drop: { name: 'Ayesha Khan', lat: LAHORE.lat, lng: LAHORE.lng },
      },
    ]);
    await expectStatus(await ride(rider, o.id, 'accept'), 200);
    await expectStatus(await ride(rider, o.id, 'arrived-branch'), 200);
    const early = await ride(rider, o.id, 'picked-up');
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/hasn’t marked this order ready/);
    await expectStatus(await act(v, o.id, 'preparing'), 200);
    await expectStatus(await act(v, o.id, 'ready'), 200);
    const going = await expectStatus(await ride(rider, o.id, 'picked-up'), 200);
    expect(going).toMatchObject({
      status: 'on_the_way',
      riderStep: 'picked_up',
      nextSteps: ['arrived_at_customer', 'delivered'],
    });

    // The customer watches the rider move — at most one fix per order every 4 s.
    const phone = await open(c.api.token!);
    expect((await phone.emitWithAck('subscribe', { orderId: o.id })).ok).toBe(
      true,
    );
    const fixes = record(phone, 'rider.location');
    for (const [i, lat] of [
      LAHORE.lat + 0.004,
      LAHORE.lat + 0.003,
      LAHORE.lat + 0.002,
    ].entries())
      expect(
        await riderSocket.emitWithAck('rider.location', {
          orderId: o.id,
          lat,
          lng: LAHORE.lng,
          heading: 90 + i,
          speed: 6,
        }),
      ).toEqual({
        ok: true,
      });
    await until(() => fixes.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(fixes).toEqual([
      expect.objectContaining({
        orderId: o.id,
        lat: LAHORE.lat + 0.004,
        lng: LAHORE.lng,
        heading: 90,
        speed: 6,
      }),
    ]);
    expect(
      (
        await sql(
          `SELECT count(*)::int AS n FROM rider_location_logs WHERE order_id = $1`,
          [o.id],
        )
      )[0].n,
    ).toBe(3);
    const tracking = await expectStatus(
      await c.api.get(`/food/orders/${o.code}/tracking`),
      200,
    );
    expect(tracking.rider).toMatchObject({
      name: 'Imran Ali',
      phone: expect.any(String),
      vehicle: 'bike',
      locationLive: true,
      lastGeo: { lat: LAHORE.lat + 0.002, lng: LAHORE.lng },
    });

    await expectStatus(await ride(rider, o.id, 'arrived-customer'), 200);
    const done = await expectStatus(
      await ride(rider, o.id, 'delivered', {}),
      200,
    );
    expect(done).toMatchObject({
      status: 'delivered',
      riderStep: 'delivered',
      codCollected: 1450,
      cashToCollect: 0,
    });
    expect(
      (
        await sql(`SELECT active_order_count FROM riders WHERE id = $1`, [
          rider.rider.id,
        ])
      )[0].active_order_count,
    ).toBe(0);
    const held = await expectStatus(
      await rider.api.get('/food/rider/cash'),
      200,
    );
    expect(held).toMatchObject({
      balance: 1450,
      entries: [{ kind: 'cod_collected', amount: 1450, orderCode: o.code }],
    });
    const customerView = await expectStatus(
      await c.api.get(`/food/orders/${o.code}`),
      200,
    );
    expect(customerView.payment.status).toBe('paid');
    expect(
      customerView.events
        .filter((e: any) => e.kind === 'rider')
        .map((e: any) => e.to),
    ).toEqual([
      'assigned',
      'accepted_by_rider',
      'arrived_at_branch',
      'picked_up',
      'arrived_at_customer',
      'delivered',
    ]);

    const tooMuch = await v.api.post(
      `/food/vendor/riders/${rider.rider.id}/handover`,
      { amount: 2000 },
    );
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.details.balance).toBe(1450);
    const after = await expectStatus(
      await v.api.post(`/food/vendor/riders/${rider.rider.id}/handover`, {
        amount: 1450,
        note: 'End of shift',
      }),
      200,
    );
    expect(after.balance).toBe(0);
    expect(after.entries.map((e: any) => [e.kind, e.amount])).toEqual([
      ['handover', -1450],
      ['cod_collected', 1450],
    ]);
    expect(
      (
        await sql(
          `SELECT 1 FROM operational_audit_events WHERE action = 'food.rider.handover' AND target_id = $1`,
          [rider.rider.id],
        )
      ).length,
    ).toBe(1);
  });

  it('a rider of vendor A gets 404 on vendor B’s orders, and vendors can’t use each other’s riders', async () => {
    const a = await kitchen('Tenant A Grill');
    const b = await kitchen('Tenant B Grill');
    const riderA = await onDuty(a.v, 'Bilal Khan');
    const { o: orderB } = await placed(b.v, b.deal);
    expect(
      (await riderA.api.get(`/food/rider/orders/${orderB.id}`)).status,
    ).toBe(404);
    expect((await ride(riderA, orderB.id, 'picked-up')).status).toBe(404);
    expect((await ride(riderA, orderB.id, 'delivered')).status).toBe(404);
    expect(
      (await act(b.v, orderB.id, 'assign', { riderId: riderA.rider.id }))
        .status,
    ).toBe(404);
    expect(
      (await b.v.api.get(`/food/vendor/riders/${riderA.rider.id}/cash`)).status,
    ).toBe(404);
    expect(
      (
        await b.v.api.post(`/food/vendor/riders/${riderA.rider.id}/handover`, {
          amount: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await b.v.api.get(`/food/vendor/riders/suggest?orderId=${orderB.id}`))
        .body.data.items,
    ).toEqual([]);
  });

  it('an off-duty or inactive rider can’t be assigned (QA #14); location for an order not yours is refused (QA #15)', async () => {
    const { v, deal } = await kitchen('Duty Roster Diner');
    const rider = await vendorRider(t, v, 'Usman Tariq');
    const { o } = await placed(v, deal);
    const off = await act(v, o.id, 'assign', { riderId: rider.rider.id });
    expect(off.status).toBe(409);
    expect(off.body.error).toMatchObject({
      code: 'RIDER_NOT_AVAILABLE',
      details: { reason: 'off_duty' },
    });

    // Off duty: no location either.
    const riderSocket = await open(rider.api.token!);
    expect(
      await riderSocket.emitWithAck('rider.location', {
        lat: LAHORE.lat,
        lng: LAHORE.lng,
      }),
    ).toEqual({
      ok: false,
      code: 'RIDER_NOT_AVAILABLE',
    });
    await expectStatus(
      await rider.api.patch('/food/rider/duty', { onDuty: true }),
      200,
    );
    // An order that isn't theirs — socket and REST.
    expect(
      await riderSocket.emitWithAck('rider.location', {
        orderId: o.id,
        lat: LAHORE.lat,
        lng: LAHORE.lng,
      }),
    ).toEqual({
      ok: false,
      code: 'RIDER_NOT_ASSIGNED',
    });
    const rest = await rider.api.post('/food/rider/location', {
      points: [{ orderId: o.id, lat: LAHORE.lat, lng: LAHORE.lng }],
    });
    expect(rest.status).toBe(409);
    expect(rest.body.error.code).toBe('RIDER_NOT_ASSIGNED');
    expect(
      await riderSocket.emitWithAck('rider.location', {
        lat: 'north',
        lng: LAHORE.lng,
      }),
    ).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    // A batch without an order just updates where the rider is.
    expect(
      await expectStatus(
        await rider.api.post('/food/rider/location', {
          points: [
            {
              lat: LAHORE.lat + 0.001,
              lng: LAHORE.lng,
              at: new Date(Date.now() - 20_000).toISOString(),
            },
            { lat: LAHORE.lat + 0.002, lng: LAHORE.lng },
          ],
        }),
        200,
      ),
    ).toEqual({ accepted: 2 });

    // Another socket user can't send rider.location at all.
    const cust = await foodCustomer(t);
    const custSocket = await open(cust.api.token!);
    expect(
      await custSocket.emitWithAck('rider.location', {
        lat: LAHORE.lat,
        lng: LAHORE.lng,
      }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });

    // Inactive (signed out, socket refused); pickup orders need no rider.
    await expectStatus(
      await v.api.patch(`/food/vendor/riders/${rider.rider.id}/status`, {
        status: 'on_leave',
      }),
      200,
    );
    const leave = await act(v, o.id, 'assign', { riderId: rider.rider.id });
    expect(leave.body.error).toMatchObject({
      code: 'RIDER_NOT_AVAILABLE',
      details: { reason: 'on_leave' },
    });
  });

  it('suggestions: fewest active orders, then nearest live location; live board; decline and reassign', async () => {
    const { v, deal } = await kitchen('Dispatch Desk');
    const near = await onDuty(v, 'Near Nadeem');
    const far = await onDuty(v, 'Far Faisal');
    const busy = await onDuty(v, 'Busy Bashir');
    await vendorRider(t, v, 'Sleepy Saad'); // off duty: never suggested
    await expectStatus(
      await near.api.post('/food/rider/location', {
        points: [{ lat: LAHORE.lat + 0.5 * KM, lng: LAHORE.lng }],
      }),
      200,
    );
    await expectStatus(
      await far.api.post('/food/rider/location', {
        points: [{ lat: LAHORE.lat + 4 * KM, lng: LAHORE.lng }],
      }),
      200,
    );
    const { o: first } = await placed(v, deal);
    await expectStatus(
      await act(v, first.id, 'assign', { riderId: busy.rider.id }),
      200,
    );
    const { o } = await placed(v, deal);
    const s = await expectStatus(
      await v.api.get(`/food/vendor/riders/suggest?orderId=${o.id}`),
      200,
    );
    expect(s.items.map((x: any) => x.fullName)).toEqual([
      'Near Nadeem',
      'Far Faisal',
      'Busy Bashir',
    ]);
    expect(s.items[0]).toMatchObject({ activeOrders: 0, locationLive: true });
    expect(s.items[0].distanceKm).toBeCloseTo(0.5, 0);
    expect(s.items[2]).toMatchObject({
      activeOrders: 1,
      locationLive: false,
      distanceKm: null,
    });
    // A stale location doesn't count as near.
    await sql(
      `UPDATE riders SET location_updated_at = now() - interval '3 minutes' WHERE id = $1`,
      [near.rider.id],
    );
    const stale = await expectStatus(
      await v.api.get(`/food/vendor/riders/suggest?orderId=${o.id}`),
      200,
    );
    expect(stale.items.map((x: any) => x.fullName)).toEqual([
      'Far Faisal',
      'Near Nadeem',
      'Busy Bashir',
    ]);

    const board = await expectStatus(
      await v.api.get('/food/vendor/riders/live'),
      200,
    );
    expect(
      board.items.find((x: any) => x.fullName === 'Busy Bashir').activeOrders,
    ).toMatchObject([{ code: first.code, riderStep: 'assigned' }]);
    expect(
      board.items.find((x: any) => x.fullName === 'Far Faisal'),
    ).toMatchObject({ onDuty: true, locationLive: true });
    expect(
      board.items.find((x: any) => x.fullName === 'Sleepy Saad'),
    ).toMatchObject({ onDuty: false, location: null });

    // Decline → back to the vendor; reassign moves the count.
    await expectStatus(
      await act(v, o.id, 'assign', { riderId: far.rider.id }),
      200,
    );
    expect(
      await expectStatus(
        await ride(far, o.id, 'decline', { reason: 'Puncture' }),
        200,
      ),
    ).toEqual({ declined: true, orderId: o.id });
    const back = await expectStatus(
      await v.api.get(`/food/vendor/orders/${o.id}`),
      200,
    );
    expect(back).toMatchObject({ rider: null });
    expect(
      back.events.filter((e: any) => e.kind === 'rider').map((e: any) => e.to),
    ).toEqual(['assigned', 'declined']);
    expect((await far.api.get(`/food/rider/orders/${o.id}`)).status).toBe(404);
    await expectStatus(
      await act(v, o.id, 'assign', { riderId: far.rider.id }),
      200,
    );
    await expectStatus(
      await act(v, o.id, 'assign', { riderId: near.rider.id }),
      200,
    );
    const counts = await sql(
      `SELECT full_name, active_order_count FROM riders WHERE business_id = $1 ORDER BY full_name`,
      [v.businessId],
    );
    expect(counts.map((r: any) => [r.full_name, r.active_order_count])).toEqual(
      [
        ['Busy Bashir', 1],
        ['Far Faisal', 0],
        ['Near Nadeem', 1],
        ['Sleepy Saad', 0],
      ],
    );
    const [unassigned] = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'food.rider.unassigned'`,
      [await userOf(far.rider.id)],
    );
    expect(unassigned.title).toBe(`${o.code} reassigned`);
    // A cancel frees the rider too.
    await expectStatus(
      await act(v, o.id, 'cancel', { reason: 'Customer unreachable' }),
      200,
    );
    expect(
      (
        await sql(`SELECT active_order_count FROM riders WHERE id = $1`, [
          near.rider.id,
        ])
      )[0].active_order_count,
    ).toBe(0);
  });

  it('a lowered rider limit locks the extra riders; a rider mid-delivery keeps the seat (QA #20)', async () => {
    const { v, deal } = await kitchen('Seat Limits Kitchen');
    const carrying = await onDuty(v, 'Carrying Kamran');
    const idle = await onDuty(v, 'Idle Irfan');
    // The idle rider is the older one, so only the open delivery keeps Kamran's seat.
    await sql(
      `UPDATE riders SET created_at = now() - interval '1 day' WHERE id = $1`,
      [idle.rider.id],
    );
    const { o } = await placed(v, deal);
    await expectStatus(
      await act(v, o.id, 'assign', { riderId: carrying.rider.id }),
      200,
    );
    await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
        overrides: { limits: { riders: 1 } },
      }),
      200,
    );
    const st = await sql(
      `SELECT full_name, status FROM riders WHERE business_id = $1 ORDER BY full_name`,
      [v.businessId],
    );
    expect(st.map((r: any) => [r.full_name, r.status])).toEqual([
      ['Carrying Kamran', 'active'],
      ['Idle Irfan', 'plan_locked'],
    ]);
    expect((await idle.api.get('/food/rider/me')).status).toBe(401); // signed out by the lock
    // Kamran finishes the delivery.
    for (const step of ['preparing', 'ready'])
      await expectStatus(await act(v, o.id, step), 200);
    await expectStatus(await ride(carrying, o.id, 'picked-up'), 200);
    await expectStatus(
      await ride(carrying, o.id, 'delivered', { codCollected: 1450 }),
      200,
    );
  });
});
