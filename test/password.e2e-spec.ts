import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { PASSWORD, signin, signup, uniqueEmail } from './utils/factories';
import { emailsTo, lastOtpFor } from './utils/outbox';

describe('Password reset, change, account deletion (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const NEW_PASSWORD = 'Brand9NewPass';

  it('forgot-password answers identically for unknown and known emails', async () => {
    const u = await signup(t);
    const known = await new ApiClient(t.http)
      .post('/auth/forgot-password', { email: u.email })
      .expect(200);
    const unknown = await new ApiClient(t.http)
      .post('/auth/forgot-password', { email: uniqueEmail('ghost') })
      .expect(200);
    expect(known.body).toEqual({ success: true, data: { delivered: true } });
    expect(unknown.body).toEqual(known.body);
    expect(emailsTo(u.email).map((e) => e.subject)).toContain(
      'Your MetroMatrix password reset code',
    );
  });

  it('full reset: code → reset token → new password; every old session dies', async () => {
    const u = await signup(t);
    const { api: tablet } = await signin(t, u.email, 'customer');
    const anon = new ApiClient(t.http);

    await anon.post('/auth/forgot-password', { email: u.email }).expect(200);
    const otp = lastOtpFor(u.email);

    const wrong = await anon
      .post('/auth/verify-otp', {
        email: u.email,
        otp: otp === '000000' ? '111111' : '000000',
      })
      .expect(400);
    expect(wrong.body.error.code).toBe('OTP_INVALID');

    const verified = await anon
      .post('/auth/verify-otp', { email: u.email, otp })
      .expect(200);
    const { resetToken } = verified.body.data;
    expect(resetToken).toEqual(expect.any(String));

    const reset = await anon
      .post('/auth/reset-password', { resetToken, password: NEW_PASSWORD })
      .expect(200);
    expect(reset.body).toEqual({ success: true, data: { reset: true } });

    // Old refresh token, old access tokens on both devices: all dead.
    await anon
      .post('/auth/refresh-token', { refreshToken: u.refreshToken })
      .expect(401);
    const me = await u.api.get('/auth/me').expect(401);
    expect(me.body.error.code).toBe('TOKEN_REVOKED');
    await tablet.get('/auth/me').expect(401);

    // The reset token is single-use.
    const again = await anon
      .post('/auth/reset-password', { resetToken, password: 'Another1Pass' })
      .expect(400);
    expect(again.body.error.code).toBe('OTP_INVALID');

    const old = await signin(t, u.email, 'customer', PASSWORD);
    expect(old.res.status).toBe(401);
    const fresh = await signin(t, u.email, 'customer', NEW_PASSWORD);
    expect(fresh.res.status).toBe(200);
    await fresh.api.get('/auth/me').expect(200);
  });

  it('a weak new password is rejected before the token is spent', async () => {
    const u = await signup(t);
    const anon = new ApiClient(t.http);
    await anon.post('/auth/forgot-password', { email: u.email }).expect(200);
    const res = await anon
      .post('/auth/verify-otp', { email: u.email, otp: lastOtpFor(u.email) })
      .expect(200);
    const weak = await anon
      .post('/auth/reset-password', {
        resetToken: res.body.data.resetToken,
        password: 'short',
      })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    expect(weak.body.error.details.fields.password).toBeDefined();
  });

  it('change-password: wrong current is 403; success signs out other devices but not this one', async () => {
    const u = await signup(t);
    const { api: tablet, res } = await signin(t, u.email, 'customer');
    const tabletRefresh = res.body.data.tokens.refreshToken;

    const bad = await u.api
      .post('/auth/change-password', {
        currentPassword: 'Wrong1234',
        newPassword: NEW_PASSWORD,
      })
      .expect(403);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');

    await u.api
      .post('/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);

    await u.api.get('/auth/me').expect(200);
    await u.api
      .post('/auth/refresh-token', { refreshToken: u.refreshToken })
      .expect(200);
    await tablet
      .post('/auth/refresh-token', { refreshToken: tabletRefresh })
      .expect(401);

    expect(
      (await signin(t, u.email, 'customer', NEW_PASSWORD)).res.status,
    ).toBe(200);
  });

  it('delete account: wrong password refused; then anonymised, signed out, email reusable', async () => {
    const u = await signup(t, { phone: '03001234567' });

    const bad = await u.api
      .delete('/auth/account', { password: 'Wrong1234' })
      .expect(403);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');

    const ok = await u.api
      .delete('/auth/account', { password: PASSWORD })
      .expect(200);
    expect(ok.body).toEqual({ success: true, data: { deleted: true } });

    await u.api.get('/auth/me').expect(401);
    await u.api
      .post('/auth/refresh-token', { refreshToken: u.refreshToken })
      .expect(401);
    const login = await signin(t, u.email, 'customer');
    expect(login.res.status).toBe(401);
    expect(login.res.body.error.code).toBe('INVALID_CREDENTIALS');

    const [row] = await t.ds.query(
      `SELECT email, phone, display_name, password_hash, status, deleted_at FROM users WHERE id = $1`,
      [u.userId],
    );
    expect(row).toMatchObject({
      email: `deleted+${u.userId}@deleted.metromatrix`,
      phone: null,
      display_name: null,
      password_hash: null,
      status: 'deleted',
    });
    expect(row.deleted_at).not.toBeNull();

    // The address is free again.
    const again = await signup(t, { email: u.email });
    expect(again.userId).not.toBe(u.userId);
  });
});
