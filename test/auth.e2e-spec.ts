import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import {
  PASSWORD,
  sha256,
  signin,
  signup,
  uniqueEmail,
} from './utils/factories';

describe('Auth core (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const backdateRevocation = (refreshToken: string, seconds: number) =>
    t.ds.query(
      `UPDATE refresh_tokens SET revoked_at = revoked_at - make_interval(secs => $2)
        WHERE token_hash = $1`,
      [sha256(refreshToken), seconds],
    );

  it('signup → me → refresh returns the AuthResult contract', async () => {
    const api = new ApiClient(t.http);
    const email = uniqueEmail();
    const res = await api
      .post('/auth/signup', {
        email,
        password: PASSWORD,
        displayName: 'Ayesha Khan',
        role: 'customer',
        phone: '0312 4890176',
      })
      .expect(201);

    expect(res.body).toEqual({
      success: true,
      data: {
        user: {
          id: expect.any(String),
          email,
          displayName: 'Ayesha Khan',
          role: 'customer',
          phone: '+923124890176',
          avatarUrl: null,
          isEmailVerified: false,
          hasPassword: true,
        },
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresIn: 900,
        },
        business: null,
      },
    });

    api.token = res.body.data.tokens.accessToken;
    const me = await api.get('/auth/me').expect(200);
    expect(me.body.data).toEqual({ user: res.body.data.user, business: null });

    const r = await api
      .post('/auth/refresh-token', {
        refreshToken: res.body.data.tokens.refreshToken,
      })
      .expect(200);
    expect(r.body.data).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 900,
    });
    expect(r.body.data.refreshToken).not.toBe(
      res.body.data.tokens.refreshToken,
    );

    api.token = r.body.data.accessToken;
    await api.get('/auth/me').expect(200);
  });

  it('rotation: a reused refresh token inside the grace window still works; outside it kills the family', async () => {
    const u = await signup(t);
    const r0 = u.refreshToken;

    const first = await u.api
      .post('/auth/refresh-token', { refreshToken: r0 })
      .expect(200);
    const r1 = first.body.data.refreshToken;

    // Two tabs refreshing at once: the second presentation of r0 is honoured.
    const graced = await u.api
      .post('/auth/refresh-token', { refreshToken: r0 })
      .expect(200);
    const r2 = graced.body.data.refreshToken;
    expect(r2).not.toBe(r1);

    // Past the 10 s grace, presenting r0 again is theft.
    await backdateRevocation(r0, 11);
    const reused = await u.api
      .post('/auth/refresh-token', { refreshToken: r0 })
      .expect(401);
    expect(reused.body.error.code).toBe('REFRESH_REUSED');

    // …and every token of the family is dead, including the newest ones.
    for (const tok of [r1, r2]) {
      const res = await u.api
        .post('/auth/refresh-token', { refreshToken: tok })
        .expect(401);
      expect(res.body.error.code).toBe('REFRESH_REUSED');
    }

    const audit = await t.ds.query(
      `SELECT action FROM operational_audit_events WHERE target_id = $1 AND action = 'auth.refresh_reused'`,
      [u.userId],
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('an unknown refresh token is REFRESH_INVALID', async () => {
    const res = await new ApiClient(t.http)
      .post('/auth/refresh-token', { refreshToken: 'not-a-real-token' })
      .expect(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });

  it('logout signs out this device only: its access token → TOKEN_REVOKED, the other device carries on', async () => {
    const phone = await signup(t);
    const { api: tablet } = await signin(t, phone.email, 'customer');

    const out = await phone.api.post('/auth/logout').expect(200);
    expect(out.body).toEqual({ success: true, data: { signedOut: true } });

    const me = await phone.api.get('/auth/me').expect(401);
    expect(me.body.error.code).toBe('TOKEN_REVOKED');
    const refresh = await phone.api
      .post('/auth/refresh-token', { refreshToken: phone.refreshToken })
      .expect(401);
    expect(refresh.body.error.code).toBe('REFRESH_REUSED');

    await tablet.get('/auth/me').expect(200);

    // Idempotent: again, via the alias, and with no token at all.
    await phone.api.post('/auth/signout').expect(200);
    await new ApiClient(t.http).post('/auth/logout').expect(200);
  });

  it('a partner on the customer portal is refused with WRONG_PORTAL naming the partner portal', async () => {
    const partner = await signup(t, { role: 'partner' });
    const { res } = await signin(t, partner.email, 'customer');
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: 'WRONG_PORTAL',
      message: expect.stringMatching(/partner portal/),
      details: { accountType: 'partner', portal: 'customer' },
    });
    expect(res.body.data).toBeUndefined();

    const ok = await signin(t, partner.email, 'partner');
    expect(ok.res.status).toBe(200);
    expect(ok.res.body.data.user.role).toBe('partner');
  });

  it('a customer on the admin portal is WRONG_PORTAL — no TOTP challenge is issued', async () => {
    const customer = await signup(t);
    const { res } = await signin(t, customer.email, 'admin');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WRONG_PORTAL');
  });

  it('the same email in any case is EMAIL_EXISTS', async () => {
    const u = await signup(t);
    const res = await new ApiClient(t.http)
      .post('/auth/signup', {
        email: u.email.toUpperCase(),
        password: PASSWORD,
        displayName: 'Again',
        role: 'customer',
      })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('wrong password and unknown email get the identical 401', async () => {
    const u = await signup(t);
    const wrong = await signin(t, u.email, 'customer', 'Wrong1234');
    const unknown = await signin(t, uniqueEmail('nobody'), 'customer');
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.body).toEqual(unknown.res.body);
    expect(wrong.res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('protected routes need a bearer token', async () => {
    const res = await new ApiClient(t.http).get('/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
