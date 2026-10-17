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
