import request from 'supertest';
import { createTestApp, TestApp } from './utils/test-app';
import { sha256, signup } from './utils/factories';
import { emailsTo, lastEmailTo, lastVerifyTokenFor } from './utils/outbox';

describe('Email verification by link (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** The API's own page, as a mail client's browser opens it (no bearer). */
  const openPage = (token?: string) =>
    request(t.http)
      .get('/api/v1/auth/verify')
      .query(token === undefined ? {} : { token });

  /** Pretend the latest link was sent `seconds` ago. */
  const ageLatestLink = (userId: string, seconds: number) =>
    t.ds.query(
      `UPDATE email_verification_tokens
          SET created_at = created_at - make_interval(secs => $2),
              expires_at = expires_at - make_interval(secs => $2)
        WHERE id = (SELECT id FROM email_verification_tokens WHERE user_id = $1
                     ORDER BY created_at DESC LIMIT 1)`,
      [userId, seconds],
    );

  const isVerified = async (userId: string) =>
    (
      await t.ds.query('SELECT is_email_verified FROM users WHERE id = $1', [
        userId,
      ])
    )[0].is_email_verified as boolean;

  it('signup emails a link (web page + app link, HTML and text); only the hash is stored', async () => {
    const u = await signup(t);
    const email = lastEmailTo(u.email)!;
    expect(email.subject).toBe('Verify your MetroMatrix email');
    const token = lastVerifyTokenFor(u.email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(email.text).toContain(
      `http://localhost:3000/api/v1/auth/verify?token=${token}`,
    );
    expect(email.text).toContain(`metromatrix://verify-email?token=${token}`);
    expect(email.html).toContain('Verify email');
    expect(email.html).toContain('Open in the app');
    expect(email.html).toContain('24 hours');

    const rows = await t.ds.query(
      `SELECT token_hash, used_at FROM email_verification_tokens WHERE user_id = $1`,
      [u.userId],
    );
    expect(rows).toEqual([{ token_hash: sha256(token), used_at: null }]);
    // Nothing goes to the retired OTP table any more.
    const otps = await t.ds.query(
      'SELECT 1 FROM email_verification_otps WHERE user_id = $1',
      [u.userId],
    );
    expect(otps).toHaveLength(0);
  });

  it('GET /auth/verify verifies and answers a locked-down HTML page whose app button carries no token', async () => {
    const u = await signup(t);
    const token = lastVerifyTokenFor(u.email);
    const res = await openPage(token).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.text).toContain('Email verified');
    expect(res.text).toContain('metromatrix://verify-email?verified=1');
    expect(res.text).not.toContain(token);
    expect(res.text).not.toMatch(/<script/i);
    expect(await isVerified(u.userId)).toBe(true);

    const me = await u.api.get('/auth/me').expect(200);
    expect(me.body.data.user.isEmailVerified).toBe(true);
  });

  it("POST /auth/verify-email spends the app link's token without a session and returns the owner's account", async () => {
    const u = await signup(t);
    const token = lastVerifyTokenFor(u.email);
    u.api.token = undefined;
    const res = await u.api.post('/auth/verify-email', { token }).expect(200);
    expect(res.body.data.user).toMatchObject({
      id: u.userId,
      isEmailVerified: true,
    });
    expect(res.body.data).toHaveProperty('business');
    expect(res.body.data).not.toHaveProperty('tokens');
  });

  it('a spent link for a verified owner is a success (mail scanners, double taps), on both doors', async () => {
    const u = await signup(t);
    const token = lastVerifyTokenFor(u.email);
    await openPage(token).expect(200);

    const again = await openPage(token).expect(200);
    expect(again.text).toContain('already verified');
    await u.api.post('/auth/verify-email', { token }).expect(200);
  });

  it('an unknown, missing or over-long token is VERIFY_LINK_INVALID (400 page, 400 JSON)', async () => {
    const page = await openPage('not-a-real-token').expect(400);
    expect(page.text).toContain('expired or been replaced');
    expect(page.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    await openPage().expect(400);
    await openPage('x'.repeat(500)).expect(400);

    const api = (await signup(t)).api;
    const res = await api
      .post('/auth/verify-email', { token: 'not-a-real-token' })
      .expect(400);
    expect(res.body.error).toEqual({
      code: 'VERIFY_LINK_INVALID',
      message: expect.any(String),
    });
    const empty = await api.post('/auth/verify-email', {}).expect(400);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('an expired link fails while the address is unverified', async () => {
    const u = await signup(t);
    const token = lastVerifyTokenFor(u.email);
    await ageLatestLink(u.userId, 25 * 3600);
    const res = await u.api.post('/auth/verify-email', { token }).expect(400);
    expect(res.body.error.code).toBe('VERIFY_LINK_INVALID');
    await openPage(token).expect(400);
    expect(await isVerified(u.userId)).toBe(false);
  });

  it('resend inside 60 s → 429 RESEND_COOLDOWN with retryAfter, nothing sent', async () => {
    const u = await signup(t);
    const res = await u.api.post('/auth/resend-verification').expect(429);
    expect(res.body.error.code).toBe('RESEND_COOLDOWN');
    expect(res.body.error.details.retryAfter).toBeGreaterThan(0);
    expect(res.body.error.details.retryAfter).toBeLessThanOrEqual(60);
    expect(emailsTo(u.email)).toHaveLength(1);
  });

  it('a resend retires the old link; the new one verifies; then resend says alreadyVerified', async () => {
    const u = await signup(t);
    const first = lastVerifyTokenFor(u.email);
    await ageLatestLink(u.userId, 61);
    const resent = await u.api.post('/auth/resend-verification').expect(200);
    expect(resent.body.data).toEqual({
      sent: true,
      alreadyVerified: false,
      retryAfter: 60,
    });
    const second = lastVerifyTokenFor(u.email);
    expect(second).not.toBe(first);

    const old = await u.api
      .post('/auth/verify-email', { token: first })
      .expect(400);
    expect(old.body.error.code).toBe('VERIFY_LINK_INVALID');
    await u.api.post('/auth/verify-email', { token: second }).expect(200);

    // The retired link now belongs to a verified owner: a success.
    await u.api.post('/auth/verify-email', { token: first }).expect(200);
    const after = await u.api.post('/auth/resend-verification').expect(200);
    expect(after.body.data).toEqual({
      sent: false,
      alreadyVerified: true,
      retryAfter: 0,
    });
  });

  it('two opens of the same link at once verify once and both succeed', async () => {
    const u = await signup(t);
    const token = lastVerifyTokenFor(u.email);
    const [a, b] = await Promise.all([
      u.api.post('/auth/verify-email', { token }),
      openPage(token),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const audits = await t.ds.query(
      `SELECT 1 FROM operational_audit_events WHERE action = 'auth.email_verified' AND target_id = $1`,
      [u.userId],
    );
    expect(audits).toHaveLength(1);
  });

  it('resend still needs a session', async () => {
    const u = await signup(t);
    u.api.token = undefined;
    await u.api.post('/auth/resend-verification').expect(401);
  });
});
