import { createTestApp, TestApp } from './utils/test-app';
import { signup } from './utils/factories';
import { emailsTo, lastEmailTo, lastOtpFor } from './utils/outbox';

describe('Email verification (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const wrongCode = (right: string) =>
    String((Number(right) + 1) % 1_000_000).padStart(6, '0');

  /** Pretend the latest code was sent `seconds` ago. */
  const ageLatestCode = (userId: string, seconds: number) =>
    t.ds.query(
      `UPDATE email_verification_otps
          SET created_at = created_at - make_interval(secs => $2),
              expires_at = expires_at - make_interval(secs => $2)
        WHERE id = (SELECT id FROM email_verification_otps WHERE user_id = $1
                     ORDER BY created_at DESC LIMIT 1)`,
      [userId, seconds],
    );

  it('signup emails a 6-digit code (HTML + text), stored only as a hash', async () => {
    const u = await signup(t);
    const email = lastEmailTo(u.email)!;
    expect(email.subject).toBe('Verify your MetroMatrix email');
    const otp = lastOtpFor(u.email);
    expect(email.html).toContain(otp);
    expect(email.html).toContain('MetroMatrix');
    const rows = await t.ds.query(
      `SELECT otp_hash FROM email_verification_otps WHERE user_id = $1`,
      [u.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].otp_hash).not.toContain(otp);
    expect(rows[0].otp_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('wrong code ×5: attemptsLeft counts down, the 5th answers OTP_LOCKED; a resend issues a fresh code', async () => {
    const u = await signup(t);
    const right = lastOtpFor(u.email);

    for (let i = 1; i <= 4; i++) {
      const res = await u.api
        .post('/auth/verify-email', { otp: wrongCode(right) })
        .expect(400);
      expect(res.body.error).toEqual({
        code: 'OTP_INVALID',
        message: expect.any(String),
        details: { attemptsLeft: 5 - i },
      });
    }
    const fifth = await u.api
      .post('/auth/verify-email', { otp: wrongCode(right) })
      .expect(400);
    expect(fifth.body.error.code).toBe('OTP_LOCKED');

    // Locked means locked: even the right code is refused now.
    const after = await u.api
      .post('/auth/verify-email', { otp: right })
      .expect(400);
    expect(after.body.error.code).toBe('OTP_LOCKED');

    await ageLatestCode(u.userId, 61);
    await u.api.post('/auth/resend-verification').expect(200);
    const fresh = lastOtpFor(u.email);
    const ok = await u.api
      .post('/auth/verify-email', { otp: fresh })
      .expect(200);
    expect(ok.body.data.user.isEmailVerified).toBe(true);
  });

  it('an expired code answers OTP_EXPIRED', async () => {
    const u = await signup(t);
    const otp = lastOtpFor(u.email);
    await ageLatestCode(u.userId, 11 * 60);
    const res = await u.api.post('/auth/verify-email', { otp }).expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('resend inside 60 s → 429 RESEND_COOLDOWN with retryAfter', async () => {
    const u = await signup(t);
    const res = await u.api.post('/auth/resend-verification').expect(429);
    expect(res.body.error.code).toBe('RESEND_COOLDOWN');
    expect(res.body.error.details.retryAfter).toBeGreaterThan(0);
    expect(res.body.error.details.retryAfter).toBeLessThanOrEqual(60);
    expect(emailsTo(u.email)).toHaveLength(1);
  });

  it('the correct code verifies: /auth/me shows isEmailVerified true', async () => {
    const u = await signup(t);
    const res = await u.api
      .post('/auth/verify-email', { otp: lastOtpFor(u.email) })
      .expect(200);
    expect(res.body.data.user.isEmailVerified).toBe(true);

    const me = await u.api.get('/auth/me').expect(200);
    expect(me.body.data.user.isEmailVerified).toBe(true);

    // Verifying again is a harmless no-op; resending says so.
    await u.api.post('/auth/verify-email', { otp: '000000' }).expect(200);
    const resend = await u.api.post('/auth/resend-verification').expect(200);
    expect(resend.body.data).toEqual({
      sent: false,
      alreadyVerified: true,
      retryAfter: 0,
    });
  });

  it('a malformed code is a validation error, not an attempt', async () => {
    const u = await signup(t);
    const res = await u.api
      .post('/auth/verify-email', { otp: '12ab' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields.otp).toBeDefined();
  });

  it('verification needs a session', async () => {
    const u = await signup(t);
    u.api.token = undefined;
    await u.api.post('/auth/verify-email', { otp: '123456' }).expect(401);
  });
});
