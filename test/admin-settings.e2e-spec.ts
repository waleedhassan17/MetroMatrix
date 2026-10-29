import request from 'supertest';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin, freshTotp, limitedAdmin } from './utils/admin';
import { PASSWORD, signup, uniqueEmail } from './utils/factories';
import { AiSettings } from '../src/modules/ai/ai-settings';

type Admin = Awaited<ReturnType<typeof enrolledAdmin>>;

/**
 * Super admin S7: platform settings, the public /config, and the server-side
 * kill switches (sign-ups, services, AI, maintenance).
 */
describe('Platform settings and kill switches (e2e)', () => {
  let t: TestApp;
  let root: Admin;

  beforeAll(async () => {
    t = await createTestApp();
    root = await enrolledAdmin(t);
  });
  afterEach(async () => {
    // Every test leaves the platform as it found it: all defaults.
    await t.ds.query(`DELETE FROM platform_settings`);
    await reloadSettings();
  });
  afterAll(() => t.close());

  /** The settings cache would otherwise hide a direct DELETE for 10 s. */
  const reloadSettings = async () => {
    const svc = t.app.get(
      (await import('../src/modules/platform/platform-settings.service'))
        .PlatformSettingsService,
    );
    (svc as unknown as { cache: null }).cache = null;
  };

  async function set(values: Record<string, unknown>) {
    const c = new ApiClient(t.http);
    c.token = root.api.token;
    return c.patch('/admin/settings', {
      values,
      totpCode: await freshTotp(t, root),
    });
  }

  it('GET /admin/settings: defaults, the schema, and nobody has changed anything', async () => {
    const res = await root.api.get('/admin/settings').expect(200);
    expect(res.body.data.values).toEqual({
      'signupsEnabled.customer': true,
      'signupsEnabled.partner': true,
      'services.shopping.enabled': true,
      'services.healthcare.enabled': true,
      'services.food.enabled': true,
      'services.kitchen.enabled': true,
      'ai.enabled': true,
      'maintenance.enabled': false,
      'maintenance.message': expect.any(String),
      'support.email': '',
    });
    expect(res.body.data.schema).toHaveLength(10);
    expect(res.body.data.lastChanged).toEqual({});
  });

  it('PATCH needs step-up, validates every key, and writes one audit row with before and after', async () => {
    const noCode = await root.api
      .patch('/admin/settings', { values: { 'ai.enabled': false } })
      .expect(403);
    expect(noCode.body.error.code).toBe('STEP_UP_REQUIRED');

    const bad = await set({
      'ai.enabled': 'no',
      'support.email': 'not-an-email',
      'nope.key': true,
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fields).sort()).toEqual([
      'ai.enabled',
      'nope.key',
      'support.email',
    ]);

    const ok = await set({
      'support.email': ' help@metromatrix.pk ',
      'maintenance.message': 'Back at 3 pm.',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.values['support.email']).toBe('help@metromatrix.pk');
    expect(ok.body.data.lastChanged['support.email']).toMatchObject({
      by: { id: root.userId, email: root.email },
    });
    const rows = await t.ds.query(
      `SELECT before, after FROM operational_audit_events
        WHERE action = 'settings.update' AND request_id = $1`,
      [ok.headers['x-request-id']],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].before['support.email']).toBe('');
    expect(rows[0].after).toEqual({
      'support.email': 'help@metromatrix.pk',
      'maintenance.message': 'Back at 3 pm.',
    });
  });

  it('a regular admin needs manageSettings', async () => {
    const other = await limitedAdmin(t, root, ['viewAudit']);
    await other.api.get('/admin/settings').expect(403);
    const holder = await limitedAdmin(t, root, ['manageSettings']);
    await holder.api.get('/admin/settings').expect(200);
  });

  it('GET /config is public, cacheable, and reflects the settings', async () => {
    const res = await request(t.http).get('/api/v1/config').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body.data).toEqual({
      signupsEnabled: { customer: true, partner: true },
      services: {
        shopping: { enabled: true },
        healthcare: { enabled: true },
        food: { enabled: true },
        kitchen: { enabled: true },
      },
      ai: { enabled: true },
      maintenance: { enabled: false, message: expect.any(String) },
      support: { email: null },
    });
    await set({ 'services.food.enabled': false });
    const after = await request(t.http).get('/api/v1/config').expect(200);
    expect(after.body.data.services.food.enabled).toBe(false);
  });

  it('sign-ups off → 403 SIGNUPS_PAUSED for that role only', async () => {
    await set({ 'signupsEnabled.customer': false });
    const blocked = await new ApiClient(t.http)
      .post('/auth/signup', {
        email: uniqueEmail(),
        password: PASSWORD,
        displayName: 'Blocked',
        role: 'customer',
      })
      .expect(403);
    expect(blocked.body.error).toMatchObject({
      code: 'SIGNUPS_PAUSED',
      details: { role: 'customer' },
    });
    await signup(t, { role: 'partner' });

    await set({ 'signupsEnabled.customer': true });
    await signup(t);
  });

  it('a paused service answers 503 SERVICE_PAUSED on its customer and partner routes only', async () => {
    const customer = await signup(t);
    await set({ 'services.shopping.enabled': false });
    const shop = await customer.api.get('/shop/products').expect(503);
    expect(shop.body.error).toMatchObject({
      code: 'SERVICE_PAUSED',
      details: { service: 'shopping' },
    });
    const partner = await customer.api.get('/shop/partner/products');
    expect(partner.status).toBe(503);
    // Other services and the admin side keep working.
    expect((await request(t.http).get('/api/v1/food/vendors')).status).not.toBe(
      503,
    );
    await root.api.get('/admin/shop/categories').expect(200);

    await set({
      'services.shopping.enabled': true,
      'services.healthcare.enabled': false,
    });
    await customer.api.get('/shop/products').expect(200);
    const health = await request(t.http)
      .get('/api/v1/health/doctors')
      .expect(503);
    expect(health.body.error.details.service).toBe('healthcare');
    // `/health` alone is the liveness check, never paused.
    await request(t.http).get('/api/v1/health').expect(200);
  });

  it('kitchen pauses the kitchen routes only; food pauses all of Food, kitchen included', async () => {
    const customer = await signup(t);
    await set({ 'services.kitchen.enabled': false });
    const k = await customer.api.get('/my-kitchen/pantry').expect(503);
    expect(k.body.error.details.service).toBe('kitchen');
    expect((await request(t.http).get('/api/v1/food/vendors')).status).not.toBe(
      503,
    );

    await set({
      'services.kitchen.enabled': true,
      'services.food.enabled': false,
    });
    const f = await request(t.http).get('/api/v1/food/vendors').expect(503);
    expect(f.body.error.details.service).toBe('food');
    const nutrition = await customer.api.get('/food/me/nutrition/profile');
    expect(nutrition.status).toBe(503);
    expect(nutrition.body.error.details.service).toBe('food');
  });

  it('ai.enabled off turns every AI feature off, like AI_ENABLED does', async () => {
    const ai = t.app.get(AiSettings);
    expect(ai.isOn('menu_assistant')).toBe(ai.enabled);
    await set({ 'ai.enabled': false });
    await t.app
      .get(
        (await import('../src/modules/platform/platform-settings.service'))
          .PlatformSettingsService,
      )
      .values();
    expect(ai.isOn('menu_assistant')).toBe(false);
  });

  it('maintenance → 503 MAINTENANCE except /auth/me, /config, /health, admin routes and admin sign-in', async () => {
    const customer = await signup(t);
    await set({
      'maintenance.enabled': true,
      'maintenance.message': 'Upgrading — back in 10 minutes.',
    });

    const blocked = await customer.api.get('/notifications').expect(503);
    expect(blocked.body.error).toMatchObject({
      code: 'MAINTENANCE',
      message: 'Upgrading — back in 10 minutes.',
    });
    await new ApiClient(t.http)
      .post('/auth/signin', {
        email: customer.email,
        password: PASSWORD,
        portal: 'customer',
      })
      .expect(503);
    await new ApiClient(t.http)
      .post('/auth/refresh-token', { refreshToken: customer.refreshToken })
      .expect(503);

    // Still working:
    await customer.api.get('/auth/me').expect(200);
    const cfg = await request(t.http).get('/api/v1/config').expect(200);
    expect(cfg.body.data.maintenance).toEqual({
      enabled: true,
      message: 'Upgrading — back in 10 minutes.',
    });
    await request(t.http).get('/api/v1/health').expect(200);
    await root.api.get('/admin/businesses').expect(200);
    // An admin can sign in and switch it off.
    const ch = await new ApiClient(t.http)
      .post('/auth/signin', {
        email: root.email,
        password: PASSWORD,
        portal: 'admin',
      })
      .expect(200);
    await new ApiClient(t.http)
      .post('/auth/admin/totp', {
        challengeToken: ch.body.data.challengeToken,
        code: await freshTotp(t, root),
      })
      .expect(200);
    const off = await set({ 'maintenance.enabled': false });
    expect(off.status).toBe(200);
    await customer.api.get('/notifications').expect(200);
  });
});
