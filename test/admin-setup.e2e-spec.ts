import request from 'supertest';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { totpCode } from './utils/admin';
import { signup, uniqueEmail } from './utils/factories';

const CODE = process.env.ADMIN_SETUP_CODE!;
const PASSWORD = 'First1SuperAdmin';
const CONSOLE = {
  Origin: process.env.ADMIN_WEB_ORIGIN!,
  'X-Requested-With': 'metromatrix-admin',
  'X-Client': 'admin-web',
};

/**
 * First run: the web console registers the first super admin with
 * ADMIN_SETUP_CODE, then enrols the authenticator as any admin does. Once a
 * super admin exists, registration is closed for good.
 *
 * The shared e2e database already holds other suites' super admins, so this
 * suite parks them (status `deleted`) for its run and restores them after.
 */
describe('Admin first-run setup (e2e)', () => {
  let t: TestApp;
  let parked: Array<{ id: string; was: string }> = [];

  beforeAll(async () => {
    t = await createTestApp();
    parked = await t.ds.query(
      `WITH p AS (
         SELECT id, status::text AS was FROM users
          WHERE role = 'super_admin' AND status <> 'deleted' FOR UPDATE)
       UPDATE users u SET status = 'deleted' FROM p WHERE u.id = p.id
       RETURNING p.id, p.was`,
    );
  });
  afterAll(async () => {
    for (const p of parked) {
      await t.ds.query(
        `UPDATE users SET status = $2::user_status WHERE id = $1`,
        [p.id, p.was],
      );
    }
    await t.close();
  });

  const setup = (body: Record<string, unknown>, api = new ApiClient(t.http)) =>
    api.post('/auth/admin/setup', body);
  const valid = () => ({
    setupCode: CODE,
    email: uniqueEmail('owner'),
    displayName: 'Platform Owner',
    password: PASSWORD,
  });

  it('GET reports that setup is needed and that a code is configured', async () => {
    const res = await new ApiClient(t.http)
      .get('/auth/admin/setup')
      .expect(200);
    expect(res.body.data).toEqual({
      setupRequired: true,
      setupCodeConfigured: true,
    });
  });

  it('a wrong code → 403 SETUP_CODE_INVALID, and nobody is created', async () => {
    const body = { ...valid(), setupCode: `${CODE}x` };
    const res = await setup(body).expect(403);
    expect(res.body.error.code).toBe('SETUP_CODE_INVALID');
    const rows = await t.ds.query(`SELECT 1 FROM users WHERE email = $1`, [
      body.email,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('guessing the code is throttled: 5 a minute per address', async () => {
    const api = new ApiClient(t.http);
    for (let i = 0; i < 5; i += 1) {
      await setup({ ...valid(), setupCode: `guess-${i}` }, api).expect(403);
    }
    await setup({ ...valid(), setupCode: 'guess-6' }, api).expect(429);
  });

  it('validates the body: weak password, bad email, short name → 400', async () => {
    for (const bad of [
      { password: 'password' },
      { password: 'Sh0rt' },
      { email: 'not-an-email' },
      { displayName: 'A' },
      { setupCode: undefined },
    ]) {
      const res = await setup({ ...valid(), ...bad }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it("an existing account's email → 409 EMAIL_EXISTS (it is not promoted)", async () => {
    const customer = await signup(t);
    const res = await setup({
      ...valid(),
      email: customer.email.toUpperCase(),
    }).expect(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
    const [row] = await t.ds.query(`SELECT role FROM users WHERE id = $1`, [
      customer.userId,
    ]);
    expect(row.role).toBe('customer');
  });

  it('registers the super admin, who enrols into a console session; then registration closes', async () => {
    const body = valid();
    const res = await setup(body).expect(200);
    expect(res.body.data).toEqual({
      totpRequired: true,
      enrolmentRequired: true,
      challengeToken: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);

    const [user] = await t.ds.query(
      `SELECT id, role, status, is_email_verified, totp_enabled, must_change_password, password_hash
         FROM users WHERE email = $1`,
      [body.email],
    );
    expect(user).toMatchObject({
      role: 'super_admin',
      status: 'active',
      is_email_verified: true,
      totp_enabled: false,
      must_change_password: false,
    });
    expect(user.password_hash).not.toContain(PASSWORD);

    // The challenge token is good for enrolment only — not for the API.
    const viaChallenge = new ApiClient(t.http);
    viaChallenge.token = res.body.data.challengeToken;
    await viaChallenge.get('/admin/businesses').expect(401);

    const enrol = await viaChallenge.post('/admin/me/totp/enrol').expect(200);
    const confirm = await request(t.http)
      .post('/api/v1/admin/me/totp/confirm')
      .set(CONSOLE)
      .set('X-Forwarded-For', new ApiClient(t.http).ip)
      .set('Authorization', `Bearer ${res.body.data.challengeToken}`)
      .send({ code: totpCode(enrol.body.data.secret) })
      .expect(200);
    expect(confirm.body.data.recoveryCodes).toHaveLength(10);
    expect(confirm.body.data.auth.tokens.refreshToken).toBeUndefined();
    expect(
      ([] as string[])
        .concat(confirm.headers['set-cookie'] ?? [])
        .some((c) => c.startsWith('mm_admin_rt=') && /httponly/i.test(c)),
    ).toBe(true);

    const api = new ApiClient(t.http);
    api.token = confirm.body.data.auth.tokens.accessToken;
    const me = await api.get('/auth/me').expect(200);
    expect(me.body.data.user).toMatchObject({
      id: user.id,
      role: 'super_admin',
      displayName: 'Platform Owner',
    });
    expect(me.body.data.admin).toMatchObject({
      isSuperAdmin: true,
      totpEnabled: true,
      mustChangePassword: false,
    });

    // Closed for good: the right code no longer opens it, and the console
    // is told to show sign-in.
    const again = await setup(valid()).expect(409);
    expect(again.body.error.code).toBe('SETUP_COMPLETE');
    const status = await new ApiClient(t.http)
      .get('/auth/admin/setup')
      .expect(200);
    expect(status.body.data).toEqual({
      setupRequired: false,
      setupCodeConfigured: true,
    });

    // One audit row, attributed to the new account, with no password in it.
    const rows = await t.ds.query(
      `SELECT * FROM operational_audit_events WHERE action = 'admin.setup' AND target_id = $1`,
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: user.id,
      target_type: 'user',
      before: null,
      after: {
        email: body.email,
        displayName: 'Platform Owner',
        role: 'super_admin',
      },
      request_id: res.headers['x-request-id'],
    });
    expect(JSON.stringify(rows[0])).not.toContain(PASSWORD);
  });

  it('two registrations at once create exactly one super admin', async () => {
    // Re-open setup by parking the one just created.
    const [created] = await t.ds.query(
      `UPDATE users SET status = 'deleted'
        WHERE role = 'super_admin' AND status <> 'deleted' RETURNING id`,
    );
    const results = await Promise.all([setup(valid()), setup(valid())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
      'SETUP_COMPLETE',
    );
    const [n] = await t.ds.query(
      `SELECT count(*)::int AS n FROM users WHERE role = 'super_admin' AND status <> 'deleted'`,
    );
    expect(n.n).toBe(1);
    await t.ds.query(`UPDATE users SET status = 'active' WHERE id = $1`, [
      created.id,
    ]);
  });
});
