import { Socket } from 'socket.io-client';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, testIban } from './utils/shopping';
import { approvedDoctor } from './utils/health';
import {
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  liveHomeKitchen,
  setUpVendor,
  vendorRider,
} from './utils/food';
import { foodSocket, record, until, vendorSocket } from './utils/socket';
import { FoodJobsService } from '../src/modules/food/jobs/food-jobs.service';
import { BranchStateService } from '../src/modules/food/availability/branch-state.service';
import { ServiceabilityService } from '../src/modules/food/availability/serviceability.service';

/** Gujranwala: only this suite puts vendors here. */
const GRW = { lat: 32.1877, lng: 74.1945 };
const KM = 0.009;
const near = (km: number) => ({ lat: GRW.lat + km * KM, lng: GRW.lng });

/**
 * Chunk 4's release gate: one test per row of the Food Court QA matrix
 * (spec §11). Add rows; never delete them.
 */
describe('QA matrix — Food Court (Chunk 4)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: FoodJobsService;
  const sockets: Socket[] = [];
  const anon = () => new ApiClient(t.http);
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const act = (v: Vendor, id: string, step: string, body: object = {}) =>
    v.api.post(`/food/vendor/orders/${id}/${step}`, body);
  const add = (
    c: { api: ApiClient },
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
  const remaining = async (v: Vendor, item: string) =>
    (
      await sql(
        `SELECT remaining_today FROM branch_item_overrides WHERE branch_id = $1 AND item_id = $2`,
        [v.branchId, item],
      )
    )[0].remaining_today;

  beforeAll(async () => {
    t = await createTestApp({ listen: true });
    admin = await enrolledAdmin(t);
    jobs = t.app.get(FoodJobsService);
  });
  afterAll(async () => {
    for (const s of sockets) s.close();
    await t.close();
  });

  async function live(
    name: string,
    opts: Parameters<typeof setUpVendor>[2] = {},
  ) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, opts))!.status).toBe(200);
    return { v, karahi: await itemId(t, v) };
  }

  async function order(
    v: Vendor,
    item: string,
    body: Record<string, unknown> = {},
    at?: { lat: number; lng: number },
  ) {
    const c = await foodCustomer(t, at);
    await expectStatus(await add(c, v, item), 201);
    return { c, o: await expectStatus(await checkout(c, body), 201) };
  }

  it('QA #1 customer far from all vendors → "Not delivering here yet"; pickup vendors shown with the pickup filter', async () => {
    const { v } = await live('QA1 Pickup Point', {
      at: GRW,
      settings: { acceptsPickup: true },
    });
    const far = near(15); // beyond the 6 km zone, inside the 25 km pickup reach
    const home = await expectStatus(
      await anon().get(`/food/home?lat=${far.lat}&lng=${far.lng}`),
      200,
    );
    expect(home.coverage).toMatchObject({
      delivering: false,
      message: 'Not delivering here yet',
    });
    expect(home.coverage.pickupNearby).toBeGreaterThanOrEqual(1);
    const delivering = await expectStatus(
      await anon().get(`/food/vendors?lat=${far.lat}&lng=${far.lng}`),
      200,
    );
    expect(delivering.items.map((x: any) => x.id)).not.toContain(v.brandId);
    const pickup = await expectStatus(
      await anon().get(
        `/food/vendors?lat=${far.lat}&lng=${far.lng}&pickup=true`,
      ),
      200,
    );
    expect(pickup.items.map((x: any) => x.id)).toContain(v.brandId);
  });

  it('QA #2 vendor paused → hidden from lists; the direct link shows the paused message', async () => {
    const { v } = await live('QA2 Paused Pulao', { at: near(1) });
    await expectStatus(
      await v.api.post('/food/vendor/pause', { message: 'Back at 7 pm' }),
      200,
    );
    const list = await expectStatus(
      await anon().get(
        `/food/vendors?lat=${GRW.lat}&lng=${GRW.lng}&pageSize=100`,
      ),
      200,
    );
    expect(list.items.map((x: any) => x.id)).not.toContain(v.brandId);
    const page = await expectStatus(
      await anon().get(`/food/vendors/${v.brandId}`),
      200,
    );
    expect(page).toMatchObject({
      paused: true,
      pauseMessage: 'Back at 7 pm',
      openState: { open: false, label: 'Back at 7 pm' },
    });
  });

  it('QA #3 busy +15 → the ETA range moves by 15', async () => {
    const { v } = await live('QA3 Busy Bhuna', { at: near(2) });
    const card = async () =>
      (
        await expectStatus(
          await anon().get(
            `/food/vendors?lat=${GRW.lat}&lng=${GRW.lng}&pageSize=100`,
          ),
          200,
        )
      ).items.find((x: any) => x.id === v.brandId).etaRange;
    const before = await card();
    expect(before.max - before.min).toBe(10);
    await expectStatus(
      await v.api.post('/food/vendor/busy', { extraMinutes: 15 }),
      200,
    );
    const after = await card();
    expect([after.min - before.min, after.max - before.max]).toEqual([15, 15]);
  });

  it('QA #4 overnight hours 18:00–02:00 → open at 01:00, closed at 03:00', async () => {
    const { v } = await live('QA4 Night Owl', {
      at: near(3),
      hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        opensAt: '18:00',
        closesAt: '02:00',
      })),
    });
    const branch = (await t.app
      .get(ServiceabilityService)
      .branch(v.branchId, null))!;
    const state = t.app.get(BranchStateService);
    const at = (iso: string) => new Date(iso);
    const sched = (
      await state.schedules([v.branchId], at('2026-10-14T20:00:00Z'))
    ).get(v.branchId)!;
    const oneAm = state.state(branch, sched, at('2026-10-14T20:00:00Z')); // Thu 01:00 PKT
    expect(oneAm).toMatchObject({ open: true, label: 'Open until 2:00 AM' });
    const threeAm = state.state(branch, sched, at('2026-10-14T22:00:00Z')); // Thu 03:00 PKT
    expect(threeAm).toMatchObject({ open: false, label: 'Opens 6:00 PM' });
  });

  it('QA #5 required option missing → OPTION_REQUIRED naming the group', async () => {
    const { v } = await live('QA5 Options Grill', { at: near(1) });
    const drink = await expectStatus(
      await v.api.post('/food/vendor/menu/option-groups', {
        name: 'Your drink',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'Cola', priceDelta: 0 },
          { name: 'Lassi', priceDelta: 80 },
        ],
      }),
      201,
    );
    const [cat] = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const meal = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Zinger Meal',
        basePrice: 750,
      }),
      201,
    );
    await expectStatus(
      await v.api.put(`/food/vendor/menu/items/${meal.id}/option-groups`, [
        { groupId: drink.id },
      ]),
      200,
    );
    const c = await foodCustomer(t);
    const res = await add(c, v, meal.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'OPTION_REQUIRED',
      details: { item: 'Zinger Meal', group: 'Your drink' },
    });
  });

  it('QA #6 adding from a second vendor → CART_OTHER_VENDOR; replace works', async () => {
    const a = await live('QA6 First Vendor', { at: near(1) });
    const b = await live('QA6 Second Vendor', { at: near(1) });
    const c = await foodCustomer(t);
    await expectStatus(await add(c, a.v, a.karahi), 201);
    const clash = await add(c, b.v, b.karahi);
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({
      code: 'CART_OTHER_VENDOR',
      details: { currentVendor: { id: a.v.brandId } },
    });
    const cart = await expectStatus(
      await add(c, b.v, b.karahi, {}, '?replace=true'),
      201,
    );
    expect(cart).toMatchObject({ vendor: { id: b.v.brandId }, itemCount: 1 });
  });

  it('QA #7 below the minimum order → BELOW_MIN_ORDER with the shortfall', async () => {
    const { v, karahi } = await live('QA7 Minimum Mandi', {
      bands: [{ fromKm: 0, toKm: 6, fee: 150, minOrder: 2500 }],
    });
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const res = await checkout(c);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'BELOW_MIN_ORDER',
      details: { minOrder: 2500, subtotal: 1600, shortfall: 900 },
    });
  });

  it('QA #8 a happy-hour deal outside its window → not applied', async () => {
    const { v, karahi } = await live('QA8 Happy Hour Haleem');
    const h = (new Date().getUTCHours() + 5) % 24;
    const hh = (x: number) => `${String((x + 24) % 24).padStart(2, '0')}:00`;
    await expectStatus(
      await v.api.post('/food/vendor/promotions', {
        title: 'Happy hour',
        kind: 'percent_off_order',
        value: 30,
        timeFrom: hh(h + 3),
        timeTo: hh(h + 5),
      }),
      201,
    );
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const p = await expectStatus(
      await c.api.post('/food/cart/preview', { addressId: c.addressId }),
      200,
    );
    expect(p.deal).toBeNull();
    expect(p.totals.discount).toBe(0);
  });

  it('QA #9 the last portion race → exactly one success', async () => {
    const v = await liveHomeKitchen(t, admin, 'QA9 Last Plate');
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
    const res = await Promise.all([checkout(a), checkout(b)]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.error.code).toBe(
      'PORTIONS_SOLD_OUT',
    );
    expect(await remaining(v, karahi)).toBe(0);
  });

  it('QA #10 a full pre-order slot → SLOT_FULL', async () => {
    const v = await liveHomeKitchen(t, admin, 'QA10 Sunday Biryani');
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
    const [slot] = (
      await expectStatus(
        await anon().get(`/food/vendors/${v.brandId}/slots`),
        200,
      )
    ).slots;
    const a = await foodCustomer(t);
    await expectStatus(await add(a, v, karahi), 201);
    await expectStatus(
      await a.api.patch('/food/cart', { scheduledFor: slot.startsAt }),
      200,
    );
    await expectStatus(await checkout(a), 201);
    const b = await foodCustomer(t);
    await expectStatus(await add(b, v, karahi), 201);
    const full = await b.api.patch('/food/cart', {
      scheduledFor: slot.startsAt,
    });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SLOT_FULL');
  });

  it('QA #11 vendor silent 5 minutes → auto-rejected; the customer told; portions restored', async () => {
    const v = await liveHomeKitchen(t, admin, 'QA11 Silent Kitchen');
    const karahi = await itemId(t, v);
    const { c, o } = await order(v, karahi);
    expect(await remaining(v, karahi)).toBe(19);
    expect(
      new Date(o.acceptBy).getTime() - new Date(o.placedAt).getTime(),
    ).toBeCloseTo(5 * 60_000, -3);
    await sql(
      `UPDATE food_orders SET accept_by = now() - interval '1 second' WHERE id = $1`,
      [o.id],
    );
    await jobs.autoReject();
    expect(
      (await expectStatus(await c.api.get(`/food/orders/${o.code}`), 200))
        .status,
    ).toBe('auto_rejected');
    expect(
      (
        await sql(
          `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'food.order.auto_rejected'`,
          [c.userId],
        )
      ).length,
    ).toBe(1);
    expect(await remaining(v, karahi)).toBe(20);
  });

  it('QA #12 transfer: preparing before payment → PAYMENT_NOT_CONFIRMED', async () => {
    const { v, karahi } = await live('QA12 Transfer Tikka');
    await expectStatus(
      await v.api.post('/food/vendor/payment-accounts', {
        kind: 'bank',
        accountTitle: 'QA12',
        accountNumber: testIban(),
        bankName: 'HBL',
      }),
      201,
    );
    const { o } = await order(v, karahi, { paymentMethod: 'transfer' });
    await expectStatus(await act(v, o.id, 'accept'), 200);
    const res = await act(v, o.id, 'preparing');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_CONFIRMED');
  });

  it('QA #13 unpaid transfer for 10 minutes → cancelled by the system', async () => {
    const { v, karahi } = await live('QA13 Unpaid Nihari');
    await expectStatus(
      await v.api.post('/food/vendor/payment-accounts', {
        kind: 'bank',
        accountTitle: 'QA13',
        accountNumber: testIban(),
        bankName: 'UBL',
      }),
      201,
    );
    const { c, o } = await order(v, karahi, { paymentMethod: 'transfer' });
    expect(
      new Date(o.payment.payBy).getTime() - new Date(o.placedAt).getTime(),
    ).toBeCloseTo(10 * 60_000, -3);
    await sql(
      `UPDATE food_orders SET pay_by = now() - interval '1 second' WHERE id = $1`,
      [o.id],
    );
    await jobs.cancelUnpaidTransfers();
    expect(
      await expectStatus(await c.api.get(`/food/orders/${o.code}`), 200),
    ).toMatchObject({ status: 'cancelled', cancelledBy: 'system' });
  });

  it('QA #14 assigning an off-duty rider → RIDER_NOT_AVAILABLE', async () => {
    const { v, karahi } = await live('QA14 Off Duty Diner');
    const rider = await vendorRider(t, v, 'Off Duty Omar');
    const { o } = await order(v, karahi);
    await expectStatus(await act(v, o.id, 'accept'), 200);
    const res = await act(v, o.id, 'assign', { riderId: rider.rider.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'RIDER_NOT_AVAILABLE',
      details: { reason: 'off_duty' },
    });
  });

  it('QA #15 a rider sending location for an order not theirs → rejected', async () => {
    const { v, karahi } = await live('QA15 Wrong Order Wok');
    const rider = await vendorRider(t, v, 'Lost Luqman');
    await expectStatus(
      await rider.api.patch('/food/rider/duty', { onDuty: true }),
      200,
    );
    const { o } = await order(v, karahi);
    const s = await foodSocket(t.url!, rider.api.token!);
    sockets.push(s);
    expect(
      await s.emitWithAck('rider.location', {
        orderId: o.id,
        lat: GRW.lat,
        lng: GRW.lng,
      }),
    ).toEqual({
      ok: false,
      code: 'RIDER_NOT_ASSIGNED',
    });
    const rest = await rider.api.post('/food/rider/location', {
      points: [{ orderId: o.id, lat: GRW.lat, lng: GRW.lng }],
    });
    expect(rest.status).toBe(409);
    expect(rest.body.error.code).toBe('RIDER_NOT_ASSIGNED');
  });

  it('QA #16 a customer joining another order’s room → refused', async () => {
    const { v, karahi } = await live('QA16 Private Rooms');
    const { o } = await order(v, karahi);
    const stranger = await foodCustomer(t);
    const s = await foodSocket(t.url!, stranger.api.token!);
    sockets.push(s);
    expect(await s.emitWithAck('subscribe', { orderId: o.id })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    const got = record(s, 'order.updated');
    await expectStatus(await act(v, o.id, 'accept'), 200);
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([]);
  });

  it('QA #17 COD delivered Rs 1,450 → ledger +1,450; handover → 0', async () => {
    const { v } = await live('QA17 Cash Counter');
    const [cat] = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const deal = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Deal 1450',
        basePrice: 1351,
      }),
      201,
    );
    const rider = await vendorRider(t, v, 'Cash Kashif');
    await expectStatus(
      await rider.api.patch('/food/rider/duty', { onDuty: true }),
      200,
    );
    const { o } = await order(v, deal.id);
    expect(o.totals.total).toBe(1450);
    for (const s of ['accept', 'preparing', 'ready'])
      await expectStatus(await act(v, o.id, s), 200);
    await expectStatus(
      await act(v, o.id, 'assign', { riderId: rider.rider.id }),
      200,
    );
    await expectStatus(
      await rider.api.post(`/food/rider/orders/${o.id}/picked-up`),
      200,
    );
    await expectStatus(
      await rider.api.post(`/food/rider/orders/${o.id}/delivered`, {
        codCollected: 1450,
      }),
      200,
    );
    expect(
      (
        await expectStatus(
          await v.api.get(`/food/vendor/riders/${rider.rider.id}/cash`),
          200,
        )
      ).balance,
    ).toBe(1450);
    const after = await expectStatus(
      await v.api.post(`/food/vendor/riders/${rider.rider.id}/handover`, {
        amount: 1450,
      }),
      200,
    );
    expect(after.balance).toBe(0);
  });

  it('QA #18 handed to own rider (no account) → on_the_way; the vendor marks it delivered', async () => {
    const { v, karahi } = await live('QA18 Own Rider');
    const { c, o } = await order(v, karahi);
    for (const s of ['accept', 'preparing', 'ready'])
      await expectStatus(await act(v, o.id, s), 200);
    expect(
      await expectStatus(await act(v, o.id, 'handed-external'), 200),
    ).toMatchObject({
      status: 'on_the_way',
      handedToExternal: true,
      rider: null,
    });
    await expectStatus(await act(v, o.id, 'delivered'), 200);
    expect(
      await expectStatus(await c.api.get(`/food/orders/${o.code}`), 200),
    ).toMatchObject({ status: 'delivered', payment: { status: 'paid' } });
  });

  it('QA #19 a second brand or branch → rejected', async () => {
    const { v } = await live('QA19 One Of Each');
    const twoBranches = await admin.api.patch(
      `/admin/food/vendors/${v.brandId}/plan`,
      { overrides: { limits: { branches: 2 } } },
    );
    expect(twoBranches.status).toBe(400);
    const twoBrands = await admin.api.patch(
      `/admin/food/vendors/${v.brandId}/plan`,
      { overrides: { limits: { brands: 2 } } },
    );
    expect(twoBrands.status).toBe(400);
    await expect(
      sql(
        `INSERT INTO branches (business_id, brand_id, address_line, area, city)
         SELECT business_id, brand_id, 'x', 'x', 'x' FROM branches WHERE id = $1`,
        [v.branchId],
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      sql(
        `INSERT INTO food_brands (business_id, name, slug) SELECT business_id, 'Second', 'qa19-second' FROM food_brands WHERE id = $1`,
        [v.brandId],
      ),
    ).rejects.toThrow(/duplicate key/);
    const plan = await expectStatus(await v.api.get('/food/vendor/plan'), 200);
    expect(plan).toMatchObject({
      planKey: 'community',
      limits: { brands: 1, branches: 1 },
      usage: { brands: 1, branches: 1 },
    });
  });

  it('QA #20 a lowered rider limit → extra riders plan_locked; a rider mid-delivery keeps the seat', async () => {
    const { v, karahi } = await live('QA20 Seat Squeeze');
    const carrying = await vendorRider(t, v, 'Carrying Kaleem');
    const idle = await vendorRider(t, v, 'Idle Imtiaz');
    await sql(
      `UPDATE riders SET created_at = now() - interval '1 day' WHERE id = $1`,
      [idle.rider.id],
    );
    await expectStatus(
      await carrying.api.patch('/food/rider/duty', { onDuty: true }),
      200,
    );
    const { o } = await order(v, karahi);
    await expectStatus(await act(v, o.id, 'accept'), 200);
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
      ['Carrying Kaleem', 'active'],
      ['Idle Imtiaz', 'plan_locked'],
    ]);
  });

  it('QA #21 no fee line other than the delivery fee, in any response', async () => {
    const { v, karahi } = await live('QA21 No Fees');
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    const preview = await expectStatus(
      await c.api.post('/food/cart/preview', {
        addressId: c.addressId,
        paymentMethod: 'cod',
      }),
      200,
    );
    expect(Object.keys(preview.totals).sort()).toEqual([
      'deliveryFee',
      'discount',
      'subtotal',
      'total',
    ]);
    expect(preview.totals.total).toBe(
      preview.totals.subtotal -
        preview.totals.discount +
        preview.totals.deliveryFee,
    );
    const o = await expectStatus(await checkout(c), 201);
    expect(Object.keys(o.totals).sort()).toEqual([
      'deliveryFee',
      'discount',
      'subtotal',
      'total',
    ]);
    const text = JSON.stringify([
      preview,
      o,
      await expectStatus(await v.api.get(`/food/vendor/orders/${o.id}`), 200),
    ]);
    expect(text).not.toMatch(
      /serviceFee|platformFee|commission|smallOrderFee|packagingFee/i,
    );
    const [{ bad }] = await sql(
      `SELECT count(*)::int AS bad FROM food_orders WHERE total <> subtotal - discount + delivery_fee`,
    );
    expect(bad).toBe(0);
  });

  it('QA #22 reviewing twice → REVIEW_EXISTS', async () => {
    const { v, karahi } = await live('QA22 Review Once');
    const { c, o } = await order(v, karahi);
    for (const s of [
      'accept',
      'preparing',
      'ready',
      'handed-external',
      'delivered',
    ])
      await expectStatus(await act(v, o.id, s), 200);
    await expectStatus(
      await c.api.post(`/food/orders/${o.code}/review`, { foodRating: 5 }),
      201,
    );
    const again = await c.api.post(`/food/orders/${o.code}/review`, {
      foodRating: 4,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REVIEW_EXISTS');
  });

  it('QA #23 reorder after a menu change → cart rebuilt; dropped lines reported', async () => {
    const { v, karahi } = await live('QA23 Changing Menu');
    const [cat] = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const raita = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Raita',
        basePrice: 100,
      }),
      201,
    );
    const c = await foodCustomer(t);
    await expectStatus(await add(c, v, karahi), 201);
    await expectStatus(await add(c, v, raita.id), 201);
    const o = await expectStatus(await checkout(c), 201);
    for (const s of [
      'accept',
      'preparing',
      'ready',
      'handed-external',
      'delivered',
    ])
      await expectStatus(await act(v, o.id, s), 200);
    await expectStatus(
      await v.api.patch('/food/vendor/availability', {
        items: [{ itemId: raita.id, isAvailable: false }],
      }),
      200,
    );
    const again = await expectStatus(
      await c.api.post(`/food/orders/${o.code}/reorder`),
      200,
    );
    expect(again.cart.lines.map((l: any) => l.itemId)).toEqual([karahi]);
    expect(again.dropped).toMatchObject([
      { name: 'Raita', reason: 'ITEM_UNAVAILABLE' },
    ]);
  });

  it('QA #24 a doctor partner calling food vendor routes → 403 WRONG_SERVICE', async () => {
    const d = await approvedDoctor(t, admin);
    for (const path of [
      '/food/vendor/setup',
      '/food/vendor/orders',
      '/food/vendor/riders',
    ]) {
      const res = await d.api.get(path);
      expect([path, res.status, res.body.error.code]).toEqual([
        path,
        403,
        'WRONG_SERVICE',
      ]);
    }
  });

  it('QA #25 home kitchen go-live without the food-safety check → FOOD_SAFETY_CHECK_REQUIRED', async () => {
    const v = await foodVendor(
      t,
      admin,
      'home_kitchen',
      'QA25 Unchecked Kitchen',
    );
    await setUpVendor(t, v, { goLive: false });
    const res = await v.api.post('/food/vendor/go-live');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FOOD_SAFETY_CHECK_REQUIRED');
  });

  it('QA #26 admin suspends a vendor with active orders → vendor hidden; those customers told', async () => {
    const { v, karahi } = await live('QA26 Suspended Sizzler', { at: near(4) });
    const { c, o } = await order(v, karahi, {}, near(4));
    await expectStatus(await act(v, o.id, 'accept'), 200);
    await expectStatus(
      await admin.api.post(`/admin/food/vendors/${v.brandId}/suspend`, {
        reason: 'Food-safety complaint',
      }),
      200,
    );
    const list = await expectStatus(
      await anon().get(
        `/food/vendors?lat=${GRW.lat}&lng=${GRW.lng}&pageSize=100`,
      ),
      200,
    );
    expect(list.items.map((x: any) => x.id)).not.toContain(v.brandId);
    expect((await anon().get(`/food/vendors/${v.brandId}`)).status).toBe(404);
    const [n] = await sql(
      `SELECT body FROM notifications WHERE user_id = $1 AND type = 'food.vendor.suspended'`,
      [c.userId],
    );
    expect(n.body).toContain(o.code);
  });

  it('QA #27 jobs run twice → no double effects', async () => {
    const v = await liveHomeKitchen(t, admin, 'QA27 Twice Kitchen');
    const karahi = await itemId(t, v);
    const { o } = await order(v, karahi);
    await sql(
      `UPDATE food_orders SET accept_by = now() - interval '1 second' WHERE id = $1`,
      [o.id],
    );
    await jobs.autoReject();
    await jobs.autoReject();
    expect(await remaining(v, karahi)).toBe(20); // given back once, not twice
    expect(
      (
        await sql(
          `SELECT count(*)::int AS n FROM food_order_events WHERE order_id = $1 AND to_state = 'auto_rejected'`,
          [o.id],
        )
      )[0].n,
    ).toBe(1);
    await sql(
      `UPDATE branch_item_overrides SET remaining_today = 7 WHERE branch_id = $1`,
      [v.branchId],
    );
    await sql(`UPDATE branches SET portions_reset_on = NULL WHERE id = $1`, [
      v.branchId,
    ]);
    await jobs.dailyReset();
    await sql(
      `UPDATE branch_item_overrides SET remaining_today = 18 WHERE branch_id = $1`,
      [v.branchId],
    );
    await jobs.dailyReset();
    expect(await remaining(v, karahi)).toBe(18);
    await jobs.nightlyWork();
    expect(await jobs.nightlyWork()).toEqual({
      ratings: 0,
      sold: 0,
      purged: 0,
    });
  });

  it('QA #28 socket reconnect after 2 minutes offline → REST resync shows the current state', async () => {
    const { v, karahi } = await live('QA28 Reconnect Rolls');
    const first = await vendorSocket(t.url!, v.api.token!);
    const news = record(first.socket, 'order.new');
    const { o } = await order(v, karahi);
    await until(() => news.length === 1);
    first.socket.close();
    // Two minutes offline: everything that happened meanwhile is in REST.
    await expectStatus(await act(v, o.id, 'accept'), 200);
    await expectStatus(await act(v, o.id, 'preparing'), 200);
    await sql(
      `UPDATE food_order_events SET created_at = created_at - interval '2 minutes' WHERE order_id = $1`,
      [o.id],
    );
    const again = await vendorSocket(t.url!, v.api.token!);
    sockets.push(again.socket);
    expect(again.board.orders).toMatchObject([
      { id: o.id, status: 'preparing' },
    ]);
    expect(
      (await expectStatus(await v.api.get(`/food/vendor/orders/${o.id}`), 200))
        .status,
    ).toBe('preparing');
  });
});
