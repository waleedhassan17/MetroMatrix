import { DateTime } from 'luxon';
import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import {
  Vendor,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
} from './utils/food';
import { dish } from './utils/kitchen';
import { GrowthJobsService } from '../src/modules/food-growth/jobs/growth-jobs.service';

/** Islamabad: only this suite puts vendors here. */
const ISB = { lat: 33.6844, lng: 73.0479 };
const TZ = 'Asia/Karachi';
const day = (n: number) =>
  DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;

describe('Catering: requests, versioned quotes, advance, the event-day order (Chunk 5 P6)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: GrowthJobsService;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    jobs = t.app.get(GrowthJobsService);
  });
  afterAll(() => t.close());

  async function kitchen(name: string) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, { at: ISB }))!.status).toBe(200);
    return v;
  }

  async function booked(v: Vendor, extra: Record<string, unknown> = {}) {
    const c = await foodCustomer(t, ISB);
    const karahi = await itemId(t, v);
    const r = await expectStatus(
      await c.api.post('/food/catering', {
        vendorId: v.brandId,
        eventDate: day(5),
        eventTime: '19:30',
        guests: 60,
        eventType: 'dawat',
        requestedItems: [
          { menuItemId: karahi, name: 'Chicken Karahi', qty: 15 },
          { name: 'Kheer for dessert' },
        ],
        budget: 60000,
        fulfilment: 'delivery',
        addressId: c.addressId,
        notes: 'Engagement dinner',
        ...extra,
      }),
      201,
    );
    return { c, r, karahi };
  }

  const quote = (
    v: Vendor,
    id: string,
    lines: object[],
    extra: Record<string, unknown> = {},
  ) =>
    v.api.post(`/food/vendor/catering/${id}/quote`, {
      lines,
      deliveryFee: 500,
      advancePct: 30,
      ...extra,
    });

  it('only the newest quote can be accepted; then advance proof → confirmed', async () => {
    const v = await kitchen('Catering Quote Kitchen');
    const { c, r, karahi } = await booked(v);
    expect(r).toMatchObject({ status: 'requested', guests: 60, quote: null });
    expect(r.code).toMatch(/^CT-[A-Z2-9]{6}$/);
    const lines = [
      {
        menuItemId: karahi,
        name: 'Chicken Karahi (full)',
        qty: 15,
        unitPrice: 2600,
      },
      { name: 'Kheer (bowl)', qty: 60, unitPrice: 150 },
    ];
    const v1 = await expectStatus(await quote(v, r.id, lines), 200);
    expect(v1.quote).toMatchObject({
      version: 1,
      total: 15 * 2600 + 60 * 150 + 500,
      advancePct: 30,
    });
    const v2 = await expectStatus(
      await quote(v, r.id, lines, {
        deliveryFee: 0,
        notes: 'Free delivery for you',
      }),
      200,
    );
    expect(v2.quote).toMatchObject({
      version: 2,
      total: 48000,
      advance: 14400,
    });
    expect(v2.versions.map((x: any) => x.version)).toEqual([2, 1]);

    const old = await c.api.post(`/food/catering/${r.id}/accept`, {
      version: 1,
    });
    expect(old.status).toBe(409);
    expect(old.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { version: 1, latestVersion: 2 },
    });
    const accepted = await expectStatus(
      await c.api.post(`/food/catering/${r.id}/accept`, { version: 2 }),
      200,
    );
    expect(accepted).toMatchObject({
      status: 'accepted',
      acceptedVersion: 2,
      advance: 14400,
    });
    // No more quotes once accepted.
    expect((await quote(v, r.id, lines)).status).toBe(409);

    const proof = asset(c.userId, 'payment_proof');
    expect(
      (
        await expectStatus(
          await c.api.post(`/food/catering/${r.id}/advance-proof`, {
            proofUrl: proof.url,
            ref: 'IBFT 99',
          }),
          200,
        )
      ).status,
    ).toBe('advance_proof');
    const back = await expectStatus(
      await v.api.post(`/food/vendor/catering/${r.id}/advance/reject`, {
        reason: 'Not in my account yet',
      }),
      200,
    );
    expect(back.status).toBe('accepted');
    await expectStatus(
      await c.api.post(`/food/catering/${r.id}/advance-proof`, {
        proofUrl: proof.url,
      }),
      200,
    );
    expect(
      (
        await expectStatus(
          await v.api.post(`/food/vendor/catering/${r.id}/advance/confirm`),
          200,
        )
      ).status,
    ).toBe('confirmed');

    const other = await kitchen('Catering Quote Other');
    expect((await other.api.get(`/food/vendor/catering/${r.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await other.api.post(`/food/vendor/catering/${r.id}/decline`, {
          reason: 'Not mine',
        })
      ).status,
    ).toBe(404);
  });

  it('an expired quote → CATERING_QUOTE_EXPIRED; the expiry job closes unanswered quotes (twice: once)', async () => {
    const v = await kitchen('Catering Expiry Kitchen');
    const { c, r } = await booked(v);
    await expectStatus(
      await quote(v, r.id, [{ name: 'Biryani deg', qty: 2, unitPrice: 18000 }]),
      200,
    );
    await sql(
      `UPDATE catering_quotes SET valid_until = now() - interval '1 minute' WHERE request_id = $1`,
      [r.id],
    );
    const res = await c.api.post(`/food/catering/${r.id}/accept`, {
      version: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATERING_QUOTE_EXPIRED');
    const first = await jobs.catering();
    const second = await jobs.catering();
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(second.expired).toBe(0);
    expect(
      (await expectStatus(await c.api.get(`/food/catering/${r.id}`), 200))
        .status,
    ).toBe('expired');
    const [n] = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'food.catering.expired'`,
      [c.userId],
    );
    expect(n.title).toContain(r.code);
  });

  it('the event day: one scheduled order from the quote, with the advance prepaid; the quote feeds the prep sheet; delivered completes it', async () => {
    const v = await kitchen('Catering Event Kitchen');
    const { c, r, karahi } = await booked(v, { advancePct: undefined });
    const extraDish = await dish(v, 'Mutton Pulao Deg', 9000);
    await expectStatus(
      await quote(
        v,
        r.id,
        [
          {
            menuItemId: karahi,
            name: 'Chicken Karahi (full)',
            qty: 10,
            unitPrice: 2500,
          },
          {
            menuItemId: extraDish.id,
            name: 'Mutton Pulao Deg',
            qty: 2,
            unitPrice: 9000,
          },
          { name: 'Kheer (bowl)', qty: 40, unitPrice: 150 },
        ],
        { advancePct: 0 },
      ),
      200,
    );
    // No advance asked: accepting books it.
    expect(
      (
        await expectStatus(
          await c.api.post(`/food/catering/${r.id}/accept`, { version: 1 }),
          200,
        )
      ).status,
    ).toBe('confirmed');

    await sql(`UPDATE catering_requests SET event_date = $2 WHERE id = $1`, [
      r.id,
      day(1),
    ]);
    const prep = await expectStatus(
      await v.api.get(`/food/vendor/kitchen/prep-sheet?date=${day(1)}`),
      200,
    );
    expect(
      prep.dishes.find((d: any) => d.itemId === extraDish.id),
    ).toMatchObject({ extra: 2 });

    await sql(`UPDATE catering_requests SET event_date = $2 WHERE id = $1`, [
      r.id,
      day(0),
    ]);
    const a = await jobs.catering();
    const b = await jobs.catering();
    expect(a.orders).toBeGreaterThanOrEqual(1);
    expect(b.orders).toBe(0);
    const [cr] = await sql(
      `SELECT food_order_id FROM catering_requests WHERE id = $1`,
      [r.id],
    );
    const [o] = await sql(
      `SELECT status, source, payment_method, payment_status, total, prepaid_amount, delivery_fee, scheduled_for, customer_note FROM food_orders WHERE id = $1`,
      [cr.food_order_id],
    );
    expect(o).toMatchObject({
      status: 'accepted',
      source: 'catering',
      payment_method: 'catering',
      payment_status: 'cod_pending',
      total: 25000 + 18000 + 6000 + 500,
      prepaid_amount: 0,
      delivery_fee: 500,
    });
    expect(
      DateTime.fromJSDate(o.scheduled_for).setZone(TZ).toFormat('HH:mm'),
    ).toBe('19:30');
    expect(o.customer_note).toContain(r.code);
    const items = await sql(
      `SELECT item_name, quantity, item_id FROM food_order_items WHERE order_id = $1 ORDER BY line_no`,
      [cr.food_order_id],
    );
    expect(
      items.map((i: any) => [i.item_name, i.quantity, !!i.item_id]),
    ).toEqual([
      ['Chicken Karahi (full)', 10, true],
      ['Mutton Pulao Deg', 2, true],
      ['Kheer (bowl)', 40, false],
    ]);
    const detail = await expectStatus(
      await c.api.get(
        `/food/orders/${(await sql(`SELECT code FROM food_orders WHERE id = $1`, [cr.food_order_id]))[0].code}`,
      ),
      200,
    );
    expect(JSON.stringify(detail)).toContain('in cash on the day');
    for (const step of ['preparing', 'ready', 'handed-external'])
      await expectStatus(
        await v.api.post(`/food/vendor/orders/${cr.food_order_id}/${step}`),
        200,
      );
    await expectStatus(
      await v.api.post(`/food/vendor/orders/${cr.food_order_id}/delivered`, {
        codCollected: 49500,
      }),
      200,
    );
    expect(
      (await expectStatus(await c.api.get(`/food/catering/${r.id}`), 200))
        .status,
    ).toBe('completed');
  });

  it('requests: at least a day ahead, a pinned venue, the vendor’s own dishes; cancel and decline', async () => {
    const v = await kitchen('Catering Rules Kitchen');
    const c = await foodCustomer(t, ISB);
    const base = {
      vendorId: v.brandId,
      eventTime: '13:00',
      guests: 20,
      eventType: 'office',
      requestedItems: [{ name: 'Lunch boxes', qty: 20 }],
      fulfilment: 'pickup',
    };
    expect(
      (await c.api.post('/food/catering', { ...base, eventDate: day(0) }))
        .status,
    ).toBe(400);
    expect(
      (
        await c.api.post('/food/catering', {
          ...base,
          eventDate: day(3),
          fulfilment: 'on_site',
        })
      ).status,
    ).toBe(400);
    const other = await kitchen('Catering Rules Other');
    const theirs = await itemId(t, other);
    expect(
      (
        await c.api.post('/food/catering', {
          ...base,
          eventDate: day(3),
          requestedItems: [{ menuItemId: theirs, name: 'x', qty: 1 }],
        })
      ).status,
    ).toBe(404);
    const r = await expectStatus(
      await c.api.post('/food/catering', { ...base, eventDate: day(3) }),
      201,
    );
    expect(
      (
        await expectStatus(
          await c.api.post(`/food/catering/${r.id}/cancel`, {
            reason: 'Meeting moved',
          }),
          200,
        )
      ).status,
    ).toBe('cancelled');
    const r2 = await expectStatus(
      await c.api.post('/food/catering', { ...base, eventDate: day(4) }),
      201,
    );
    expect(
      (
        await expectStatus(
          await v.api.post(`/food/vendor/catering/${r2.id}/decline`, {
            reason: 'Fully booked that day',
          }),
          200,
        )
      ).status,
    ).toBe('declined');
    const list = await expectStatus(await c.api.get('/food/catering'), 200);
    expect(list.map((x: any) => x.status).sort()).toEqual([
      'cancelled',
      'declined',
    ]);
  });
});
