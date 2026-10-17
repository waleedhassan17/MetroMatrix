import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
import { Vendor, expectStatus, foodVendor, setUpVendor } from './utils/food';

/** Multan: no other suite puts vendors here, so results are this suite's alone. */
const MULTAN = { lat: 30.1575, lng: 71.5249 };
const KARACHI = { lat: 24.8607, lng: 67.0011 };
/** ~1 km of latitude. */
const KM = 0.009;
const north = (km: number) => ({ lat: MULTAN.lat + km * KM, lng: MULTAN.lng });

describe('Food P3: discovery, serviceability, search (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const anon = () => new ApiClient(t.http);
  const V: Record<string, Vendor> = {};
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  async function dish(
    v: Vendor,
    category: string,
    name: string,
    price: number,
  ) {
    const cats = await expectStatus(
      await v.api.get('/food/vendor/menu/categories'),
      200,
    );
    const cat =
      cats.find((c: any) => c.name === category) ??
      (await expectStatus(
        await v.api.post('/food/vendor/menu/categories', { name: category }),
        201,
      ));
    return expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name,
        basePrice: price,
      }),
      201,
    );
  }
  /** setUpVendor gives everyone a "Chicken Karahi"; rename it so a search sees only what a test means. */
  async function renameDefault(v: Vendor, name: string) {
    const [row] = await sql(
      `SELECT id FROM menu_items WHERE brand_id = $1 AND name = 'Chicken Karahi'`,
      [v.brandId],
    );
    await expectStatus(
      await v.api.patch(`/food/vendor/menu/items/${row.id}`, { name }),
      200,
    );
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    const today = new Date(Date.now() + 5 * 3600e3).getUTCDay();

    // A: karahi restaurant at the point, rated 4.6, mid price, pickup too.
    V.A = await foodVendor(t, admin, 'restaurant', 'Multan Karahi Point');
    expect(
      (await setUpVendor(t, V.A, {
        at: north(1),
        cuisines: ['pakistani', 'karahi'],
        settings: { acceptsPickup: true },
      }))!.status,
    ).toBe(200);
    await dish(V.A, 'Mains', 'Mutton Karahi', 2200);
    // B: a home kitchen 2 km away, pickup only.
    V.B = await foodVendor(t, admin, 'home_kitchen', 'Nani Ka Ghar');
    await setUpVendor(t, V.B, {
      at: north(2),
      cuisines: ['home-food'],
      settings: { acceptsDelivery: true, acceptsPickup: true },
      goLive: false,
    });
    await expectStatus(
      await admin.api.post(
        `/admin/food/branches/${V.B.branchId}/food-safety-check`,
        { outcome: 'passed', note: 'Kitchen inspected' },
      ),
      200,
    );
    await expectStatus(await V.B.api.post('/food/vendor/go-live'), 200);
    await renameDefault(V.B, 'Daal Chawal');
    // C: a burger cloud kitchen 3 km away, budget, free delivery.
    V.C = await foodVendor(t, admin, 'cloud_kitchen', 'Smash Lab');
    await setUpVendor(t, V.C, {
      at: north(3),
      cuisines: ['burgers', 'fast-food'],
      bands: [{ fromKm: 0, toKm: 6, fee: 0, minOrder: 400 }],
    });
    await expectStatus(
      await V.C.api.patch('/food/vendor/profile', { priceLevel: 1 }),
      200,
    );
    await renameDefault(V.C, 'Smash Burger');
    await dish(V.C, 'Burgers', 'Karahi Burger', 650);
    // D: a restaurant 5 km away, closed now (opens in two days).
    V.D = await foodVendor(t, admin, 'restaurant', 'Sohan Halwa House');
    await setUpVendor(t, V.D, {
      at: north(5),
      cuisines: ['desserts'],
      hours: [
        { weekday: (today + 2) % 7, opensAt: '10:00', closesAt: '11:00' },
      ],
    });
    await expectStatus(
      await V.D.api.patch('/food/vendor/profile', { priceLevel: 3 }),
      200,
    );
    await renameDefault(V.D, 'Sohan Halwa');
    // E: Karachi — out of zone for Multan.
    V.E = await foodVendor(t, admin, 'restaurant', 'Karachi Karahi');
    await setUpVendor(t, V.E, { at: KARACHI, cuisines: ['karahi'] });
    // F: paused.
    V.F = await foodVendor(t, admin, 'restaurant', 'Paused Biryani');
    await setUpVendor(t, V.F, { at: north(1.5), cuisines: ['biryani'] });
    await expectStatus(
      await V.F.api.post('/food/vendor/pause', {
        message: 'Back after Jummah',
      }),
      200,
    );
    // G: approved but never went live.
    V.G = await foodVendor(t, admin, 'restaurant', 'Draft Dhaba');
    await setUpVendor(t, V.G, { at: north(1), goLive: false });

    await sql(
      `UPDATE food_brands SET rating_avg = 4.6, rating_count = 120 WHERE id = $1`,
      [V.A.brandId],
    );
    await sql(
      `UPDATE food_brands SET rating_avg = 4.0, rating_count = 30 WHERE id = $1`,
      [V.C.brandId],
    );
    await sql(
      `UPDATE food_brands SET rating_avg = 4.3, rating_count = 12 WHERE id = $1`,
      [V.B.brandId],
    );
  });
  afterAll(() => t.close());

  const ids = async (q: string, at = MULTAN) =>
    (
      await expectStatus(
        await anon().get(
          `/food/vendors?lat=${at.lat}&lng=${at.lng}&pageSize=100&${q}`,
        ),
        200,
      )
    ).items.map((c: any) => c.id);

  it('only vendors that deliver here; far away = "Not delivering here yet"; pickup reaches further (QA #1)', async () => {
    const here = await ids('');
    expect(here).toEqual(
      expect.arrayContaining([
        V.A.brandId,
        V.B.brandId,
        V.C.brandId,
        V.D.brandId,
      ]),
    );
    expect(here).not.toContain(V.E.brandId);
    expect(here).not.toContain(V.F.brandId);
    expect(here).not.toContain(V.G.brandId);

    const far = north(12); // outside every 6 km radius, inside the 25 km pickup reach
    expect(await ids('', far)).toEqual([]);
    const home = await expectStatus(
      await anon().get(`/food/home?lat=${far.lat}&lng=${far.lng}`),
      200,
    );
    expect(home.coverage).toMatchObject({
      delivering: false,
      message: 'Not delivering here yet',
    });
    expect(home.coverage.pickupNearby).toBeGreaterThanOrEqual(2);
    expect(await ids('pickup=true', far)).toEqual(
      expect.arrayContaining([V.A.brandId, V.B.brandId, V.D.brandId]),
    );
    expect(await ids('pickup=true', far)).not.toContain(V.C.brandId); // a cloud kitchen without pickup
  });

  it('cards carry fee, minimum, ETA range, distance, cuisines and open state', async () => {
    const list = await expectStatus(
      await anon().get(
        `/food/vendors?lat=${MULTAN.lat}&lng=${MULTAN.lng}&pageSize=100`,
      ),
      200,
    );
    const a = list.items.find((c: any) => c.id === V.A.brandId);
    expect(a).toMatchObject({
      name: 'Multan Karahi Point',
      deliveryFee: 99,
      minOrder: 300,
      priceLevel: 2,
      ratingAvg: 4.6,
      ratingCount: 120,
      isHomeKitchen: false,
      isNew: true,
      fulfilment: { delivery: true, pickup: true },
      openState: { open: true },
      cuisines: [{ slug: 'pakistani' }, { slug: 'karahi' }],
    });
    expect(a.distanceKm).toBeCloseTo(1, 0);
    expect(a.etaRange.min).toBe(20 + Math.ceil((a.distanceKm / 22) * 60) + 5);
    expect(a.etaRange.max).toBe(a.etaRange.min + 10);
    const d = list.items.find((c: any) => c.id === V.D.brandId);
    expect(d.openState.open).toBe(false);
    expect(d.openState.label).toMatch(/^Opens \w{3} 10:00 AM$/);
    const c = list.items.find((x: any) => x.id === V.C.brandId);
    expect(c).toMatchObject({
      deliveryFee: 0,
      minOrder: 400,
      isHomeKitchen: false,
    });
    // Open vendors are listed before closed ones.
    expect(list.items.findIndex((x: any) => x.id === V.D.brandId)).toBe(
      list.items.length - 1,
    );

    // Busy mode adds its minutes to the ETA (QA #3).
    await expectStatus(
      await V.A.api.post('/food/vendor/busy', { extraMinutes: 15 }),
      200,
    );
    const busy = (
      await expectStatus(
        await anon().get(
          `/food/vendors?lat=${MULTAN.lat}&lng=${MULTAN.lng}&pageSize=100`,
        ),
        200,
      )
    ).items.find((x: any) => x.id === V.A.brandId);
    expect(busy.etaRange).toMatchObject({
      min: a.etaRange.min + 15,
      max: a.etaRange.max + 15,
    });
    await expectStatus(
      await V.A.api.post('/food/vendor/busy', { extraMinutes: 0 }),
      200,
    );
    // The second band applies past 3 km.
    const far = north(4.5);
    const a2 = (
      await expectStatus(
        await anon().get(
          `/food/vendors?lat=${far.lat}&lng=${far.lng}&pageSize=100`,
        ),
        200,
      )
    ).items.find((x: any) => x.id === V.A.brandId);
    expect(a2).toMatchObject({ deliveryFee: 149, minOrder: 500 });
  });

  it('every filter changes the result set', async () => {
    const all = new Set([V.A, V.B, V.C, V.D].map((v) => v.brandId));
    const mine = async (q: string) =>
      (await ids(q)).filter((id: string) => all.has(id));
    const base = await mine('');
    expect(base).toHaveLength(4);
    const cases: Array<[string, string[]]> = [
      ['cuisine=burgers', [V.C.brandId]],
      ['cuisine=karahi', [V.A.brandId]],
      ['homeKitchen=true', [V.B.brandId]],
      ['priceLevel=1', [V.C.brandId]],
      ['priceLevel=3', [V.D.brandId]],
      ['minRating=4.5', [V.A.brandId]],
      ['openNow=true', [V.A.brandId, V.B.brandId, V.C.brandId]],
      ['freeDelivery=true', [V.C.brandId]],
      ['pickup=true', [V.A.brandId, V.B.brandId, V.D.brandId]],
      ['offers=true', []],
      ['q=karahi', [V.A.brandId, V.C.brandId]],
      ['q=Smash', [V.C.brandId]],
    ];
    for (const [q, expected] of cases) {
      expect([q, (await mine(q)).sort()]).toEqual([q, [...expected].sort()]);
    }
  });

  it('every sort changes the order (open vendors first)', async () => {
    const open = new Set([V.A, V.B, V.C].map((v) => v.brandId));
    const order = async (sort: string) =>
      (await ids(`sort=${sort}&openNow=true`)).filter((id: string) =>
        open.has(id),
      );
    expect(await order('distance')).toEqual([
      V.A.brandId,
      V.B.brandId,
      V.C.brandId,
    ]);
    expect(await order('rating')).toEqual([
      V.A.brandId,
      V.B.brandId,
      V.C.brandId,
    ]);
    expect((await order('delivery_fee'))[0]).toBe(V.C.brandId);
    const byTime = await order('delivery_time');
    expect(byTime[0]).toBe(V.A.brandId);
    await expectStatus(
      await V.A.api.post('/food/vendor/busy', { extraMinutes: 45 }),
      200,
    );
    expect((await order('delivery_time'))[byTime.length - 1]).toBe(V.A.brandId);
    await expectStatus(
      await V.A.api.post('/food/vendor/busy', { extraMinutes: 0 }),
      200,
    );
    expect((await order('recommended'))[0]).toBe(V.A.brandId);
    const page1 = await expectStatus(
      await anon().get(
        `/food/vendors?lat=${MULTAN.lat}&lng=${MULTAN.lng}&pageSize=2&page=1`,
      ),
      200,
    );
    const page2 = await expectStatus(
      await anon().get(
        `/food/vendors?lat=${MULTAN.lat}&lng=${MULTAN.lng}&pageSize=2&page=2`,
      ),
      200,
    );
    expect(page1.total).toBe(4);
    const p1 = page1.items.map((c: any) => c.id);
    expect(
      page2.items.map((c: any) => c.id).filter((id: string) => p1.includes(id)),
    ).toEqual([]);
    expect((await anon().get('/food/vendors')).status).toBe(400);
  });

  it('"karahi" finds dishes grouped by the vendor that cooks them', async () => {
    const res = await expectStatus(
      await anon().get(
        `/food/search?q=karahi&lat=${MULTAN.lat}&lng=${MULTAN.lng}`,
      ),
      200,
    );
    const groups = res.dishes.filter((g: any) =>
      [V.A.brandId, V.C.brandId].includes(g.vendor.id),
    );
    expect(groups.map((g: any) => g.vendor.name).sort()).toEqual([
      'Multan Karahi Point',
      'Smash Lab',
    ]);
    const a = groups.find((g: any) => g.vendor.id === V.A.brandId);
    expect(a.items.map((i: any) => i.name).sort()).toEqual([
      'Chicken Karahi',
      'Mutton Karahi',
    ]);
    expect(a.items.find((i: any) => i.name === 'Mutton Karahi').fromPrice).toBe(
      2200,
    );
    expect(res.dishes.map((g: any) => g.vendor.id)).not.toContain(V.E.brandId);
  });

  it('vendor page: quote, pickup, menu; a paused vendor opens with its message; unknown or not live is 404 (QA #2)', async () => {
    const [slug] = (
      await sql(`SELECT slug FROM food_brands WHERE id = $1`, [V.A.brandId])
    ).map((r: any) => r.slug);
    const page = await expectStatus(
      await anon().get(
        `/food/vendors/${slug}?lat=${MULTAN.lat}&lng=${MULTAN.lng}`,
      ),
      200,
    );
    expect(page).toMatchObject({
      id: V.A.brandId,
      paused: false,
      delivery: { available: true, outOfZone: false, fee: 99, minOrder: 300 },
      pickup: { readyIn: { min: 20, max: 30 } },
      acceptsCod: true,
    });
    expect(page.menu.map((c: any) => c.name)).toEqual(['Mains']);
    expect(page.menu[0].items.map((i: any) => i.name).sort()).toEqual([
      'Chicken Karahi',
      'Mutton Karahi',
    ]);
    const far = await expectStatus(
      await anon().get(
        `/food/vendors/${slug}?lat=${KARACHI.lat}&lng=${KARACHI.lng}`,
      ),
      200,
    );
    expect(far.delivery).toMatchObject({ available: false, outOfZone: true });
    const noPoint = await expectStatus(
      await anon().get(`/food/vendors/${V.A.brandId}`),
      200,
    );
    expect(noPoint.delivery).toBeNull();

    const paused = await expectStatus(
      await anon().get(
        `/food/vendors/${V.F.brandId}?lat=${MULTAN.lat}&lng=${MULTAN.lng}`,
      ),
      200,
    );
    expect(paused).toMatchObject({
      paused: true,
      pauseMessage: 'Back after Jummah',
      openState: { open: false, paused: true },
    });
    expect((await anon().get(`/food/vendors/${V.G.brandId}`)).status).toBe(404);
    expect((await anon().get('/food/vendors/no-such-vendor')).status).toBe(404);

    const item = page.menu[0].items[0];
    const sheet = await expectStatus(
      await anon().get(`/food/items/${item.id}`),
      200,
    );
    expect(sheet).toMatchObject({
      id: item.id,
      available: true,
      variants: [],
      groups: [],
    });
    const [draftItem] = await sql(
      `SELECT id FROM menu_items WHERE brand_id = $1`,
      [V.G.brandId],
    );
    expect((await anon().get(`/food/items/${draftItem.id}`)).status).toBe(404);
  });

  it('home: sections from the same cards', async () => {
    const home = await expectStatus(
      await anon().get(`/food/home?lat=${MULTAN.lat}&lng=${MULTAN.lng}`),
      200,
    );
    expect(home.coverage).toMatchObject({ delivering: true, message: null });
    expect(home.cuisines.length).toBeGreaterThanOrEqual(18);
    const idsOf = (xs: any[]) => xs.map((c) => c.id);
    expect(idsOf(home.topRated)[0]).toBe(V.A.brandId);
    expect(idsOf(home.homeKitchens)).toEqual([V.B.brandId]);
    expect(idsOf(home.freeDelivery)).toContain(V.C.brandId);
    expect(idsOf(home.newOnFoodCourt)).toEqual(
      expect.arrayContaining([
        V.A.brandId,
        V.B.brandId,
        V.C.brandId,
        V.D.brandId,
      ]),
    );
    expect(idsOf(home.fastest)).not.toContain(V.D.brandId);
    expect(home.orderAgain).toEqual([]);
    expect(home.banners).toEqual([]);
  });
});
