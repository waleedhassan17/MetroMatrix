import { DateTime } from 'luxon';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset } from './utils/shopping';
import {
  ALL_WEEK,
  Vendor,
  checkout,
  expectStatus,
  foodCustomer,
  foodVendor,
  itemId,
  setUpVendor,
} from './utils/food';
import { ingredient, recipe } from './utils/kitchen';

/** Quetta: only this suite puts vendors (and Ramadan events) here. */
const QTA = { lat: 30.1798, lng: 66.975 };
const TZ = 'Asia/Karachi';
const day = (n: number) =>
  DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;
const hhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

describe('Ramadan hours, storefront attribution, kitchen story, signature badge (Chunk 5 P7)', () => {
  let t: TestApp;
  let admin: Admin;
  let anon: ApiClient;
  let ramadanId: string;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    anon = new ApiClient(t.http);
    // Ramadan in Quetta from yesterday to three days ahead.
    const e = await expectStatus(
      await admin.api.post('/admin/food/calendar-events', {
        kind: 'ramadan',
        name: 'Ramadan (test)',
        startsOn: day(-1),
        endsOn: day(3),
        city: 'Quetta',
      }),
      201,
    );
    ramadanId = e.id;
  });
  afterAll(() => t.close());

  async function kitchen(
    name: string,
    hours?: Array<{ weekday: number; opensAt: string; closesAt: string }>,
  ) {
    const v = await foodVendor(t, admin, 'restaurant', name);
    const live = await setUpVendor(t, v, {
      at: QTA,
      hours,
      settings: { city: 'Quetta', area: 'Jinnah Road' },
    });
    expect(live!.status).toBe(200);
    return v;
  }

  const addToCart = async (
    c: Awaited<ReturnType<typeof foodCustomer>>,
    v: Vendor,
  ) =>
    expectStatus(
      await c.api.post('/food/cart/items', {
        vendorId: v.brandId,
        itemId: await itemId(t, v),
        quantity: 1,
      }),
      201,
    );

  it('staff calendar: CRUD is admin-only, dates checked, every write audited', async () => {
    const v = await kitchen('Calendar Probe Kitchen');
    expect((await v.api.get('/admin/food/calendar-events')).status).toBe(403);
    const bad = await admin.api.post('/admin/food/calendar-events', {
      kind: 'eid',
      name: 'Backwards',
      startsOn: day(10),
      endsOn: day(8),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.endsOn).toBeDefined();
    const eid = await expectStatus(
      await admin.api.post('/admin/food/calendar-events', {
        kind: 'eid',
        name: 'Eid ul Fitr (test)',
        startsOn: day(20),
        endsOn: day(22),
      }),
      201,
    );
    expect(eid).toMatchObject({ kind: 'eid', city: null, endsOn: day(22) });
    const moved = await expectStatus(
      await admin.api.patch(`/admin/food/calendar-events/${eid.id}`, {
        endsOn: day(21),
      }),
      200,
    );
    expect(moved.endsOn).toBe(day(21));
    const list = await expectStatus(
      await admin.api.get(
        `/admin/food/calendar-events?kind=ramadan&city=Quetta`,
      ),
      200,
    );
    expect(list.items.map((e: any) => e.id)).toContain(ramadanId);
    await expectStatus(
      await admin.api.delete(`/admin/food/calendar-events/${eid.id}`),
      200,
    );
    const audit = await sql(
      `SELECT action FROM operational_audit_events WHERE target_id = $1 ORDER BY created_at`,
      [eid.id],
    );
    expect(audit.map((a: any) => a.action)).toEqual([
      'calendar_event.create',
      'calendar_event.update',
      'calendar_event.delete',
    ]);
  });

  it('sehri/iftar windows replace the hours only on Ramadan dates', async () => {
    const v = await kitchen(
      'Ramadan Hours Kitchen',
      ALL_WEEK.map((weekday) => ({
        weekday,
        opensAt: '12:00',
        closesAt: '23:00',
      })),
    );
    const half = await v.api.put('/food/vendor/ramadan', {
      enabled: true,
      sehriFrom: '02:00',
    });
    expect(half.status).toBe(400);
    expect(half.body.error.details.fields.sehriTo).toBeDefined();
    const none = await v.api.put('/food/vendor/ramadan', { enabled: true });
    expect(none.status).toBe(400);
    const set = await expectStatus(
      await v.api.put('/food/vendor/ramadan', {
        enabled: true,
        sehriFrom: '02:00',
        sehriTo: '05:00',
        iftarFrom: '17:00',
        iftarTo: '22:00',
      }),
      200,
    );
    expect(set).toMatchObject({
      settings: { enabled: true, sehriFrom: '02:00', iftarTo: '22:00' },
      activeToday: true,
      today: {
        event: { name: 'Ramadan (test)', endsOn: day(3) },
        sehri: { from: '02:00', to: '05:00' },
        iftar: { from: '17:00', to: '22:00' },
        iftarPreorderOnly: false,
      },
    });
    expect(set.events.map((e: any) => e.id)).toContain(ramadanId);

    const c = await foodCustomer(t, QTA);
    await addToCart(c, v);
    const at = (d: string, time: string) => `${d}T${time}:00+05:00`;
    const schedule = (d: string, time: string) =>
      c.api.patch('/food/cart', { scheduledFor: at(d, time) });
    // Inside Ramadan: the usual 1 PM lunch is closed; sehri and iftar are open.
    const lunch = await schedule(day(2), '13:00');
    expect(lunch.status).toBe(409);
    expect(lunch.body.error.code).toBe('VENDOR_CLOSED');
    expect((await schedule(day(2), '03:30')).status).toBe(200);
    expect((await schedule(day(2), '18:30')).status).toBe(200);
    // After the event: the weekly hours again.
    expect((await schedule(day(5), '13:00')).status).toBe(200);
    const night = await schedule(day(5), '03:30');
    expect(night.status).toBe(409);
    expect(night.body.error.code).toBe('VENDOR_CLOSED');

    // Turned off: the weekly hours even inside the event.
    await expectStatus(
      await v.api.put('/food/vendor/ramadan', {
        enabled: false,
        sehriFrom: '02:00',
        sehriTo: '05:00',
        iftarFrom: '17:00',
        iftarTo: '22:00',
      }),
      200,
    );
    expect((await schedule(day(2), '13:00')).status).toBe(200);
  });

  it('iftar pre-order only: no order for the running iftar window; the vendor page and the iftar rail show it', async () => {
    const v = await kitchen('Iftar Preorder Kitchen');
    const now = DateTime.now().setZone(TZ);
    const mins = now.hour * 60 + now.minute;
    await expectStatus(
      await v.api.put('/food/vendor/ramadan', {
        enabled: true,
        iftarFrom: hhmm(mins - 60),
        iftarTo: hhmm(mins + 120),
        iftarPreorderOnly: true,
      }),
      200,
    );
    const c = await foodCustomer(t, QTA);
    await addToCart(c, v);
    const res = await checkout(c);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'SLOT_INVALID',
      details: { iftarPreorderOnly: true },
    });

    const page = await expectStatus(
      await anon.get(`/food/vendors/${v.brandId}`),
      200,
    );
    expect(page.ramadan).toMatchObject({
      iftar: { from: hhmm(mins - 60), to: hhmm(mins + 120) },
      iftarPreorderOnly: true,
      sehri: null,
    });
    const home = await expectStatus(
      await anon.get(`/food/home?lat=${QTA.lat}&lng=${QTA.lng}`),
      200,
    );
    expect(home.iftarNearYou.map((x: any) => x.id)).toContain(v.brandId);
  });

  it('storefront: public page, QR and storefront orders counted in "Orders you brought"', async () => {
    const v = await kitchen('Storefront Kitchen');
    const [brand] = await sql(`SELECT slug FROM food_brands WHERE id = $1`, [
      v.brandId,
    ]);
    const page = await expectStatus(
      await anon.get(`/public/food/store/${brand.slug}`),
      200,
    );
    expect(page).toMatchObject({
      id: v.brandId,
      storefront: { url: `http://localhost:8081/s/${brand.slug}` },
    });
    expect(page.menu.length).toBeGreaterThan(0);
    expect((await anon.get('/public/food/store/no-such-kitchen')).status).toBe(
      404,
    );

    const a = await foodCustomer(t, QTA);
    await addToCart(a, v);
    const wrong = await checkout(a, { source: 'tiffin' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('VALIDATION_FAILED');
    const qr = await expectStatus(
      await checkout(a, { source: 'qr', campaign: 'flyer-oct' }),
      201,
    );
    await addToCart(a, v);
    await expectStatus(await checkout(a), 201);
    const b = await foodCustomer(t, QTA);
    await addToCart(b, v);
    await expectStatus(await checkout(b), 201);
    await addToCart(b, v);
    await expectStatus(await checkout(b, { source: 'storefront' }), 201);
    const [row] = await sql(
      `SELECT source, campaign FROM food_orders WHERE id = $1`,
      [qr.id],
    );
    expect(row).toEqual({ source: 'qr', campaign: 'flyer-oct' });

    const s = await expectStatus(
      await v.api.get('/food/vendor/storefront'),
      200,
    );
    expect(s).toMatchObject({
      url: `http://localhost:8081/s/${brand.slug}`,
      qr: { payload: `http://localhost:8081/s/${brand.slug}?src=qr` },
      ordersYouBrought: {
        days: 30,
        orders: 2,
        customers: 2,
        // a came through the QR first; b had ordered in the app before.
        newCustomers: 1,
        share: 50,
        qr: { orders: 1 },
        storefront: { orders: 1 },
        campaigns: [{ source: 'qr', campaign: 'flyer-oct', orders: 1 }],
      },
      bySource: {
        app: { orders: 2 },
        qr: { orders: 1 },
        tiffin: { orders: 0 },
      },
    });
    // A cancelled order no longer counts.
    await sql(`UPDATE food_orders SET status = 'cancelled' WHERE id = $1`, [
      qr.id,
    ]);
    const after = await expectStatus(
      await v.api.get('/food/vendor/storefront?days=7'),
      200,
    );
    expect(after.ordersYouBrought).toMatchObject({
      days: 7,
      orders: 1,
      qr: { orders: 0 },
    });
  });

  it('kitchen story: a complete checklist is self-declared; only staff verify; a change drops it back', async () => {
    const v = await kitchen('Story Kitchen');
    const other = await kitchen('Story Other Kitchen');
    const photo = asset(v.userId, 'kitchen_story');
    const checklist = {
      gloves: true,
      hairnet: true,
      cleanWater: true,
      separateBoards: true,
      fridgeTempLog: true,
      pestControlOn: day(-30),
    };
    const foreign = await v.api.put('/food/vendor/story', {
      photos: [asset(other.userId, 'kitchen_story').url],
    });
    expect(foreign.status).toBe(400);
    const partial = await expectStatus(
      await v.api.put('/food/vendor/story', {
        story: 'Ammi’s kitchen since 1998.',
        cookName: 'Ammi Jaan',
        photos: [photo.url],
        hygieneChecklist: { ...checklist, hairnet: false },
      }),
      200,
    );
    expect(partial).toMatchObject({
      hygieneStatus: null,
      checklistComplete: false,
    });
    const declared = await expectStatus(
      await v.api.put('/food/vendor/story', {
        story: 'Ammi’s kitchen since 1998.',
        cookName: 'Ammi Jaan',
        photos: [photo.url],
        hygieneChecklist: checklist,
        // Not the vendor's to set: dropped by the whitelist.
        hygieneStatus: 'verified',
      }),
      200,
    );
    expect(declared).toMatchObject({
      hygieneStatus: 'self_declared',
      badge: 'hygiene_self_declared',
      checklistComplete: true,
    });
    const cards = async () =>
      (
        await expectStatus(
          await anon.get(
            `/food/vendors?lat=${QTA.lat}&lng=${QTA.lng}&pageSize=100`,
          ),
          200,
        )
      ).items.find((x: any) => x.id === v.brandId);
    expect((await cards()).badges).toContain('hygiene_self_declared');
    const page = await expectStatus(
      await anon.get(`/food/vendors/${v.brandId}`),
      200,
    );
    expect(page.story).toMatchObject({
      cookName: 'Ammi Jaan',
      photos: [photo.url],
      hygiene: { status: 'self_declared', label: 'Hygiene self-declared' },
    });

    expect(
      (
        await v.api.post(`/admin/food/hygiene/${v.brandId}/verify`, {
          method: 'visit',
        })
      ).status,
    ).toBe(403);
    const queue = await expectStatus(
      await admin.api.get('/admin/food/hygiene'),
      200,
    );
    expect(queue.items.map((x: any) => x.brandId)).toContain(v.brandId);
    const verified = await expectStatus(
      await admin.api.post(`/admin/food/hygiene/${v.brandId}/verify`, {
        method: 'video_call',
        note: 'Walked through the kitchen on a call',
      }),
      200,
    );
    expect(verified).toMatchObject({
      status: 'verified',
      verifiedMethod: 'video_call',
    });
    const twice = await admin.api.post(
      `/admin/food/hygiene/${v.brandId}/verify`,
      {
        method: 'visit',
      },
    );
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_TRANSITION');
    expect((await cards()).badges).toContain('hygiene_verified');
    const [audit] = await sql(
      `SELECT action FROM operational_audit_events WHERE action = 'hygiene.verify' AND target_id = $1`,
      [v.brandId],
    );
    expect(audit).toBeDefined();

    // A new story text with the same checklist keeps the verification…
    const kept = await expectStatus(
      await v.api.put('/food/vendor/story', {
        story: 'Ammi’s kitchen since 1998 — now with Baji too.',
        cookName: 'Ammi Jaan',
        photos: [photo.url],
        hygieneChecklist: checklist,
      }),
      200,
    );
    expect(kept.hygieneStatus).toBe('verified');
    // …a changed checklist goes back to self-declared.
    const changed = await expectStatus(
      await v.api.put('/food/vendor/story', {
        story: kept.story,
        cookName: 'Ammi Jaan',
        photos: [photo.url],
        hygieneChecklist: { ...checklist, pestControlOn: day(-2) },
      }),
      200,
    );
    expect(changed).toMatchObject({
      hygieneStatus: 'self_declared',
      verifiedAt: null,
    });
    // An old pest control no longer completes it.
    const stale = await expectStatus(
      await v.api.put('/food/vendor/story', {
        hygieneChecklist: { ...checklist, pestControlOn: day(-400) },
      }),
      200,
    );
    expect(stale.hygieneStatus).toBeNull();
  });

  it('signature badge: needs a recipe card, shows on the dish and card, staff can remove it', async () => {
    const v = await kitchen('Signature Kitchen');
    const karahi = await itemId(t, v);
    const noCard = await v.api.put(
      `/food/vendor/kitchen/items/${karahi}/signature`,
      {
        isSignature: true,
      },
    );
    expect(noCard.status).toBe(404);
    const chicken = await ingredient(v, { name: 'Chicken', category: 'meat' });
    await recipe(v, karahi, [
      { ingredientId: chicken.id, qty: 250, unit: 'g' },
    ]);
    const card = await expectStatus(
      await v.api.put(`/food/vendor/kitchen/items/${karahi}/signature`, {
        isSignature: true,
        by: 'Ustad Rafiq',
        since: '2015-06-01',
      }),
      200,
    );
    expect(card).toMatchObject({
      isSignature: true,
      signatureBy: 'Ustad Rafiq',
      signatureSince: '2015-06-01',
    });
    const sheet = await expectStatus(
      await anon.get(`/food/items/${karahi}`),
      200,
    );
    expect(sheet.signature).toMatchObject({
      badge: 'signature',
      by: 'Ustad Rafiq',
      since: '2015-06-01',
    });
    const page = await expectStatus(
      await anon.get(`/food/vendors/${v.brandId}`),
      200,
    );
    expect(page.signatureDishes).toEqual([
      {
        itemId: karahi,
        name: 'Chicken Karahi',
        by: 'Ustad Rafiq',
        since: '2015-06-01',
      },
    ]);
    expect(page.badges).toContain('signature');

    const claims = await expectStatus(
      await admin.api.get('/admin/food/signatures'),
      200,
    );
    const claim = claims.items.find((x: any) => x.itemId === karahi);
    expect(claim).toMatchObject({ brandId: v.brandId, by: 'Ustad Rafiq' });
    const removed = await expectStatus(
      await admin.api.post(
        `/admin/food/signatures/${claim.recipeCardId}/remove`,
        {
          reason: 'A copy of a well-known chain’s recipe',
        },
      ),
      200,
    );
    expect(removed.isSignature).toBe(false);
    expect(
      (
        await admin.api.post(
          `/admin/food/signatures/${claim.recipeCardId}/remove`,
          {
            reason: 'again',
          },
        )
      ).status,
    ).toBe(409);
    expect(
      (await expectStatus(await anon.get(`/food/items/${karahi}`), 200))
        .signature,
    ).toBeNull();
    const told = await sql(
      `SELECT title FROM notifications WHERE user_id = $1 AND type = 'kitchen.story'`,
      [v.userId],
    );
    expect(told.map((n: any) => n.title)).toContain(
      'Signature badge removed: Chicken Karahi',
    );
    const gone = await expectStatus(
      await admin.api.get('/admin/food/signatures?status=removed'),
      200,
    );
    expect(gone.items.find((x: any) => x.itemId === karahi)).toMatchObject({
      removedReason: 'A copy of a well-known chain’s recipe',
    });
  });

  it('home rails and badges: Bachat Box and tiffin near you', async () => {
    const v = await kitchen('Rails Kitchen');
    const now = DateTime.now().setZone(TZ);
    const end = DateTime.min(
      now.plus({ minutes: 60 }),
      now.endOf('day').minus({ seconds: 30 }),
    );
    await expectStatus(
      await v.api.post('/food/vendor/kitchen/surplus-boxes', {
        title: 'Bachat Box — dinner mix',
        originalValue: 1200,
        price: 450,
        quantity: 2,
        pickupFrom: now.toISO(),
        pickupTo: end.toISO(),
      }),
      201,
    );
    const karahi = await itemId(t, v);
    await expectStatus(
      await v.api.post('/food/vendor/tiffin/plans', {
        name: 'Office lunch',
        meal: 'lunch',
        days: ALL_WEEK,
        period: 'weekly',
        pricePerPeriod: 2100,
        deliveryMode: 'both',
        deliveryWindowFrom: '12:30',
        deliveryWindowTo: '13:30',
        capacity: 5,
        rotation: ALL_WEEK.map((weekday) => ({
          weekday,
          menuItemIds: [karahi],
        })),
      }),
      201,
    );
    const home = await expectStatus(
      await anon.get(`/food/home?lat=${QTA.lat}&lng=${QTA.lng}`),
      200,
    );
    const surplus = home.surplusNearYou.find((x: any) => x.id === v.brandId);
    expect(surplus.badges).toContain('bachat_box');
    expect(home.tiffinNearYou.map((x: any) => x.id)).toContain(v.brandId);
    // Sold out or off: the rails drop it.
    await sql(
      `UPDATE surplus_boxes SET remaining = 0, status = 'sold_out' WHERE branch_id = $1`,
      [v.branchId],
    );
    await sql(`UPDATE tiffin_plans SET is_active = false WHERE brand_id = $1`, [
      v.brandId,
    ]);
    const later = await expectStatus(
      await anon.get(`/food/home?lat=${QTA.lat}&lng=${QTA.lng}`),
      200,
    );
    expect((later.surplusNearYou ?? []).map((x: any) => x.id)).not.toContain(
      v.brandId,
    );
    expect((later.tiffinNearYou ?? []).map((x: any) => x.id)).not.toContain(
      v.brandId,
    );
  });
});
