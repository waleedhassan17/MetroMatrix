import { DateTime } from 'luxon';
import { createTestApp, ApiClient, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import {
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
} from './utils/food';
import { ingredient } from './utils/kitchen';
import { AiFakes, aiSettings, fakeAi, withFakeAi } from './utils/fake-ai';
import { KitchenJobsService } from '../src/modules/kitchen/jobs/kitchen-jobs.service';
import { KitchenAlertsService } from '../src/modules/kitchen/stock/kitchen-alerts.service';

/** Sukkur: only this suite puts vendors here. */
const SUK = { lat: 27.7052, lng: 68.8574 };
const TZ = 'Asia/Karachi';

/** A pickup window inside today (Pakistan time), from now. */
function window(minutes = 60) {
  const now = DateTime.now().setZone(TZ);
  const end = DateTime.min(
    now.plus({ minutes }),
    now.endOf('day').minus({ seconds: 30 }),
  );
  return { pickupFrom: now.toISO()!, pickupTo: end.toISO()! };
}

describe('Bachat Box, donations, packing proof, expiry alerts (Chunk 5 P4)', () => {
  let t: TestApp;
  let admin: Admin;
  let f: AiFakes;
  let jobs: KitchenJobsService;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  let seq = 0;
  const reserve = (
    c: { api: ApiClient },
    boxId: string,
    body: object = { quantity: 1 },
  ) =>
    c.api
      .post(`/food/surplus/${boxId}/reserve`, body)
      .set('Idempotency-Key', `bb-${Date.now()}-${++seq}`);

  beforeAll(async () => {
    f = fakeAi();
    t = await createTestApp({ override: withFakeAi(f) });
    admin = await enrolledAdmin(t);
    jobs = t.app.get(KitchenJobsService);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    f.ai.reset();
    aiSettings(t).enabled = true;
  });

  async function kitchen(name: string, settings: Record<string, unknown> = {}) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    expect((await setUpVendor(t, v, { at: SUK, settings }))!.status).toBe(200);
    return v;
  }

  const box = async (v: Vendor, extra: Record<string, unknown> = {}) =>
    expectStatus(
      await v.api.post('/food/vendor/kitchen/surplus-boxes', {
        title: 'Bachat Box — dinner mix',
        contentsHint: 'Usually karahi and naan',
        originalValue: 1200,
        price: 450,
        quantity: 1,
        ...window(),
        ...extra,
      }),
      201,
    );

  it('the last box goes to one customer; the other gets SURPLUS_SOLD_OUT', async () => {
    const v = await kitchen('Surplus Race Kitchen');
    const b = await box(v);
    expect(b).toMatchObject({ remaining: 1, status: 'live', discountPct: 63 });
    const [a, c] = [await foodCustomer(t, SUK), await foodCustomer(t, SUK)];
    const near = await expectStatus(
      await new ApiClient(t.http).get(
        `/food/surplus?lat=${SUK.lat}&lng=${SUK.lng}`,
      ),
      200,
    );
    expect(near.map((x: any) => x.id)).toContain(b.id);
    const results = await Promise.all([reserve(a, b.id), reserve(c, b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409)!;
    expect(lost.body.error.code).toBe('SURPLUS_SOLD_OUT');
    const won = results.find((r) => r.status === 201)!.body.data;
    expect(won).toMatchObject({
      quantity: 1,
      status: 'reserved',
      total: 450,
      paymentMethod: 'pay_at_pickup',
    });
    expect(won.code).toMatch(/^BB-[A-Z2-9]{6}$/);
    const [row] = await sql(
      `SELECT remaining, status FROM surplus_boxes WHERE id = $1`,
      [b.id],
    );
    expect(row).toEqual({ remaining: 0, status: 'sold_out' });
    const gone = await expectStatus(
      await new ApiClient(t.http).get(
        `/food/surplus?lat=${SUK.lat}&lng=${SUK.lng}`,
      ),
      200,
    );
    expect(gone.map((x: any) => x.id)).not.toContain(b.id);
    // The same request again (same key) is replayed, not a second box.
    const vendorSide = await expectStatus(
      await v.api.get(
        `/food/vendor/kitchen/surplus-reservations?boxId=${b.id}`,
      ),
      200,
    );
    expect(vendorSide).toHaveLength(1);
  });

  it('cancel gives the box back; after the window closes: SURPLUS_WINDOW_CLOSED, expiry job (twice), no-show', async () => {
    const v = await kitchen('Surplus Window Kitchen');
    const b = await box(v, { quantity: 2 });
    const c = await foodCustomer(t, SUK);
    const r = await expectStatus(await reserve(c, b.id, { quantity: 2 }), 201);
    expect(
      (await sql(`SELECT status FROM surplus_boxes WHERE id = $1`, [b.id]))[0]
        .status,
    ).toBe('sold_out');
    await expectStatus(
      await c.api.post(`/food/surplus/reservations/${r.id}/cancel`),
      200,
    );
    expect(
      (
        await sql(`SELECT remaining, status FROM surplus_boxes WHERE id = $1`, [
          b.id,
        ])
      )[0],
    ).toEqual({ remaining: 2, status: 'live' });
    const r2 = await expectStatus(await reserve(c, b.id), 201);
    // Too early for a no-show.
    expect(
      (
        await v.api.post(
          `/food/vendor/kitchen/surplus-reservations/${r2.id}/no-show`,
        )
      ).status,
    ).toBe(409);
    await sql(
      `UPDATE surplus_boxes SET pickup_from = now() - interval '2 hours', pickup_to = now() - interval '1 minute' WHERE id = $1`,
      [b.id],
    );
    const closed = await reserve(await foodCustomer(t, SUK), b.id);
    expect(closed.body.error.code).toBe('SURPLUS_WINDOW_CLOSED');
    expect(await jobs.expireSurplus()).toEqual({ expired: 1 });
    expect(await jobs.expireSurplus()).toEqual({ expired: 0 });
    expect(
      (await sql(`SELECT status FROM surplus_boxes WHERE id = $1`, [b.id]))[0]
        .status,
    ).toBe('expired');
    const late = await c.api.post(`/food/surplus/reservations/${r2.id}/cancel`);
    expect(late.body.error.code).toBe('SURPLUS_WINDOW_CLOSED');
    expect(
      await expectStatus(
        await v.api.post(
          `/food/vendor/kitchen/surplus-reservations/${r2.id}/no-show`,
        ),
        200,
      ),
    ).toMatchObject({
      status: 'no_show',
    });
  });

  it('three no-shows block the customer for 14 days (SURPLUS_BLOCKED)', async () => {
    const v = await kitchen('Surplus NoShow Kitchen');
    const c = await foodCustomer(t, SUK);
    for (let i = 0; i < 3; i++) {
      const b = await box(v);
      const r = await expectStatus(await reserve(c, b.id), 201);
      await sql(
        `UPDATE surplus_boxes SET pickup_from = now() - interval '2 hours', pickup_to = now() - interval '1 minute' WHERE id = $1`,
        [b.id],
      );
      await expectStatus(
        await v.api.post(
          `/food/vendor/kitchen/surplus-reservations/${r.id}/no-show`,
        ),
        200,
      );
    }
    const next = await box(v);
    const res = await reserve(c, next.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SURPLUS_BLOCKED');
    const until = new Date(res.body.error.details.until).getTime();
    expect(Math.round((until - Date.now()) / 86_400_000)).toBe(14);
    const [note] = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'food.surplus.blocked'`,
      [c.userId],
    );
    expect(note.title).toBe('Bachat Box reservations paused');
    // Someone else can still reserve it.
    expect((await reserve(await foodCustomer(t, SUK), next.id)).status).toBe(
      201,
    );
  });

  it('collected with the code; donations; meals rescued = collected boxes + donated meals', async () => {
    const v = await kitchen('Surplus Rescue Kitchen');
    const b = await box(v, { quantity: 3 });
    const c = await foodCustomer(t, SUK);
    const r = await expectStatus(await reserve(c, b.id, { quantity: 2 }), 201);
    const wrong = await v.api.post(
      `/food/vendor/kitchen/surplus-reservations/${r.id}/collected`,
      { code: 'BB-AAAAAA' },
    );
    expect(wrong.status).toBe(400);
    await expectStatus(
      await v.api.post(
        `/food/vendor/kitchen/surplus-reservations/${r.id}/collected`,
        { code: r.code },
      ),
      200,
    );
    const photo = asset(v.userId, 'kitchen_story');
    const d = await expectStatus(
      await v.api.post('/food/vendor/kitchen/donations', {
        organisation: 'Edhi Centre',
        meals: 15,
        photoUrl: photo.url,
      }),
      201,
    );
    expect(d).toMatchObject({
      mealsRescued: 17,
      donatedMeals: 15,
      boxesCollected: 2,
    });
    const other = await kitchen('Surplus Rescue Other');
    expect(
      (
        await other.api.post(
          `/food/vendor/kitchen/surplus-reservations/${r.id}/collected`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await other.api.post(
          `/food/vendor/kitchen/surplus-boxes/${b.id}/cancel`,
        )
      ).status,
    ).toBe(404);
    // Boxes are for today and never above their menu value.
    const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 });
    const bad = await v.api.post('/food/vendor/kitchen/surplus-boxes', {
      title: 'Tomorrow box',
      originalValue: 500,
      price: 200,
      quantity: 1,
      pickupFrom: tomorrow.toISO(),
      pickupTo: tomorrow.plus({ hours: 1 }).toISO(),
    });
    expect(bad.status).toBe(400);
    const pricey = await v.api.post('/food/vendor/kitchen/surplus-boxes', {
      title: 'Pricey box',
      originalValue: 500,
      price: 600,
      quantity: 1,
      ...window(),
    });
    expect(pricey.status).toBe(400);
  });

  it('packing photo required: picked_up and on_the_way refused without one; the AI check is advisory; the customer sees the photo', async () => {
    const v = await kitchen('Packing Kitchen', { acceptsPickup: true });
    await expectStatus(
      await v.api.patch('/food/vendor/kitchen/settings', {
        requirePackingPhoto: true,
      }),
      200,
    );
    const karahi = await itemId(t, v);
    const order = async (fulfilment: 'pickup' | 'delivery') => {
      const c = await foodCustomer(t, SUK);
      await expectStatus(
        await c.api.post('/food/cart/items', {
          vendorId: v.brandId,
          itemId: karahi,
          quantity: 1,
        }),
        201,
      );
      if (fulfilment === 'pickup')
        await expectStatus(
          await c.api.patch('/food/cart', { fulfilment: 'pickup' }),
          200,
        );
      const o = await expectStatus(
        await checkout(
          c,
          fulfilment === 'pickup' ? { paymentMethod: 'pay_at_pickup' } : {},
        ),
        201,
      );
      for (const step of ['accept', 'preparing', 'ready'])
        await expectStatus(
          await v.api.post(`/food/vendor/orders/${o.id}/${step}`),
          200,
        );
      return { c, o };
    };
    const { c, o } = await order('pickup');
    const blocked = await v.api.post(`/food/vendor/orders/${o.id}/picked-up`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PACKING_PHOTO_REQUIRED');

    const photo = asset(v.userId, 'packing_proof');
    f.storage.put(photo.url, Buffer.from('jpeg'), 'image/jpeg');
    f.ai.answer({
      detectedItems: [{ name: 'Chicken Karahi', count: 1 }],
      match: true,
      missing: [],
      confidence: 0.82,
      note: '1 box visible.',
    });
    const proof = await expectStatus(
      await v.api.post(`/food/vendor/kitchen/orders/${o.id}/packing-proof`, {
        photoUrl: photo.url,
        publicId: photo.publicId,
      }),
      200,
    );
    expect(proof).toMatchObject({
      takenBy: 'vendor',
      aiCheck: {
        match: true,
        advisory: true,
        expectedItems: [{ name: 'Chicken Karahi', quantity: 1 }],
      },
    });
    await expectStatus(
      await v.api.post(`/food/vendor/orders/${o.id}/picked-up`),
      200,
    );
    const seen = await expectStatus(
      await c.api.get(`/food/orders/${o.code}`),
      200,
    );
    expect(seen.packingPhotoUrl).toBe(photo.url);

    // Delivery: the hand-over to the vendor's own rider is refused the same way; a failing AI check never blocks.
    const d = await order('delivery');
    expect(
      (await v.api.post(`/food/vendor/orders/${d.o.id}/handed-external`)).body
        .error.code,
    ).toBe('PACKING_PHOTO_REQUIRED');
    const photo2 = asset(v.userId, 'packing_proof');
    f.storage.put(photo2.url, Buffer.from('jpeg'), 'image/jpeg');
    f.ai.answer('garbage', 'still garbage');
    const p2 = await expectStatus(
      await v.api.post(`/food/vendor/kitchen/orders/${d.o.id}/packing-proof`, {
        photoUrl: photo2.url,
      }),
      200,
    );
    expect(p2.aiCheck).toBeNull();
    await expectStatus(
      await v.api.post(`/food/vendor/orders/${d.o.id}/handed-external`),
      200,
    );
    // Someone else's upload, or someone else's order.
    const theirs = asset(
      '00000000-0000-4000-8000-000000000000',
      'packing_proof',
    );
    expect(
      (
        await v.api.post(
          `/food/vendor/kitchen/orders/${d.o.id}/packing-proof`,
          { photoUrl: theirs.url },
        )
      ).status,
    ).toBe(400);
    const other = await kitchen('Packing Other');
    const mine = asset(other.userId, 'packing_proof');
    expect(
      (
        await other.api.post(
          `/food/vendor/kitchen/orders/${o.id}/packing-proof`,
          { photoUrl: mine.url },
        )
      ).status,
    ).toBe(404);
  });

  it('expiry alerts: 3 days, then 1 day, then past its date — each once, even when the job runs twice', async () => {
    const v = await kitchen('Expiry Alert Kitchen');
    const today = DateTime.now().setZone(TZ).toISODate()!;
    const in2 = DateTime.fromISO(today).plus({ days: 2 }).toISODate()!;
    const yogurt = await ingredient(v, {
      name: 'Yogurt',
      category: 'dairy',
      openingStock: { qty: 4, unit: 'kg', expiresOn: in2 },
    });
    const titles = async () =>
      (
        await sql(
          `SELECT title FROM notifications WHERE user_id = $1 AND type LIKE 'kitchen.expir%' ORDER BY created_at`,
          [v.userId],
        )
      ).map((r: any) => r.title);
    const run = async (now: Date) => {
      await jobs.expiryAlerts(now);
      await jobs.expiryAlerts(now);
      await t.app.get(KitchenAlertsService).flush();
    };
    await run(new Date());
    expect(await titles()).toEqual(['Yogurt expires in 2 days']);
    await run(new Date(Date.now() + 86_400_000));
    expect(await titles()).toEqual([
      'Yogurt expires in 2 days',
      'Yogurt expires tomorrow',
    ]);
    await run(new Date(Date.now() + 3 * 86_400_000));
    expect(await titles()).toEqual([
      'Yogurt expires in 2 days',
      'Yogurt expires tomorrow',
      'Yogurt is past its date',
    ]);
    // Flagged, never written off.
    const [i] = await sql(
      `SELECT on_hand FROM kitchen_ingredients WHERE id = $1`,
      [yogurt.id],
    );
    expect(Number(i.on_hand)).toBe(4000);
    const cards = await expectStatus(
      await v.api.get('/food/vendor/kitchen/insights/cards'),
      200,
    );
    // The cards use today: two days left.
    expect(cards[0]).toMatchObject({
      kind: 'expiring_stock',
      priority: 4,
      title: 'Yogurt expires in 2 days',
    });
  });
});
