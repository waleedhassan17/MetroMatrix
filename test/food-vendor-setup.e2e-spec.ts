import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, asset, testIban } from './utils/shopping';
import {
  ALL_WEEK,
  LAHORE,
  cuisineIds,
  expectStatus,
  foodVendor,
  setUpVendor,
} from './utils/food';
import { VendorSettingsService } from '../src/modules/food/vendor/vendor-settings.service';
import { FoodVendorService } from '../src/modules/food/vendor/food-vendor.service';
import { ServiceabilityService } from '../src/modules/food/availability/serviceability.service';
import { BranchStateService } from '../src/modules/food/availability/branch-state.service';

/** A PKT wall time → instant (UTC+5, no DST). */
const pkt = (date: string, hhmm: string) =>
  new Date(`${date}T${hhmm}:00+05:00`);

describe('Food P1: vendor profile, settings, hours, zones, setup, go-live (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('profile: own-upload logo, 1–3 real cuisines, readable brand colour', async () => {
    const v = await foodVendor(t, admin, 'restaurant', 'Lahori Karahi House');
    const [pak, bbq] = await cuisineIds(t, 'pakistani', 'bbq');
    const logo = asset(v.userId, 'food_branding');
    const p = await expectStatus(
      await v.api.patch('/food/vendor/profile', {
        tagline: 'Charcoal karahi since 1998',
        logoUrl: logo.url,
        cuisineIds: [pak, bbq],
        priceLevel: 2,
        brandColor: '#7f1d1d',
      }),
      200,
    );
    expect(p).toMatchObject({
      name: 'Lahori Karahi House',
      brandColor: '#7F1D1D',
      onBrandColor: '#FFFFFF',
      cuisines: [{ slug: 'pakistani' }, { slug: 'bbq' }],
      subType: 'restaurant',
      branch: { status: 'draft', isLive: false },
    });
    const someoneElses = asset(
      '00000000-0000-4000-8000-000000000001',
      'food_branding',
    );
    expect(
      (await v.api.patch('/food/vendor/profile', { logoUrl: someoneElses.url }))
        .status,
    ).toBe(400);
    expect(
      (await v.api.patch('/food/vendor/profile', { brandColor: '#777777' }))
        .status,
    ).toBe(400);
    expect(
      (await v.api.patch('/food/vendor/profile', { cuisineIds: [v.brandId] }))
        .status,
    ).toBe(400);
    expect(
      (await v.api.patch('/food/vendor/profile', { priceLevel: 4 })).status,
    ).toBe(400);
  });

  it('settings: location pin, fulfilment, COD, auto-reject window; at least one way to get food', async () => {
    const v = await foodVendor(t, admin, 'cloud_kitchen');
    const s0 = await expectStatus(
      await v.api.get('/food/vendor/settings'),
      200,
    );
    expect(s0).toMatchObject({
      acceptsDelivery: true,
      acceptsPickup: false,
      autoRejectMinutes: 5,
      prepMinutes: 20,
    });
    const s = await expectStatus(
      await v.api.patch('/food/vendor/settings', {
        lat: 24.8138,
        lng: 67.0305,
        city: 'Karachi',
        codLimit: 5000,
        autoRejectMinutes: 7,
        maxRadiusKm: 4.5,
        freeDeliveryOver: 2500,
      }),
      200,
    );
    expect(s).toMatchObject({
      codLimit: 5000,
      autoRejectMinutes: 7,
      maxRadiusKm: 4.5,
      freeDeliveryOver: 2500,
    });
    expect(s.location).toMatchObject({
      lat: 24.8138,
      lng: 67.0305,
      city: 'Karachi',
    });
    expect(
      (await v.api.patch('/food/vendor/settings', { acceptsDelivery: false }))
        .status,
    ).toBe(400);
    expect(
      (await v.api.patch('/food/vendor/settings', { autoRejectMinutes: 11 }))
        .status,
    ).toBe(400);
    expect(
      (await v.api.patch('/food/vendor/settings', { lat: 24.8 })).status,
    ).toBe(400);
    expect(
      (await v.api.patch('/food/vendor/settings', { preorderOnly: true }))
        .status,
    ).toBe(400);
  });

  it('hours: 18:00–02:00 is open at 01:00 and closed at 03:00; lunch + dinner ranges; overlaps refused', async () => {
    const v = await foodVendor(t, admin);
    const vendors = t.app.get(FoodVendorService);
    const settings = t.app.get(VendorSettingsService);
    const ref = await vendors.ensureForBusinessId(v.businessId);
    await expectStatus(
      await v.api.put(
        '/food/vendor/hours',
        ALL_WEEK.map((weekday) => ({
          weekday,
          opensAt: '18:00',
          closesAt: '02:00',
        })),
      ),
      200,
    );
    const hours = await expectStatus(
      await v.api.get('/food/vendor/hours'),
      200,
    );
    expect(hours[0]).toEqual({
      weekday: 0,
      opensAt: '18:00',
      closesAt: '02:00',
      overnight: true,
    });
    expect(
      (await settings.profile(ref, pkt('2026-10-16', '01:00'))).branch
        .openState,
    ).toMatchObject({
      open: true,
      label: 'Open until 2:00 AM',
    });
    expect(
      (await settings.profile(ref, pkt('2026-10-16', '03:00'))).branch
        .openState,
    ).toMatchObject({
      open: false,
      label: 'Opens 6:00 PM',
    });

    await expectStatus(
      await v.api.put(
        '/food/vendor/hours',
        ALL_WEEK.flatMap((weekday) => [
          { weekday, opensAt: '12:00', closesAt: '15:00' },
          { weekday, opensAt: '19:00', closesAt: '23:00' },
        ]),
      ),
      200,
    );
    expect(
      (await settings.profile(ref, pkt('2026-10-16', '13:30'))).branch.openState
        .label,
    ).toBe('Open until 3:00 PM');
    expect(
      (await settings.profile(ref, pkt('2026-10-16', '16:00'))).branch.openState
        .label,
    ).toBe('Opens 7:00 PM');

    const overlap = await v.api.put('/food/vendor/hours', [
      { weekday: 5, opensAt: '20:00', closesAt: '03:00' },
      { weekday: 6, opensAt: '02:00', closesAt: '05:00' },
    ]);
    expect([overlap.status, overlap.body.error.code]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    expect(overlap.body.error.details.conflict).toHaveLength(2);
    expect(
      (
        await v.api.put('/food/vendor/hours', [
          { weekday: 1, opensAt: '25:00', closesAt: '26:00' },
        ])
      ).status,
    ).toBe(400);
  });

  it('closures, pause and busy change the open state and the ETA', async () => {
    const v = await foodVendor(t, admin);
    await setUpVendor(t, v);
    const now = new Date();
    const closure = await expectStatus(
      await v.api.post('/food/vendor/closures', {
        startsAt: new Date(now.getTime() - 60_000).toISOString(),
        endsAt: new Date(now.getTime() + 2 * 3600_000).toISOString(),
        reason: 'Family event',
      }),
      201,
    );
    let p = await expectStatus(await v.api.get('/food/vendor/profile'), 200);
    expect(p.branch.openState.open).toBe(false);
    await expectStatus(
      await v.api.delete(`/food/vendor/closures/${closure.id}`),
      200,
    );
    p = await expectStatus(await v.api.get('/food/vendor/profile'), 200);
    expect(p.branch.openState.open).toBe(true);

    p = await expectStatus(
      await v.api.post('/food/vendor/pause', { message: 'Back after Maghrib' }),
      200,
    );
    expect(p.branch).toMatchObject({
      isPaused: true,
      openState: { open: false, paused: true, label: 'Back after Maghrib' },
    });
    p = await expectStatus(await v.api.post('/food/vendor/resume'), 200);
    expect(p.branch.isPaused).toBe(false);

    p = await expectStatus(
      await v.api.post('/food/vendor/busy', { extraMinutes: 15 }),
      200,
    );
    expect(p.branch.busy).toMatchObject({ extraMinutes: 15 });
    const serviceability = t.app.get(ServiceabilityService);
    const state = t.app.get(BranchStateService);
    const row = (await serviceability.branch(v.branchId, {
      lat: LAHORE.lat + 0.01,
      lng: LAHORE.lng,
    }))!;
    const s = (await state.schedules([v.branchId])).get(v.branchId)!;
    const busyQuote = serviceability.quote(row, s, 'delivery');
    await expectStatus(
      await v.api.post('/food/vendor/busy', { extraMinutes: 0 }),
      200,
    );
    const calm = serviceability.quote(
      (await serviceability.branch(v.branchId, {
        lat: LAHORE.lat + 0.01,
        lng: LAHORE.lng,
      }))!,
      s,
      'delivery',
    );
    expect(busyQuote.eta.min - calm.eta.min).toBe(15);
    expect(
      (
        await v.api.post('/food/vendor/busy', {
          extraMinutes: 20,
          until: new Date(now.getTime() + 7 * 3600_000).toISOString(),
        })
      ).status,
    ).toBe(400);
  });

  it('fee bands apply by distance (PostGIS), free over the threshold; bands must follow on from 0 km', async () => {
    const v = await foodVendor(t, admin);
    await setUpVendor(t, v, {
      bands: [
        { fromKm: 0, toKm: 2, fee: 80, minOrder: 400 },
        { fromKm: 2, toKm: 4, fee: 120, minOrder: 600 },
        { fromKm: 4, toKm: 6, fee: 180, minOrder: 900 },
      ],
      settings: { freeDeliveryOver: 3000 },
    });
    const serviceability = t.app.get(ServiceabilityService);
    const state = t.app.get(BranchStateService);
    const s = (await state.schedules([v.branchId])).get(v.branchId)!;
    // ~0.009° latitude ≈ 1 km.
    const at = async (km: number, subtotal?: number) =>
      serviceability.quote(
        (await serviceability.branch(v.branchId, {
          lat: LAHORE.lat + 0.009 * km,
          lng: LAHORE.lng,
        }))!,
        s,
        'delivery',
        { subtotal },
      );
    expect(await at(1)).toMatchObject({
      serviceable: true,
      deliveryFee: 80,
      minOrder: 400,
    });
    expect(await at(3)).toMatchObject({ deliveryFee: 120, minOrder: 600 });
    const far = await at(5);
    expect(far).toMatchObject({ deliveryFee: 180, minOrder: 900 });
    expect(far.distanceKm).toBeCloseTo(5, 0);
    expect(far.eta.min).toBe(20 + Math.ceil((far.distanceKm! / 22) * 60) + 5);
    expect((await at(5, 3000)).deliveryFee).toBe(0);
    expect((await at(7)).serviceable).toBe(false);

    const gap = await v.api.put('/food/vendor/fee-bands', [
      { fromKm: 0, toKm: 2, fee: 80, minOrder: 0 },
      { fromKm: 3, toKm: 5, fee: 100, minOrder: 0 },
    ]);
    expect(gap.status).toBe(400);
    expect(
      (
        await v.api.put('/food/vendor/fee-bands', [
          { fromKm: 1, toKm: 2, fee: 80, minOrder: 0 },
        ])
      ).status,
    ).toBe(400);
  });

  it('setup checklist by kind; go-live needs it complete; the session says the vendor is live', async () => {
    const v = await foodVendor(t, admin, 'restaurant');
    const before = await expectStatus(
      await v.api.get('/food/vendor/setup'),
      200,
    );
    expect(before).toMatchObject({
      subType: 'restaurant',
      ready: false,
      isLive: false,
    });
    expect(before.items.map((i: any) => i.key)).toEqual(
      expect.arrayContaining([
        'profile',
        'location',
        'hours',
        'zones',
        'payment',
      ]),
    );
    expect(before.items.map((i: any) => i.key)).not.toContain('food_safety');
    const early = await v.api.post('/food/vendor/go-live');
    expect([early.status, early.body.error.code]).toEqual([
      422,
      'PROFILE_INCOMPLETE',
    ]);
    expect(early.body.error.details.missing).toEqual(
      expect.arrayContaining(['profile', 'hours', 'zones']),
    );

    const live = await setUpVendor(t, v);
    expect(live!.status).toBe(200);
    expect(live!.body.data).toMatchObject({
      ready: true,
      isLive: true,
      percent: 100,
    });
    const me = await expectStatus(await v.api.get('/auth/me'), 200);
    expect(me.business.food).toMatchObject({
      brandId: v.brandId,
      isLive: true,
      setupComplete: true,
      branchStatus: 'active',
    });
    // Delivery off: zones are no longer required.
    const pickupOnly = await foodVendor(t, admin);
    await expectStatus(
      await pickupOnly.api.patch('/food/vendor/settings', {
        acceptsDelivery: false,
        acceptsPickup: true,
      }),
      200,
    );
    const s = await expectStatus(
      await pickupOnly.api.get('/food/vendor/setup'),
      200,
    );
    expect(s.items.find((i: any) => i.key === 'zones')).toMatchObject({
      required: false,
    });
  });

  it('a home kitchen cannot go live without MetroMatrix’s food-safety check (QA #25)', async () => {
    const v = await foodVendor(t, admin, 'home_kitchen');
    const blocked = await setUpVendor(t, v);
    expect([blocked!.status, blocked!.body.error.code]).toEqual([
      422,
      'FOOD_SAFETY_CHECK_REQUIRED',
    ]);
    const failed = await expectStatus(
      await admin.api.post(
        `/admin/food/branches/${v.branchId}/food-safety-check`,
        { outcome: 'failed', note: 'Re-test next week' },
      ),
      200,
    );
    expect(failed.foodSafetyCheckedAt).toBeNull();
    expect((await v.api.post('/food/vendor/go-live')).body.error.code).toBe(
      'FOOD_SAFETY_CHECK_REQUIRED',
    );
    await expectStatus(
      await admin.api.post(
        `/admin/food/branches/${v.branchId}/food-safety-check`,
        { outcome: 'passed', note: 'Test order: clean and sealed' },
      ),
      200,
    );
    const live = await expectStatus(
      await v.api.post('/food/vendor/go-live'),
      200,
    );
    expect(live.isLive).toBe(true);
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM operational_audit_events WHERE action = 'food.branch.food_safety' AND target_id = $1`,
      [v.branchId],
    );
    expect(n).toBe(2);
    // Home kitchens may switch to pre-order only.
    await expectStatus(
      await v.api.patch('/food/vendor/settings', { preorderOnly: true }),
      200,
    );
    expect(
      (
        await v.api.post(
          `/admin/food/branches/${v.branchId}/food-safety-check`,
          { outcome: 'passed', note: 'x' },
        )
      ).status,
    ).toBe(403);
  });

  it('payment accounts: validated, at most 4 active, scoped to the vendor', async () => {
    const v = await foodVendor(t, admin);
    const iban = testIban();
    const a = await expectStatus(
      await v.api.post('/food/vendor/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Karahi House',
        accountNumber: iban,
        bankName: 'HBL',
      }),
      201,
    );
    expect(a).toMatchObject({
      kind: 'bank',
      accountNumber: iban,
      isActive: true,
    });
    expect(
      (
        await v.api.post('/food/vendor/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Dup',
          accountNumber: iban,
          bankName: 'HBL',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await v.api.post('/food/vendor/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Dup',
          accountNumber: 'PK00BAD',
          bankName: 'HBL',
        })
      ).status,
    ).toBe(400);
    await expectStatus(
      await v.api.post('/food/vendor/payment-accounts', {
        kind: 'jazzcash',
        accountTitle: 'Karahi House',
        accountNumber: '03001234567',
      }),
      201,
    );
    const other = await foodVendor(t, admin);
    expect(
      (await other.api.delete(`/food/vendor/payment-accounts/${a.id}`)).status,
    ).toBe(404);
    const list = await expectStatus(
      await v.api.get('/food/vendor/payment-accounts'),
      200,
    );
    expect(list).toHaveLength(2);
  });
});
