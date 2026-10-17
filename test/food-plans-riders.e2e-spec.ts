import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, approvedPartner, shopper } from './utils/shopping';
import {
  expectStatus,
  foodVendor,
  riderClient,
  vendorRider,
} from './utils/food';
import { PlanService } from '../src/modules/plans/plans.service';
import { FoodVendorService } from '../src/modules/food/vendor/food-vendor.service';
import { Business } from '../src/modules/businesses/entities/business.entity';

describe('Food P0: rider accounts, plans, one brand and one branch (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('approval creates exactly one brand, one draft branch and the community plan', async () => {
    const v = await foodVendor(t, admin, 'home_kitchen', 'Ammi Ka Khana');
    const [brand] = await sql(
      `SELECT name, is_home_kitchen FROM food_brands WHERE id = $1`,
      [v.brandId],
    );
    expect(brand).toEqual({ name: 'Ammi Ka Khana', is_home_kitchen: true });
    const [branch] = await sql(
      `SELECT status, city, ST_Y(geo::geometry) AS lat FROM branches WHERE id = $1`,
      [v.branchId],
    );
    expect(branch).toMatchObject({ status: 'draft', city: 'Lahore' });
    expect(branch.lat).toBeCloseTo(31.520369, 5);

    const plan = await expectStatus(await v.api.get('/food/vendor/plan'), 200);
    expect(plan).toMatchObject({
      planKey: 'community',
      label: 'Community',
      priceMinorUnits: 0,
      expiresAt: null,
      limits: {
        brands: 1,
        branches: 1,
        riders: 25,
        menu_items: 1000,
        promotions_active: 10,
      },
      usage: { brands: 1, branches: 1, riders: 0 },
      entitlements: {
        riders: true,
        promotions: true,
        insights: true,
        preorders: true,
      },
    });
  });

  it('a second brand or branch is impossible: no route, unique per business, and the plan says 1', async () => {
    const v = await foodVendor(t, admin);
    expect(
      (await v.api.post('/food/vendor/brands', { name: 'Second' })).status,
    ).toBe(404);
    expect(
      (await v.api.post('/food/vendor/branches', { city: 'Karachi' })).status,
    ).toBe(404);
    await expect(
      sql(
        `INSERT INTO food_brands (business_id, name, slug) VALUES ($1, 'Two', 'two-${Date.now()}')`,
        [v.businessId],
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      sql(`INSERT INTO branches (business_id, brand_id) VALUES ($1, $2)`, [
        v.businessId,
        v.brandId,
      ]),
    ).rejects.toThrow(/duplicate key/);
    // Re-running the approval hook changes nothing.
    const vendors = t.app.get(FoodVendorService);
    const b = await t.ds.manager.findOneByOrFail(Business, {
      id: v.businessId,
    });
    await t.ds.transaction((m) => vendors.ensureForBusiness(m, b));
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM branches WHERE business_id = $1`,
      [v.businessId],
    );
    expect(n).toBe(1);
    const plans = t.app.get(PlanService);
    await expect(
      t.ds.transaction((m) =>
        plans.assertWithin(m, v.businessId, 'branches', 2),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PLAN_LIMIT_REACHED',
        details: { key: 'branches', limit: 1 },
      },
    });
  });

  it('a rider signs in on the partner portal with the username their vendor issued', async () => {
    const v = await foodVendor(t, admin, 'restaurant', 'Karahi House');
    const created = await expectStatus(
      await v.api.post('/food/vendor/riders', {
        fullName: 'Imran Alí Khan',
        phone: '03001234567',
      }),
      201,
    );
    expect(created.rider).toMatchObject({
      fullName: 'Imran Alí Khan',
      status: 'active',
      vehicle: 'bike',
    });
    expect(created.credential.username).toMatch(
      /^karahi-house[a-z0-9-]*\.imran$/,
    );
    expect(created.credential.password).toMatch(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10}$/,
    );
    const [user] = await sql(
      `SELECT email, role, is_email_verified FROM users WHERE username = $1`,
      [created.credential.username],
    );
    expect(user).toMatchObject({ role: 'rider', is_email_verified: true });
    expect(user.email).toMatch(/@riders\.metromatrix\.invalid$/);

    const { api, res } = await riderClient(
      t,
      created.credential.username,
      created.credential.password,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('rider');
    const me = await expectStatus(await api.get('/food/rider/me'), 200);
    expect(me).toMatchObject({
      rider: { username: created.credential.username },
      vendor: { id: v.brandId, name: 'Karahi House' },
    });

    // Wrong door, wrong password, wrong routes.
    const customerDoor = await new ApiClient(t.http).post('/auth/signin', {
      identifier: created.credential.username,
      password: created.credential.password,
      portal: 'customer',
    });
    expect([customerDoor.status, customerDoor.body.error.code]).toEqual([
      403,
      'WRONG_PORTAL',
    ]);
    const bad = await riderClient(t, created.credential.username, 'Wrong123x');
    expect([bad.res.status, bad.res.body.error.message]).toEqual([
      401,
      'Incorrect username or password.',
    ]);
    expect((await api.get('/food/vendor/plan')).status).toBe(403);
    // The username is retrievable; the password is not.
    const cred = await expectStatus(
      await v.api.get(`/food/vendor/riders/${created.rider.id}/credential`),
      200,
    );
    expect(cred).toMatchObject({
      username: created.credential.username,
      passwordAvailable: false,
    });
    // Another vendor can't see the rider.
    const other = await foodVendor(t, admin);
    expect(
      (await other.api.get(`/food/vendor/riders/${created.rider.id}`)).status,
    ).toBe(404);
    // Customers sign in with `identifier` too (an email).
    const s = await shopper(t);
    const [{ email }] = await sql(`SELECT email FROM users WHERE id = $1`, [
      s.userId,
    ]);
    const viaIdentifier = await new ApiClient(t.http).post('/auth/signin', {
      identifier: email,
      password: 'Secret123',
      portal: 'customer',
    });
    expect(viaIdentifier.status).toBe(200);
  });

  it('a password reset is shown once and ends every session of that rider', async () => {
    const v = await foodVendor(t, admin);
    const r = await vendorRider(t, v, 'Bilal Ahmed');
    await expectStatus(await r.api.get('/food/rider/me'), 200);
    const reset = await expectStatus(
      await v.api.post(`/food/vendor/riders/${r.rider.id}/reset-password`),
      200,
    );
    expect(reset.username).toBe(r.credential.username);
    expect((await r.api.get('/food/rider/me')).status).toBe(401);
    expect(
      (await riderClient(t, r.credential.username, r.credential.password)).res
        .status,
    ).toBe(401);
    expect(
      (await riderClient(t, reset.username, reset.password)).res.status,
    ).toBe(200);
  });

  it('a test plan with riders: 1 → PLAN_LIMIT_REACHED, seats locked (mid-delivery keeps it) and restored', async () => {
    const v = await foodVendor(t, admin);
    const older = await vendorRider(t, v, 'Asad One');
    const busy = await vendorRider(t, v, 'Kamran Two');
    await sql(`UPDATE riders SET active_order_count = 1 WHERE id = $1`, [
      busy.rider.id,
    ]);

    const lowered = await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
        overrides: { limits: { riders: 1 } },
      }),
      200,
    );
    expect(lowered).toMatchObject({
      limits: { riders: 1 },
      usage: { riders: 1 },
    });
    const statuses = await sql(
      `SELECT id, status FROM riders WHERE business_id = $1`,
      [v.businessId],
    );
    expect(
      Object.fromEntries(statuses.map((s: any) => [s.id, s.status])),
    ).toEqual({
      [older.rider.id]: 'plan_locked',
      [busy.rider.id]: 'active',
    });
    // The locked rider is signed out, and can't use the rider app after signing back in.
    expect((await older.api.get('/food/rider/me')).status).toBe(401);
    const again = await riderClient(
      t,
      older.credential.username,
      older.credential.password,
    );
    const locked = await again.api.get('/food/rider/me');
    expect([
      locked.status,
      locked.body.error.code,
      locked.body.error.details.status,
    ]).toEqual([403, 'RIDER_INACTIVE', 'plan_locked']);
    expect((await busy.api.get('/food/rider/me')).status).toBe(200);

    const third = await v.api.post('/food/vendor/riders', {
      fullName: 'Third Rider',
    });
    expect([third.status, third.body.error.code]).toEqual([
      409,
      'PLAN_LIMIT_REACHED',
    ]);
    expect(third.body.error.details).toMatchObject({
      key: 'riders',
      limit: 1,
      used: 1,
    });

    // Lifting the override restores the locked rider; every change is audited.
    const restored = await expectStatus(
      await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
        overrides: null,
      }),
      200,
    );
    expect(restored.limits.riders).toBe(25);
    const [{ status }] = await sql(`SELECT status FROM riders WHERE id = $1`, [
      older.rider.id,
    ]);
    expect(status).toBe('active');
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM operational_audit_events WHERE action = 'food.vendor.plan' AND target_id = $1`,
      [v.brandId],
    );
    expect(n).toBe(2);
    // Brands and branches can't be raised above 1 at launch.
    expect(
      (
        await admin.api.patch(`/admin/food/vendors/${v.brandId}/plan`, {
          overrides: { limits: { branches: 2 } },
        })
      ).status,
    ).toBe(400);
  });

  it('only food partners reach vendor routes; riders and customers are kept out', async () => {
    const doctor = await approvedPartner(t, admin, 'doctor');
    const res = await doctor.api.get('/food/vendor/plan');
    expect([res.status, res.body.error.code]).toEqual([403, 'WRONG_SERVICE']);
    const s = await shopper(t);
    expect((await s.api.get('/food/vendor/plan')).status).toBe(403);
    expect((await s.api.get('/food/rider/me')).status).toBe(403);
    expect(
      (
        await s.api.get(
          `/admin/food/vendors/00000000-0000-4000-8000-000000000000/plan`,
        )
      ).status,
    ).toBe(403);
  });
});
