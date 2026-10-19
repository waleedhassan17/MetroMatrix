import { DateTime } from 'luxon';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import {
  Vendor,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
  vendorRider,
} from './utils/food';
import { dish } from './utils/kitchen';
import { GrowthJobsService } from '../src/modules/food-growth/jobs/growth-jobs.service';

/** Rawalpindi: only this suite puts vendors here. */
const RWP = { lat: 33.5651, lng: 73.0169 };
const TZ = 'Asia/Karachi';
const ALL = [0, 1, 2, 3, 4, 5, 6];

const day = (n: number) =>
  DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;
/** The skip cut-off for a date: 20:00 PKT the day before. */
const cutoff = (date: string) =>
  DateTime.fromISO(date, { zone: TZ })
    .minus({ days: 1 })
    .set({ hour: 20 })
    .toJSDate();

describe('Tiffin: plans, subscriptions, skips, daily orders (Chunk 5 P5)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: GrowthJobsService;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  let seq = 0;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    jobs = t.app.get(GrowthJobsService);
  });
  afterAll(() => t.close());

  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'home_kitchen', name);
    expect((await setUpVendor(t, v, { at: RWP, goLive: false }))!).toBeNull();
    await expectStatus(
      await admin.api.post(
        `/admin/food/branches/${v.branchId}/food-safety-check`,
        { outcome: 'passed', note: 'Tiffin kitchen checked' },
      ),
      200,
    );
    await expectStatus(await v.api.post('/food/vendor/go-live'), 200);
    return v;
  }

  async function plan(v: Vendor, extra: Record<string, unknown> = {}) {
    const daal = await dish(v, `Daal Chawal ${++seq}`, 300);
    const karahi = await itemId(t, v);
    return expectStatus(
      await v.api.post('/food/vendor/tiffin/plans', {
        name: 'Office lunch',
        meal: 'lunch',
        days: ALL,
        period: 'weekly',
        pricePerPeriod: 2100,
        deliveryMode: 'both',
        deliveryWindowFrom: '12:30',
        deliveryWindowTo: '13:30',
        capacity: 5,
        rotation: ALL.map((weekday) => ({
          weekday,
          menuItemIds: weekday % 2 ? [daal.id] : [karahi],
          note: null,
        })),
        ...extra,
      }),
      201,
    );
  }

  const subscribe = (
    c: Awaited<ReturnType<typeof foodCustomer>>,
    planId: string,
    body: Record<string, unknown> = {},
  ) =>
    c.api
      .post('/food/tiffin/subscribe', {
        planId,
        startsOn: day(0),
        paymentMethod: 'cash_weekly',
        fulfilment: 'delivery',
        addressId: c.addressId,
        ...body,
      })
      .set('Idempotency-Key', `tiffin-${Date.now()}-${++seq}`);

  async function active(
    v: Vendor,
    planId: string,
    body: Record<string, unknown> = {},
  ) {
    const c = await foodCustomer(t, RWP);
    const s = await expectStatus(await subscribe(c, planId, body), 201);
    await expectStatus(
      await v.api.post(`/food/vendor/tiffin/subscriptions/${s.id}/approve`),
      200,
    );
    return { c, s };
  }

  it('a plan needs a dish for every day it serves; another kitchen’s dish is 404; the meal value is the period price spread', async () => {
    const v = await kitchen('Tiffin Plan Kitchen');
    const other = await kitchen('Tiffin Plan Other');
    const karahi = await itemId(t, v);
    const base = {
      name: 'Weekday lunch',
      meal: 'lunch',
      days: [1, 2, 3, 4, 5],
      period: 'weekly',
      pricePerPeriod: 1500,
      deliveryMode: 'delivery',
      deliveryWindowFrom: '12:30',
      deliveryWindowTo: '13:30',
      capacity: 10,
    };
    const gap = await v.api.post('/food/vendor/tiffin/plans', {
      ...base,
      rotation: [{ weekday: 1, menuItemIds: [karahi] }],
    });
    expect(gap.status).toBe(400);
    const theirs = await itemId(t, other);
    const foreign = await v.api.post('/food/vendor/tiffin/plans', {
      ...base,
      rotation: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        menuItemIds: [theirs],
      })),
    });
    expect(foreign.status).toBe(404);
    const p = await expectStatus(
      await v.api.post('/food/vendor/tiffin/plans', {
        ...base,
        rotation: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          menuItemIds: [karahi],
        })),
      }),
      201,
    );
    expect(p).toMatchObject({
      days: [1, 2, 3, 4, 5],
      mealValue: 300,
      seatsLeft: 10,
      skipCutoffHour: 20,
    });
    expect(
      (await other.api.get(`/food/vendor/tiffin/plans/${p.id}`)).status,
    ).toBe(404);
    const [{ slug }] = await sql(`SELECT slug FROM food_brands WHERE id = $1`, [
      v.brandId,
    ]);
    const listed = await expectStatus(
      await new ApiClient(t.http).get(`/food/vendors/${slug}/tiffin-plans`),
      200,
    );
    expect(listed.map((x: any) => x.id)).toContain(p.id);
  });

  it('capacity: the vendor can approve only while there is a seat (TIFFIN_FULL)', async () => {
    const v = await kitchen('Tiffin Full Kitchen');
    const p = await plan(v, { capacity: 1 });
    await active(v, p.id);
    const c2 = await foodCustomer(t, RWP);
    const full = await subscribe(c2, p.id);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('TIFFIN_FULL');
    // A request made while a seat was free still can't be approved once it's gone.
    await sql(`UPDATE tiffin_plans SET capacity = 2 WHERE id = $1`, [p.id]);
    const r2 = await expectStatus(await subscribe(c2, p.id), 201);
    const c3 = await foodCustomer(t, RWP);
    const r3 = await expectStatus(await subscribe(c3, p.id), 201);
    await expectStatus(
      await v.api.post(`/food/vendor/tiffin/subscriptions/${r2.id}/approve`),
      200,
    );
    const res = await v.api.post(
      `/food/vendor/tiffin/subscriptions/${r3.id}/approve`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIFFIN_FULL');
    const other = await kitchen('Tiffin Full Other');
    expect(
      (
        await other.api.post(
          `/food/vendor/tiffin/subscriptions/${r3.id}/decline`,
          { reason: 'Not mine at all' },
        )
      ).status,
    ).toBe(404);
  });

  it('a skip before the cut-off means no order; after it → TIFFIN_SKIP_CUTOFF_PASSED; generation twice writes one order per delivery', async () => {
    const v = await kitchen('Tiffin Skip Kitchen');
    const p = await plan(v);
    const { c, s } = await active(v, p.id);
    const d1 = day(1);
    const d2 = day(2);
    // Today's cut-off was yesterday 8 PM.
    const late = await c.api.post(`/food/tiffin/subscriptions/${s.id}/skip`, {
      date: day(0),
    });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({
      code: 'TIFFIN_SKIP_CUTOFF_PASSED',
      details: { date: day(0) },
    });
    const skipped = await expectStatus(
      await c.api.post(`/food/tiffin/subscriptions/${s.id}/skip`, { date: d2 }),
      200,
    );
    expect(skipped.skips).toEqual([d2]);

    // The job, just after d2's cut-off (8:01 PM on d1): today (d1) and tomorrow (d2).
    const at = new Date(cutoff(d2).getTime() + 60_000);
    const first = await jobs.generateTiffin(at);
    const second = await jobs.generateTiffin(at);
    expect(first.orders).toBeGreaterThanOrEqual(1);
    expect(second).toEqual({ orders: 0, skipped: 0 });
    const rows = await sql(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, status, food_order_id FROM tiffin_deliveries WHERE subscription_id = $1 ORDER BY date`,
      [s.id],
    );
    expect(rows.map((r: any) => [r.date, r.status, !!r.food_order_id])).toEqual(
      [
        [d1, 'scheduled', true],
        [d2, 'skipped', false],
      ],
    );
    const [o] = await sql(
      `SELECT status, source, payment_method, payment_status, total, scheduled_for, user_id FROM food_orders WHERE id = $1`,
      [rows[0].food_order_id],
    );
    expect(o).toMatchObject({
      status: 'accepted',
      source: 'tiffin',
      payment_method: 'subscription',
      payment_status: 'paid',
      total: 300,
    });
    expect(
      DateTime.fromJSDate(o.scheduled_for)
        .setZone(TZ)
        .toFormat('yyyy-MM-dd HH:mm'),
    ).toBe(`${d1} 12:30`);
    expect(o.user_id).toBe(c.userId);
    // Unskipping after the cut-off is refused too.
    const undo = await c.api.post(`/food/tiffin/subscriptions/${s.id}/unskip`, {
      date: day(0),
    });
    expect(undo.body.error.code).toBe('TIFFIN_SKIP_CUTOFF_PASSED');
  });

  it('generated orders flow through the board and the rider unchanged; the day follows the order', async () => {
    const v = await kitchen('Tiffin Board Kitchen');
    const p = await plan(v);
    const { c, s } = await active(v, p.id);
    const d1 = day(1);
    await jobs.generateTiffin(new Date(cutoff(d1).getTime() + 60_000));
    const [{ food_order_id: orderId }] = await sql(
      `SELECT food_order_id FROM tiffin_deliveries WHERE subscription_id = $1 AND date = $2`,
      [s.id, d1],
    );
    const board = await expectStatus(
      await v.api.get('/food/vendor/orders?status=active&scheduled=true'),
      200,
    );
    expect(board.items.map((o: any) => o.id)).toContain(orderId);
    const mine = await expectStatus(await c.api.get('/food/orders'), 200);
    const listed = mine.items.find((o: any) => o.id === orderId);
    expect(listed).toBeDefined();
    const detail = await expectStatus(
      await c.api.get(`/food/orders/${listed.code}`),
      200,
    );
    expect(detail.payment.instructions ?? null).toBeNull();
    const rider = await vendorRider(t, v, 'Tiffin Rider');
    await expectStatus(
      await rider.api.patch('/food/rider/duty', { onDuty: true }),
      200,
    );
    for (const step of ['preparing', 'ready'])
      await expectStatus(
        await v.api.post(`/food/vendor/orders/${orderId}/${step}`),
        200,
      );
    expect(
      (
        await sql(
          `SELECT status FROM tiffin_deliveries WHERE food_order_id = $1`,
          [orderId],
        )
      )[0].status,
    ).toBe('prepared');
    await expectStatus(
      await v.api.post(`/food/vendor/orders/${orderId}/assign`, {
        riderId: rider.rider.id,
      }),
      200,
    );
    const runs = await expectStatus(
      await rider.api.get('/food/rider/orders'),
      200,
    );
    expect(JSON.stringify(runs)).toContain(orderId);
    // Hand-over without a rider account works the same.
    const v2 = await kitchen('Tiffin Board Two');
    const p2 = await plan(v2);
    const s2 = await active(v2, p2.id);
    await jobs.generateTiffin(new Date(cutoff(d1).getTime() + 60_000));
    const [{ food_order_id: o2 }] = await sql(
      `SELECT food_order_id FROM tiffin_deliveries WHERE subscription_id = $1 AND date = $2`,
      [s2.s.id, d1],
    );
    for (const step of ['preparing', 'ready', 'handed-external'])
      await expectStatus(
        await v2.api.post(`/food/vendor/orders/${o2}/${step}`),
        200,
      );
    await expectStatus(
      await v2.api.post(`/food/vendor/orders/${o2}/delivered`, {}),
      200,
    );
    expect(
      (
        await sql(
          `SELECT status FROM tiffin_deliveries WHERE food_order_id = $1`,
          [o2],
        )
      )[0].status,
    ).toBe('delivered');
  });

  it('tomorrow’s count, the prep sheet’s certain demand, pause and resume, payments, period rollover', async () => {
    const v = await kitchen('Tiffin Ops Kitchen');
    const p = await plan(v, { capacity: 10 });
    const a = await active(v, p.id);
    const b = await active(v, p.id, {
      paymentMethod: 'transfer_per_period',
      fulfilment: 'pickup',
      addressId: undefined,
    });
    const d1 = day(1);
    const tm = await expectStatus(
      await v.api.get(`/food/vendor/tiffin/tomorrow?date=${d1}`),
      200,
    );
    expect(tm).toMatchObject({ date: d1, meals: 2 });
    expect(tm.plans[0].dishes[0].quantity).toBe(2);
    const prep = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/prep-sheet?date=${d1}`),
      200,
    );
    const rot = p.rotation.find(
      (r: any) => r.weekday === DateTime.fromISO(d1).weekday % 7,
    );
    expect(
      prep.dishes.find((x: any) => x.itemId === rot.menuItemIds[0]),
    ).toMatchObject({ extra: 2 });

    // Pause the first through d2: skips for every day whose cut-off hasn't passed; it resumes after.
    const paused = await expectStatus(
      await a.c.api.post(`/food/tiffin/subscriptions/${a.s.id}/pause`, {
        until: day(2),
      }),
      200,
    );
    expect(paused.status).toBe('paused');
    expect(paused.skips).not.toContain(day(0));
    const meals = async (date: string) =>
      (
        await expectStatus(
          await v.api.get(`/food/vendor/tiffin/tomorrow?date=${date}`),
          200,
        )
      ).meals;
    expect(await meals(d1)).toBe(new Date() < cutoff(d1) ? 1 : 2);
    expect(await meals(day(2))).toBe(1);
    expect(
      (
        await expectStatus(
          await v.api.get(`/food/vendor/tiffin/tomorrow?date=${day(3)}`),
          200,
        )
      ).meals,
    ).toBe(2);

    // Transfer per period: proof → confirm (paid); a rejected proof goes back to due.
    const proof = asset(b.c.userId, 'payment_proof');
    const sent = await expectStatus(
      await b.c.api.post(`/food/tiffin/subscriptions/${b.s.id}/payment-proof`, {
        proofUrl: proof.url,
        ref: 'IBFT 7781',
      }),
      200,
    );
    expect(sent.period).toMatchObject({ paymentStatus: 'proof_submitted' });
    const rejected = await expectStatus(
      await v.api.post(
        `/food/vendor/tiffin/subscriptions/${b.s.id}/payment/reject`,
        { reason: 'Amount does not match' },
      ),
      200,
    );
    expect(rejected.period.paymentStatus).toBe('due');
    await expectStatus(
      await b.c.api.post(`/food/tiffin/subscriptions/${b.s.id}/payment-proof`, {
        proofUrl: proof.url,
      }),
      200,
    );
    expect(
      (
        await expectStatus(
          await v.api.post(
            `/food/vendor/tiffin/subscriptions/${b.s.id}/payment/confirm`,
          ),
          200,
        )
      ).period.paymentStatus,
    ).toBe('paid');
    const cash = await a.c.api.post(
      `/food/tiffin/subscriptions/${a.s.id}/payment-proof`,
      { proofUrl: asset(a.c.userId, 'payment_proof').url },
    );
    expect(cash.status).toBe(400);

    // The week ends: a new period, due again (twice: no double roll).
    await sql(
      `UPDATE tiffin_subscriptions SET current_period_start = $2::date - 7, current_period_end = $2::date - 1 WHERE id = $1`,
      [b.s.id, day(0)],
    );
    await jobs.daily();
    await jobs.daily();
    const [row] = await sql(
      `SELECT to_char(current_period_start, 'YYYY-MM-DD') AS s, to_char(current_period_end, 'YYYY-MM-DD') AS e, period_payment_status FROM tiffin_subscriptions WHERE id = $1`,
      [b.s.id],
    );
    expect(row).toEqual({ s: day(0), e: day(6), period_payment_status: 'due' });
    // Cancel: nothing more is generated.
    await expectStatus(
      await b.c.api.post(`/food/tiffin/subscriptions/${b.s.id}/cancel`),
      200,
    );
    expect(
      (
        await expectStatus(
          await v.api.get(`/food/vendor/tiffin/tomorrow?date=${day(3)}`),
          200,
        )
      ).meals,
    ).toBe(1);
  });
});
