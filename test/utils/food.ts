import { ApiClient, TestApp } from './test-app';
import { Admin, Partner, approvedPartner } from './shopping';

export type FoodKind = 'restaurant' | 'cloud_kitchen' | 'home_kitchen';
export type Vendor = Partner & { brandId: string; branchId: string };

/** An approved food partner and its auto-created brand + branch. */
export async function foodVendor(
  t: TestApp,
  admin: Admin,
  kind: FoodKind = 'restaurant',
  name?: string,
): Promise<Vendor> {
  const p = await approvedPartner(t, admin, kind, name);
  const [row] = await t.ds.query(
    `SELECT fb.id AS brand_id, br.id AS branch_id FROM food_brands fb
       JOIN branches br ON br.business_id = fb.business_id WHERE fb.business_id = $1`,
    [p.businessId],
  );
  if (!row) throw new Error('no brand/branch for the approved food business');
  return { ...p, brandId: row.brand_id, branchId: row.branch_id };
}

export async function expectStatus(
  res: { status: number; body: any },
  status: number,
) {
  if (res.status !== status)
    throw new Error(
      `expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`,
    );
  return res.body.data;
}

/** A rider's client, signed in on the partner portal with their username. */
export async function riderClient(
  t: TestApp,
  username: string,
  password: string,
) {
  const api = new ApiClient(t.http);
  const res = await api.post('/auth/signin', {
    identifier: username,
    password,
    portal: 'partner',
  });
  if (res.status === 200) api.token = res.body.data.tokens.accessToken;
  return { api, res };
}

/** A rider created by the vendor, signed in. */
export async function vendorRider(
  t: TestApp,
  v: Vendor,
  fullName = 'Imran Ali',
) {
  const created = await expectStatus(
    await v.api.post('/food/vendor/riders', {
      fullName,
      phone: '03001234567',
      vehicle: 'bike',
    }),
    201,
  );
  const { api } = await riderClient(
    t,
    created.credential.username,
    created.credential.password,
  );
  return { ...created, api };
}

export const LAHORE = { lat: 31.5204, lng: 74.3587 };
export const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

export async function cuisineIds(
  t: TestApp,
  ...slugs: string[]
): Promise<string[]> {
  const rows = await t.ds.query(
    `SELECT id, slug FROM cuisines WHERE slug = ANY($1::text[])`,
    [slugs],
  );
  return slugs.map((s) => rows.find((r: any) => r.slug === s).id);
}

/**
 * A vendor through setup: logo, cuisines, location (default Lahore), all-day
 * hours, two fee bands — then live (unless `goLive: false` or a home kitchen
 * without its food-safety check).
 */
export async function setUpVendor(
  t: TestApp,
  v: Vendor,
  opts: {
    cuisines?: string[];
    at?: { lat: number; lng: number };
    hours?: Array<{ weekday: number; opensAt: string; closesAt: string }>;
    bands?: Array<{
      fromKm: number;
      toKm: number;
      fee: number;
      minOrder: number;
    }>;
    settings?: Record<string, unknown>;
    goLive?: boolean;
    /** false = no menu (the "menu" setup item stays open). */
    menu?: boolean;
  } = {},
) {
  const { asset } = await import('./shopping');
  const logo = asset(v.userId, 'food_branding');
  await expectStatus(
    await v.api.patch('/food/vendor/profile', {
      logoUrl: logo.url,
      cuisineIds: await cuisineIds(
        t,
        ...(opts.cuisines ?? ['pakistani', 'karahi']),
      ),
      brandColor: '#B4532A',
    }),
    200,
  );
  const at = opts.at ?? LAHORE;
  await expectStatus(
    await v.api.patch('/food/vendor/settings', {
      addressLine: '12-B Main Boulevard',
      area: 'Gulberg III',
      city: 'Lahore',
      phone: '042 35761234',
      lat: at.lat,
      lng: at.lng,
      maxRadiusKm: 6,
      ...opts.settings,
    }),
    200,
  );
  await expectStatus(
    await v.api.put(
      '/food/vendor/hours',
      (opts.hours ??
        ALL_WEEK.map((weekday) => ({
          weekday,
          opensAt: '00:00',
          closesAt: '24:00',
        }))) as unknown as object,
    ),
    200,
  );
  await expectStatus(
    await v.api.put(
      '/food/vendor/fee-bands',
      (opts.bands ?? [
        { fromKm: 0, toKm: 3, fee: 99, minOrder: 300 },
        { fromKm: 3, toKm: 6, fee: 149, minOrder: 500 },
      ]) as unknown as object,
    ),
    200,
  );
  if (opts.menu !== false) {
    const cat = await expectStatus(
      await v.api.post('/food/vendor/menu/categories', { name: 'Mains' }),
      201,
    );
    const item = await expectStatus(
      await v.api.post('/food/vendor/menu/items', {
        categoryId: cat.id,
        name: 'Chicken Karahi',
        basePrice: 1600,
      }),
      201,
    );
    const setup = await expectStatus(
      await v.api.get('/food/vendor/setup'),
      200,
    );
    if (setup.subType === 'home_kitchen')
      await expectStatus(
        await v.api.patch('/food/vendor/today', {
          items: [{ itemId: item.id, portions: 20 }],
        }),
        200,
      );
  }
  if (opts.goLive !== false) return v.api.post('/food/vendor/go-live');
  return null;
}
