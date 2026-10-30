import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { PASSWORD, signup, uniqueEmail } from './utils/factories';
import { emailsTo, lastOtpFor } from './utils/outbox';
import {
  adminChallenge,
  enrolledAdmin,
  nextTotpWindow,
  seedAdmin,
  totpCode,
} from './utils/admin';

/**
 * Per-account limits (modules/auth/abuse-counters.ts). Every attempt uses a
 * fresh client — a fresh IP — so the per-IP route Throttler never answers
 * first: these rules must hold even for an attacker with many addresses.
 */
describe('Abuse protection (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const signinFrom = (email: string, password: string) =>
    new ApiClient(t.http).post('/auth/signin', {
      email,
      password,
      portal: 'customer',
    });

  const counters = async (userId: string) =>
    (
      await t.ds.query(
        `SELECT signin_failures, totp_failures FROM users WHERE id = $1`,
        [userId],
      )
    )[0] as { signin_failures: number; totp_failures: number };

  const ageWindow = (userId: string, column: string, minutes: number) =>
    t.ds.query(
      `UPDATE users SET ${column} = ${column} - make_interval(mins => $2) WHERE id = $1`,
      [userId, minutes],
    );

  describe('password sign-in lockout', () => {
    it('10 wrong passwords in 15 minutes lock the account: even the right password gets the same INVALID_CREDENTIALS', async () => {
      const u = await signup(t);
      const wrong = [];
      for (let i = 0; i < 10; i++)
        wrong.push(await signinFrom(u.email, 'Wrong1234'));
      expect(wrong.map((r) => r.status)).toEqual(Array(10).fill(401));
      expect((await counters(u.userId)).signin_failures).toBe(10);

      const locked = await signinFrom(u.email, PASSWORD).expect(401);
      // Indistinguishable from a wrong password.
      expect(locked.body).toEqual(wrong[0].body);

      // The window ends 15 minutes after the first failure.
      await ageWindow(u.userId, 'signin_failures_since', 16);
      await signinFrom(u.email, PASSWORD).expect(200);
      expect((await counters(u.userId)).signin_failures).toBe(0);
    });

    it('a success resets the count; concurrent wrong guesses all count', async () => {
      const u = await signup(t);
      await Promise.all(
        Array.from({ length: 6 }, () => signinFrom(u.email, 'Wrong1234')),
      );
      expect((await counters(u.userId)).signin_failures).toBe(6);
      await signinFrom(u.email, PASSWORD).expect(200);
      expect((await counters(u.userId)).signin_failures).toBe(0);
    });

    it('an unknown email answers exactly like a wrong password', async () => {
      const u = await signup(t);
      const wrong = await signinFrom(u.email, 'Wrong1234').expect(401);
      const ghost = await signinFrom(uniqueEmail('ghost'), 'Wrong1234').expect(
        401,
      );
      expect(ghost.body).toEqual(wrong.body);
    });

    it('a password reset lifts the lockout', async () => {
      const u = await signup(t);
      for (let i = 0; i < 10; i++) await signinFrom(u.email, 'Wrong1234');
      await new ApiClient(t.http)
        .post('/auth/forgot-password', { email: u.email })
        .expect(200);
      const { body } = await new ApiClient(t.http)
        .post('/auth/verify-otp', { email: u.email, otp: lastOtpFor(u.email) })
        .expect(200);
      await new ApiClient(t.http)
        .post('/auth/reset-password', {
          resetToken: body.data.resetToken,
          password: 'Reset1Password',
        })
        .expect(200);
      await signinFrom(u.email, 'Reset1Password').expect(200);
    });
  });

  describe('admin TOTP', () => {
    const step2 = (challengeToken: string, factor: object) =>
      new ApiClient(t.http).post('/auth/admin/totp', {
        challengeToken,
        ...factor,
      });

    it('a code is accepted once: replaying it on a new challenge is TOTP_INVALID', async () => {
      const admin = await enrolledAdmin(t);
      const code = totpCode(admin.secret);
      const first = await adminChallenge(t, admin.email);
      await step2(first.challengeToken, { code }).expect(200);

      const second = await adminChallenge(t, admin.email);
      const replay = await step2(second.challengeToken, { code }).expect(401);
      expect(replay.body.error.code).toBe('TOTP_INVALID');

      // A later step is fine (simulated by moving the accepted step back).
      await nextTotpWindow(t, admin.userId);
      const third = await adminChallenge(t, admin.email);
      await step2(third.challengeToken, {
        code: totpCode(admin.secret),
      }).expect(200);
    });

    it('the code that confirmed enrolment cannot then sign in', async () => {
      // Enrol by hand (the helper would move past the confirming step).
      const { email, userId } = await seedAdmin(t);
      const viaChallenge = new ApiClient(t.http);
      viaChallenge.token = (await adminChallenge(t, email)).challengeToken;
      const enrol = await viaChallenge.post('/admin/me/totp/enrol').expect(200);
      const secret = enrol.body.data.secret as string;
      const code = totpCode(secret);
      await viaChallenge.post('/admin/me/totp/confirm', { code }).expect(200);
      const [row] = await t.ds.query(
        'SELECT totp_last_step FROM users WHERE id = $1',
        [userId],
      );
      expect(row.totp_last_step).not.toBeNull();

      // Someone who saw that code and knows the password gets nowhere …
      const replay = await adminChallenge(t, email);
      const res = await step2(replay.challengeToken, { code }).expect(401);
      expect(res.body.error.code).toBe('TOTP_INVALID');

      // … while the admin's next code works.
      await nextTotpWindow(t, userId);
      const next = await adminChallenge(t, email);
      await step2(next.challengeToken, { code: totpCode(secret) }).expect(200);
    });

    it('rotating the authenticator spends the new code too, and never moves the mark backwards', async () => {
      const admin = await enrolledAdmin(t);
      const before = Number(
        (
          await t.ds.query('SELECT totp_last_step FROM users WHERE id = $1', [
            admin.userId,
          ])
        )[0].totp_last_step,
      );
      const enrol = await admin.api.post('/admin/me/totp/enrol').expect(200);
      const next = enrol.body.data.secret as string;
      const newCode = totpCode(next);
      await admin.api
        .post('/admin/me/totp/confirm', {
          code: newCode,
          currentCode: totpCode(admin.secret),
        })
        .expect(200);
      const after = Number(
        (
          await t.ds.query('SELECT totp_last_step FROM users WHERE id = $1', [
            admin.userId,
          ])
        )[0].totp_last_step,
      );
      expect(after).toBeGreaterThan(before);

      const replay = await adminChallenge(t, admin.email);
      await step2(replay.challengeToken, { code: newCode }).expect(401);
    });

    it('5 wrong codes (recovery codes included) in 15 minutes → 429 RATE_LIMITED with retryAfter; the challenge dies; even the right code waits', async () => {
      const admin = await enrolledAdmin(t);
      const bad = totpCode(admin.secret) === '000000' ? '111111' : '000000';
      const { challengeToken } = await adminChallenge(t, admin.email);

      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await step2(challengeToken, { code: bad })).status);
      }
      for (let i = 0; i < 1; i++) {
        statuses.push(
          (await step2(challengeToken, { recoveryCode: 'zzzz-zzzz' })).status,
        );
      }
      const fifth = await step2(challengeToken, { recoveryCode: 'yyyy-yyyy' });
      expect(statuses).toEqual([401, 401, 401, 401]);
      expect(fifth.status).toBe(429);
      expect(fifth.body.error.code).toBe('RATE_LIMITED');
      expect(fifth.body.error.details.retryAfter).toBeGreaterThan(0);
      expect(fifth.body.error.details.retryAfter).toBeLessThanOrEqual(15 * 60);

      // The challenge is spent …
      const dead = await step2(challengeToken, {
        code: totpCode(admin.secret),
      }).expect(401);
      expect(dead.body.error.code).toBe('UNAUTHORIZED');
      // … and a new one still waits out the window, right code or not.
      const fresh = await adminChallenge(t, admin.email);
      await step2(fresh.challengeToken, {
        code: totpCode(admin.secret),
      }).expect(429);

      await ageWindow(admin.userId, 'totp_failures_since', 16);
      const after = await adminChallenge(t, admin.email);
      await step2(after.challengeToken, {
        code: totpCode(admin.secret),
      }).expect(200);
      expect((await counters(admin.userId)).totp_failures).toBe(0);
    });
  });

  describe('forgot password', () => {
    const forgot = (email: string) =>
      new ApiClient(t.http)
        .post('/auth/forgot-password', { email })
        .expect(200);

    it('at most 3 codes per account per hour; the 4th request answers the same and sends nothing', async () => {
      const u = await signup(t);
      const before = emailsTo(u.email).length;
      for (let i = 0; i < 3; i++) await forgot(u.email);
      expect(emailsTo(u.email).length - before).toBe(3);

      const fourth = await forgot(u.email);
      expect(fourth.body.data).toEqual({ delivered: true });
      expect(emailsTo(u.email).length - before).toBe(3);

      // An hour later the next one goes out.
      await t.ds.query(
        `UPDATE password_reset_otps SET created_at = created_at - interval '61 minutes' WHERE user_id = $1`,
        [u.userId],
      );
      await forgot(u.email);
      expect(emailsTo(u.email).length - before).toBe(4);
    });

    it('an unknown address gets the same answer and no email', async () => {
      const ghost = uniqueEmail('ghost');
      const res = await forgot(ghost);
      expect(res.body.data).toEqual({ delivered: true });
      expect(emailsTo(ghost)).toHaveLength(0);
    });
  });
});
