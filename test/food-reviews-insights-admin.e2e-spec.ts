import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import {
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  liveHomeKitchen,
  setUpVendor,
} from './utils/food';
import { FoodJobsService } from '../src/modules/food/jobs/food-jobs.service';

/** Sialkot: no other suite puts vendors here. */
const SIALKOT = { lat: 32.4945, lng: 74.5229 };

describe('Food P7: reviews, insights, admin, nightly jobs (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: FoodJobsService;
  const anon = () => new ApiClient(t.http);
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const act = (v: Vendor, id: string, step: string, body: object = {}) =>
    v.api.post(`/food/vendor/orders/${id}/${step}`, body);
  const audited = async (action: string) =>
    (
      await sql(
        `SELECT count(*)::int AS n FROM operational_audit_events WHERE action = $1`,
        [action],
      )
    )[0].n;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    jobs = t.app.get(FoodJobsService);
  });
  afterAll(() => t.close());

  async function delivered(
    v: Vendor,
    c: Awaited<ReturnType<typeof foodCustomer>>,
    item: string,
  ) {
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: item,
        quantity: 1,
      }),
      201,
    );
    const o = await expectStatus(await checkout(c), 201);
    for (const s of [
      'accept',
      'preparing',
      'ready',
      'handed-external',
      'delivered',
    ])
      await expectStatus(await act(v, o.id, s), 200);
    return o;
  }

  it('review once, after delivery or pickup (QA #22); rating, summary, replies, moderation', async () => {
    const v = await foodVendor(t, admin, 'restaurant', 'Review Me Karahi');
    await setUpVendor(t, v);
    const karahi = await itemId(t, v);
    const c = await foodCustomer(t);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: karahi,
        quantity: 1,
      }),
      201,
    );
    const early = await expectStatus(await checkout(c), 201);
    const notYet = await c.api.post(`/food/orders/${early.code}/review`, {
      foodRating: 5,
    });
    expect(notYet.status).toBe(409);
    expect(notYet.body.error.code).toBe('REVIEW_NOT_ALLOWED');
    await expectStatus(
      await act(v, early.id, 'reject', { reason: 'Closing early' }),
      200,
    );

    const o = await delivered(v, c, karahi);
    expect(
      (await expectStatus(await c.api.get(`/food/orders/${o.code}`), 200))
        .canReview,
    ).toBe(true);
    const r = await expectStatus(
      await c.api.post(`/food/orders/${o.code}/review`, {
        foodRating: 4,
        deliveryRating: 5,
        tags: ['tasty', 'hot_and_fresh', 'tasty'],
        text: 'Karahi was spot on.',
        photos: [asset(c.userId, 'review_photo').url],
      }),
      201,
    );
    expect(r).toMatchObject({
      foodRating: 4,
      deliveryRating: 5,
      tags: ['tasty', 'hot_and_fresh'],
    });
    const twice = await c.api.post(`/food/orders/${o.code}/review`, {
      foodRating: 1,
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('REVIEW_EXISTS');
    expect(
      (await expectStatus(await c.api.get(`/food/orders/${o.code}`), 200))
        .canReview,
    ).toBe(false);
    const stolen = await c.api.post(`/food/orders/${o.code}/review`, {
      foodRating: 4,
      photos: [
        asset('5e0df47d-5300-4605-b4b7-3f8d5e6c8470', 'review_photo').url,
      ],
    });
    expect(stolen.status).toBe(409); // already reviewed comes first

    const c2 = await foodCustomer(t);
    const o2 = await delivered(v, c2, karahi);
    await expectStatus(
      await c2.api.post(`/food/orders/${o2.code}/review`, {
        foodRating: 2,
        tags: ['tasty'],
      }),
      201,
    );
    const [brand] = await sql(
      `SELECT rating_avg, rating_count, slug FROM food_brands WHERE id = $1`,
      [v.brandId],
    );
    expect([parseFloat(brand.rating_avg), brand.rating_count]).toEqual([3, 2]);

    const page = await expectStatus(
      await anon().get(`/food/vendors/${brand.slug}`),
      200,
    );
    expect(page.ratingSummary).toMatchObject({
      ratingAvg: 3,
      ratingCount: 2,
      distribution: { 5: 0, 4: 1, 3: 0, 2: 1, 1: 0 },
      topTags: [
        { tag: 'tasty', count: 2 },
        { tag: 'hot_and_fresh', count: 1 },
      ],
    });
    expect(page.ratingSummary.recent).toHaveLength(2);
    expect(page.ratingSummary.recent[1]).toMatchObject({
      author: 'Test',
      text: 'Karahi was spot on.',
    });

    const waiting = await expectStatus(
      await v.api.get('/food/vendor/reviews?unreplied=true'),
      200,
    );
    expect(waiting.total).toBe(2);
    const replied = await expectStatus(
      await v.api.post(`/food/vendor/reviews/${r.id}/reply`, {
        reply: 'Thank you, come again!',
      }),
      200,
    );
    expect(replied.vendorReply).toBe('Thank you, come again!');
    expect(
      (
        await expectStatus(
          await v.api.get('/food/vendor/reviews?unreplied=true'),
          200,
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await sql(
          `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'food.review.reply'`,
          [c.userId],
        )
      ).length,
    ).toBe(1);

    // Staff hide the 2★ review: out of the rating at once.
    const low = (
      await expectStatus(
        await admin.api.get(
          `/admin/food/reviews?vendorId=${v.brandId}&maxRating=2`,
        ),
        200,
      )
    ).items[0];
    await expectStatus(
      await admin.api.post(`/admin/food/reviews/${low.id}/hide`, {
        reason: 'Abusive language',
      }),
      200,
    );
    const [after] = await sql(
      `SELECT rating_avg, rating_count FROM food_brands WHERE id = $1`,
      [v.brandId],
    );
    expect([parseFloat(after.rating_avg), after.rating_count]).toEqual([4, 1]);
    expect(
      (
        await expectStatus(
          await anon().get(`/food/vendors/${v.brandId}/reviews`),
          200,
        )
      ).total,
    ).toBe(1);
    await expectStatus(
      await admin.api.post(`/admin/food/reviews/${low.id}/unhide`),
      200,
    );
    expect(
      (
        await sql(`SELECT rating_count FROM food_brands WHERE id = $1`, [
          v.brandId,
        ])
      )[0].rating_count,
    ).toBe(2);
    expect(await audited('food.review.hide')).toBeGreaterThanOrEqual(1);
    expect(await audited('food.review.unhide')).toBeGreaterThanOrEqual(1);

    // Pickup reviews carry no delivery rating.
    const hk = await liveHomeKitchen(t, admin, 'Pickup Reviews Kitchen');
    const c3 = await foodCustomer(t);
    await expectStatus(
      await c3.api.post('/food/cart/items', {
        vendorId: hk.brandId,
        itemId: await itemId(t, hk),
        quantity: 1,
      }),
      201,
    );
    await expectStatus(
      await c3.api.patch('/food/cart', { fulfilment: 'pickup' }),
      200,
    );
    const p = await expectStatus(
      await checkout(c3, { paymentMethod: 'pay_at_pickup' }),
      201,
    );
    for (const s of ['accept', 'preparing', 'ready', 'picked-up'])
      await expectStatus(await act(hk, p.id, s), 200);
    const pr = await expectStatus(
      await c3.api.post(`/food/orders/${p.code}/review`, {
        foodRating: 5,
        deliveryRating: 1,
      }),
      201,
    );
    expect(pr.deliveryRating).toBeNull();
  });

  it('insights match a hand-computed day', async () => {
    const v = await foodVendor(t, admin, 'restaurant', 'Insightful Tikka');
    await setUpVendor(t, v);
    const karahi = await itemId(t, v);
    const regular = await foodCustomer(t);
    const once = await foodCustomer(t);
    const place = async (c: typeof regular, qty = 1) => {
      await expectStatus(
        await c.api.post('/food/cart/items', {
          vendorId: v.brandId,
          itemId: karahi,
          quantity: qty,
        }),
        201,
      );
      return expectStatus(await checkout(c), 201);
    };
    // 5 orders on Thu 10 Sep 2026 (Karachi): 2 completed, 1 rejected, 1 auto-rejected, 1 cancelled by the customer.
    const a = await delivered(v, regular, karahi); // 1600 + 99
    const b = await place(regular, 2); // 3200 + 99
    for (const s of [
      'accept',
      'preparing',
      'ready',
      'handed-external',
      'delivered',
    ])
      await expectStatus(await act(v, b.id, s), 200);
    const c = await place(once);
    await expectStatus(
      await act(v, c.id, 'reject', { reason: 'Out of chicken' }),
      200,
    );
    const d = await place(once);
    await sql(
      `UPDATE food_orders SET accept_by = now() - interval '1 second' WHERE id = $1`,
      [d.id],
    );
    await jobs.autoReject();
    const e = await place(once);
    await expectStatus(
      await once.api.post(`/food/orders/${e.code}/cancel`, {
        reason: 'Ordered twice',
      }),
      200,
    );
    const at = (hhmm: string) => `2026-09-10T${hhmm}:00+05:00`;
    const set = (id: string, cols: Record<string, string | null>) =>
      sql(
        `UPDATE food_orders SET ${Object.keys(cols)
          .map((k, i) => `${k} = $${i + 2}`)
          .join(', ')} WHERE id = $1`,
        [id, ...Object.values(cols)],
      );
    await set(a.id, {
      created_at: at('12:00'),
      accepted_at: at('12:01'), // 60 s
      ready_at: at('12:21'), // 20 min
      delivered_at: at('12:40'),
      promised_at: at('12:45'), // on time
    });
    await set(b.id, {
      created_at: at('19:00'),
      accepted_at: at('19:02'), // 120 s
      ready_at: at('19:32'), // 30 min
      delivered_at: at('20:10'),
      promised_at: at('20:00'), // late
    });
    await set(c.id, { created_at: at('20:30') });
    await set(d.id, { created_at: at('21:00') });
    await set(e.id, { created_at: at('21:30') });

    const day = await expectStatus(
      await v.api.get('/food/vendor/insights?from=2026-09-10&to=2026-09-10'),
      200,
    );
    expect(day).toMatchObject({
      range: { from: '2026-09-10', to: '2026-09-10', timezone: 'Asia/Karachi' },
      totals: {
        orders: 5,
        completed: 2,
        recordedSales: 1699 + 3299,
        averageOrderValue: Math.floor((1699 + 3299) / 2),
      },
      days: [
        {
          date: '2026-09-10',
          orders: 5,
          completed: 2,
          cancelled: 3,
          recordedSales: 4998,
        },
      ],
      acceptanceRate: 0.5, // 2 accepted of 4 answered (the customer's own cancel is not the vendor's to answer)
      autoRejected: 1,
      avgAcceptSeconds: 90,
      avgPrepMinutes: 25,
      onTimeRate: 0.5,
      topItems: [{ name: 'Chicken Karahi', quantity: 3, recordedSales: 4800 }],
      repeatCustomers: { customers: 2, repeat: 2, rate: 1 },
    });
    expect(day.note).toMatch(/holds none of it/);
    expect(day.cancelReasons).toEqual(
      expect.arrayContaining([
        { status: 'rejected', reason: 'Out of chicken', count: 1 },
        { status: 'cancelled', reason: 'Ordered twice', count: 1 },
        {
          status: 'auto_rejected',
          reason: expect.stringMatching(/didn’t respond/),
          count: 1,
        },
      ]),
    );
    const week = await expectStatus(
      await v.api.get('/food/vendor/insights?range=7d'),
      200,
    );
    expect(week.days).toHaveLength(7);
    expect(week.totals.orders).toBe(0);
    expect(
      (await v.api.get('/food/vendor/insights?from=2026-09-10')).status,
    ).toBe(400);

    // An admin plan override applies at once: no insights entitlement → 409.
    await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
        overrides: { entitlements: { insights: false } },
      }),
      200,
    );
    const off = await v.api.get('/food/vendor/insights');
    expect(off.status).toBe(409);
    expect(off.body.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { entitlement: 'insights' },
    });
    await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
        overrides: { limits: { promotions_active: 1 } },
      }),
      200,
    );
    expect((await v.api.get('/food/vendor/insights')).status).toBe(200);
    await expectStatus(
      await v.api.post('/food/vendor/promotions', {
        title: 'One',
        kind: 'flat_off',
        value: 50,
      }),
      201,
    );
    const second = await v.api.post('/food/vendor/promotions', {
      title: 'Two',
      kind: 'flat_off',
      value: 60,
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { key: 'promotions_active', limit: 1 },
    });
    expect(await audited('food.vendor.plan')).toBeGreaterThanOrEqual(2);
  });

  it('suspend hides the vendor and tells customers with active orders (QA #26); reinstate brings it back', async () => {
    const v = await foodVendor(t, admin, 'restaurant', 'Suspended Sajji');
    await setUpVendor(t, v, { at: SIALKOT });
    const karahi = await itemId(t, v);
    const c = await foodCustomer(t, SIALKOT);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: karahi,
        quantity: 1,
      }),
      201,
    );
    const o = await expectStatus(await checkout(c), 201);
    await expectStatus(await act(v, o.id, 'accept'), 200);
    const listed = async () =>
      (
        await expectStatus(
          await anon().get(
            `/food/vendors?lat=${SIALKOT.lat}&lng=${SIALKOT.lng}`,
          ),
          200,
        )
      ).items.map((x: any) => x.id);
    expect(await listed()).toContain(v.brandId);

    const s = await expectStatus(
      await admin.api.post(`/admin/food/vendors/${v.brandId}/suspend`, {
        reason: 'Hygiene complaints',
      }),
      200,
    );
    expect(s).toMatchObject({
      businessStatus: 'suspended',
      suspensionReason: 'Hygiene complaints',
    });
    expect(await listed()).not.toContain(v.brandId);
    expect((await anon().get(`/food/vendors/${v.brandId}`)).status).toBe(404);
    const [n] = await sql(
      `SELECT title, body FROM notifications WHERE user_id = $1 AND type = 'food.vendor.suspended'`,
      [c.userId],
    );
    expect(n.title).toBe('Suspended Sajji is unavailable');
    expect(n.body).toContain(o.code);
    const blocked = await v.api.get('/food/vendor/orders');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('BUSINESS_SUSPENDED');
    expect(await audited('business.suspend')).toBeGreaterThanOrEqual(1);

    await expectStatus(
      await admin.api.post(`/admin/food/vendors/${v.brandId}/reinstate`, {
        reason: 'Inspection passed',
      }),
      200,
    );
    expect(await listed()).toContain(v.brandId);
    expect((await v.api.get('/food/vendor/orders')).status).toBe(200);
  });

  it('staff tools: overview, vendors, orders lookup, feature, cuisines, banners — every write audited', async () => {
    const v = await foodVendor(t, admin, 'cloud_kitchen', 'Admin Desk Kitchen');
    await setUpVendor(t, v, { at: SIALKOT });
    const c = await foodCustomer(t, SIALKOT);
    const o = await delivered(v, c, await itemId(t, v));

    const ov = await expectStatus(
      await admin.api.get('/admin/food/overview'),
      200,
    );
    expect(ov.activeVendors.cloud_kitchen).toBeGreaterThanOrEqual(1);
    expect(ov.ordersToday).toBeGreaterThanOrEqual(1);
    expect(ov).toHaveProperty('acceptanceRateToday');
    expect(ov).toHaveProperty('waiting.approvals');

    const list = await expectStatus(
      await admin.api.get(
        '/admin/food/vendors?type=cloud_kitchen&city=Lahore&q=Admin%20Desk',
      ),
      200,
    );
    expect(list.items).toMatchObject([
      {
        id: v.brandId,
        subTypeLabel: 'Cloud kitchen',
        businessStatus: 'approved',
        branchStatus: 'active',
        planKey: 'community',
        orders30d: 1,
      },
    ]);
    const detail = await expectStatus(
      await admin.api.get(`/admin/food/vendors/${v.brandId}`),
      200,
    );
    expect(detail).toMatchObject({
      id: v.brandId,
      subTypeLabel: 'Cloud kitchen',
      plan: { planKey: 'community' },
    });
    expect(detail.menu[0].items[0]).toMatchObject({
      name: 'Chicken Karahi',
      basePrice: 1600,
    });
    expect(detail.recentOrders.map((x: any) => x.code)).toEqual([o.code]);
    expect(
      (
        await expectStatus(
          await admin.api.get(
            '/admin/businesses?serviceType=food&pageSize=100',
          ),
          200,
        )
      ).items[0],
    ).toHaveProperty('subTypeLabel');

    const found = await expectStatus(
      await admin.api.get(`/admin/food/orders?code=${o.code.toLowerCase()}`),
      200,
    );
    expect(found.items).toMatchObject([
      { id: o.id, code: o.code, status: 'delivered', vendorId: v.brandId },
    ]);
    const full = await expectStatus(
      await admin.api.get(`/admin/food/orders/${o.id}`),
      200,
    );
    expect(full.events.length).toBeGreaterThanOrEqual(6);
    expect(full.customer.email).toBe(c.email);
    expect((await v.api.get(`/admin/food/orders/${o.id}`)).status).toBe(403);

    await expectStatus(
      await admin.api.post(`/admin/food/vendors/${v.brandId}/feature`),
      200,
    );
    const card = await expectStatus(
      await anon().get(`/food/vendors/${v.brandId}`),
      200,
    );
    expect(card.isFeatured).toBe(true);
    await expectStatus(
      await admin.api.post(`/admin/food/vendors/${v.brandId}/unfeature`),
      200,
    );

    const cu = await expectStatus(
      await admin.api.post('/admin/food/cuisines', {
        name: 'Sajji',
        slug: 'sajji',
        icon: 'flame',
      }),
      201,
    );
    expect(
      (
        await admin.api.post('/admin/food/cuisines', {
          name: 'Again',
          slug: 'sajji',
        })
      ).status,
    ).toBe(409);
    await expectStatus(
      await admin.api.patch(`/admin/food/cuisines/${cu.id}`, {
        name: 'Balochi Sajji',
      }),
      200,
    );
    const used = (
      await sql(`SELECT id FROM cuisines WHERE slug = 'pakistani'`)
    )[0].id;
    expect(
      (await admin.api.delete(`/admin/food/cuisines/${used}`)).status,
    ).toBe(409);

    // Banners: the home for Lahore shows the live ones whose target exists.
    const img = asset(admin.userId, 'banner').url;
    const vendorBanner = await expectStatus(
      await admin.api.post('/admin/food/banners', {
        imageUrl: img,
        title: 'Try Admin Desk',
        targetType: 'vendor',
        targetId: v.brandId,
        city: 'Lahore',
      }),
      201,
    );
    await expectStatus(
      await admin.api.post('/admin/food/banners', {
        imageUrl: asset(admin.userId, 'banner').url,
        title: 'Sajji week',
        targetType: 'cuisine',
        targetId: cu.id,
      }),
      201,
    );
    await expectStatus(
      await admin.api.post('/admin/food/banners', {
        imageUrl: asset(admin.userId, 'banner').url,
        title: 'Next month',
        targetType: 'search',
        targetQuery: 'biryani',
        startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
      201,
    );
    expect(
      (
        await admin.api.post('/admin/food/banners', {
          imageUrl: img,
          title: 'Nope',
          targetType: 'vendor',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.api.post('/admin/food/banners', {
          imageUrl: asset(c.userId, 'banner').url,
          title: 'Not yours',
          targetType: 'search',
          targetQuery: 'x',
        })
      ).status,
    ).toBe(400);
    const home = await expectStatus(
      await anon().get(`/food/home?lat=${SIALKOT.lat}&lng=${SIALKOT.lng}`),
      200,
    );
    expect(home.banners.map((b: any) => b.title)).toEqual(
      expect.arrayContaining(['Try Admin Desk', 'Sajji week']),
    );
    expect(home.banners.map((b: any) => b.title)).not.toContain('Next month');
    expect(
      home.banners.find((b: any) => b.title === 'Try Admin Desk').target,
    ).toMatchObject({ type: 'vendor', id: v.brandId });
    await expectStatus(
      await admin.api.patch(`/admin/food/banners/${vendorBanner.id}`, {
        isActive: false,
      }),
      200,
    );
    const home2 = await expectStatus(
      await anon().get(`/food/home?lat=${SIALKOT.lat}&lng=${SIALKOT.lng}`),
      200,
    );
    expect(home2.banners.map((b: any) => b.title)).not.toContain(
      'Try Admin Desk',
    );
    await expectStatus(
      await admin.api.delete(`/admin/food/banners/${vendorBanner.id}`),
      200,
    );

    for (const action of [
      'food.vendor.feature',
      'food.vendor.unfeature',
      'food.cuisine.create',
      'food.cuisine.update',
      'food.banner.create',
      'food.banner.update',
      'food.banner.delete',
    ])
      expect([action, await audited(action)]).toEqual([
        action,
        expect.any(Number),
      ]);
    expect(await audited('food.banner.create')).toBeGreaterThanOrEqual(3);
    expect(
      (
        await expectStatus(
          await admin.api.delete(`/admin/food/cuisines/${cu.id}`),
          200,
        )
      ).deleted,
    ).toBe(true);
    expect(await audited('food.cuisine.delete')).toBe(1);
  });

  it('daily reset, reminders, nudges and the nightly work: each runs twice with no double effects (QA #27)', async () => {
    const v = await liveHomeKitchen(t, admin, 'Nightly Nihari');
    const karahi = await itemId(t, v);
    // The kitchen sold 5 of 20 today.
    await sql(
      `UPDATE branch_item_overrides SET remaining_today = 15 WHERE branch_id = $1 AND item_id = $2`,
      [v.branchId, karahi],
    );
    await sql(
      `UPDATE branches SET portions_reset_on = NULL, busy_until = now() - interval '1 minute', busy_extra_minutes = 15 WHERE id = $1`,
      [v.branchId],
    );
    const first = await jobs.dailyReset();
    expect(first.branches).toBeGreaterThanOrEqual(1);
    const left = async () =>
      (
        await sql(
          `SELECT remaining_today FROM branch_item_overrides WHERE branch_id = $1 AND item_id = $2`,
          [v.branchId, karahi],
        )
      )[0].remaining_today;
    expect(await left()).toBe(20);
    expect(
      (
        await sql(
          `SELECT busy_until, busy_extra_minutes FROM branches WHERE id = $1`,
          [v.branchId],
        )
      )[0],
    ).toEqual({
      busy_until: null,
      busy_extra_minutes: 0,
    });
    await sql(
      `UPDATE branch_item_overrides SET remaining_today = 12 WHERE branch_id = $1 AND item_id = $2`,
      [v.branchId, karahi],
    );
    expect(await jobs.dailyReset()).toEqual({
      branches: 0,
      portions: 0,
      busyCleared: 0,
    });
    expect(await left()).toBe(12);

    // Accept nudge 2 minutes before auto-reject, once.
    const c = await foodCustomer(t);
    await expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: karahi,
        quantity: 1,
      }),
      201,
    );
    const o = await expectStatus(await checkout(c), 201);
    await sql(
      `UPDATE food_orders SET accept_by = now() + interval '90 seconds' WHERE id = $1`,
      [o.id],
    );
    expect(await jobs.acceptNudges()).toEqual({ nudged: 1 });
    expect(await jobs.acceptNudges()).toEqual({ nudged: 0 });

    // A scheduled order: start cooking at scheduled_for − prep − 10, once.
    await expectStatus(await act(v, o.id, 'accept'), 200);
    await sql(
      `UPDATE food_orders SET scheduled_for = now() + interval '25 minutes' WHERE id = $1`,
      [o.id],
    );
    expect(await jobs.kitchenReminders()).toEqual({ reminded: 1 });
    expect(await jobs.kitchenReminders()).toEqual({ reminded: 0 });
    const owner = (
      await sql(`SELECT owner_user_id FROM businesses WHERE id = $1`, [
        v.businessId,
      ])
    )[0].owner_user_id;
    const types = (
      await sql(`SELECT type FROM notifications WHERE user_id = $1`, [owner])
    ).map((r: any) => r.type);
    expect(
      types.filter((x: string) => x === 'food.order.accept_soon'),
    ).toHaveLength(1);
    expect(
      types.filter((x: string) => x === 'food.order.start_cooking'),
    ).toHaveLength(1);

    // Nightly: ratings / sold_30d recomputed, old location history purged — the second run changes nothing.
    await sql(
      `UPDATE food_brands SET rating_avg = 4.9, rating_count = 99 WHERE id = $1`,
      [v.brandId],
    );
    const r = await t.ds.query(
      `INSERT INTO riders (user_id, business_id, full_name) SELECT id, $1, 'Old Logs' FROM users WHERE id = $2 RETURNING id`,
      [v.businessId, c.userId],
    );
    await sql(
      `INSERT INTO rider_location_logs (rider_id, lat, lng, at) VALUES ($1, 31.5, 74.3, now() - interval '15 days'), ($1, 31.5, 74.3, now() - interval '1 day')`,
      [r[0].id],
    );
    const night = await jobs.nightlyWork();
    expect(night.ratings).toBeGreaterThanOrEqual(1);
    expect(night.purged).toBe(1);
    expect(
      (
        await sql(
          `SELECT rating_avg, rating_count FROM food_brands WHERE id = $1`,
          [v.brandId],
        )
      )[0],
    ).toEqual({
      rating_avg: '0.00',
      rating_count: 0,
    });
    expect(await jobs.nightlyWork()).toEqual({
      ratings: 0,
      sold: 0,
      purged: 0,
    });
  });
});
