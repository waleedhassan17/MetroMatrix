/**
 * The Chunk 1 QA matrix — one test per row, named "QA #n". All must pass
 * before Chunk 2.
 */
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import * as Sentry from '@sentry/nestjs';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import {
  DOCTOR_BUSINESS,
  PASSWORD,
  addDocuments,
  sha256,
  signin,
  signup,
  submittedDoctor,
  uniqueEmail,
  uploadedDocument,
  verifiedPartner,
} from './utils/factories';
import {
  emailsTo,
  lastEmailTo,
  lastOtpFor,
  lastVerifyTokenFor,
} from './utils/outbox';
import { FakeGoogleVerifier, googleToken } from './utils/fake-google';
import {
  adminChallenge,
  enrolledAdmin,
  seedAdmin,
  verifyDoctorPmdc,
} from './utils/admin';
import { ProbeController } from './utils/probe.controller';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual('@sentry/nestjs'),
  captureException: jest.fn(),
  withScope: (fn: (scope: unknown) => void) =>
    fn({ setTag: jest.fn(), setContext: jest.fn(), setUser: jest.fn() }),
}));

describe('QA matrix (Chunk 1)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [ProbeController],
      override: (b) =>
        b
          .overrideProvider(GoogleTokenVerifier)
          .useValue(new FakeGoogleVerifier()),
    });
  });
  afterAll(() => t.close());

  it('QA #1 signup customer, valid → 201 AuthResult, isEmailVerified false, OTP email sent', async () => {
    const email = uniqueEmail('qa1');
    const res = await new ApiClient(t.http)
      .post('/auth/signup', {
        email,
        password: PASSWORD,
        displayName: 'QA One',
        role: 'customer',
      })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email,
      role: 'customer',
      isEmailVerified: false,
    });
    expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));
    expect(lastEmailTo(email)?.subject).toBe('Verify your MetroMatrix email');
    expect(lastVerifyTokenFor(email)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('QA #2 signup same email again (any case) → 409 EMAIL_EXISTS', async () => {
    const u = await signup(t);
    const res = await new ApiClient(t.http)
      .post('/auth/signup', {
        email: u.email.replace(/^./, (c) => c.toUpperCase()).toUpperCase(),
        password: PASSWORD,
        displayName: 'Again',
        role: 'partner',
      })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('QA #3 weak password → 400 VALIDATION_FAILED with field details', async () => {
    const res = await new ApiClient(t.http)
      .post('/auth/signup', {
        email: uniqueEmail('qa3'),
        password: 'weakpass',
        displayName: 'QA',
        role: 'customer',
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields.password).toEqual(
      expect.arrayContaining([expect.stringMatching(/upper-?case/i)]),
    );
  });

  it('QA #4 phone "0312 4890176" → stored +923124890176', async () => {
    const u = await signup(t, { phone: '0312 4890176' });
    expect(u.body.data.user.phone).toBe('+923124890176');
    const [row] = await t.ds.query('SELECT phone FROM users WHERE id = $1', [
      u.userId,
    ]);
    expect(row.phone).toBe('+923124890176');
  });

  it('QA #5 wrong password → 401 INVALID_CREDENTIALS, same message for an unknown email', async () => {
    const u = await signup(t);
    const bad = await signin(t, u.email, 'customer', 'Wrong1234');
    const unknown = await signin(t, uniqueEmail('ghost'), 'customer');
    expect(bad.res.status).toBe(401);
    expect(bad.res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.res.body).toEqual(bad.res.body);
  });

  it('QA #6 partner on the customer portal → 403 WRONG_PORTAL naming the partner portal', async () => {
    const p = await signup(t, { role: 'partner' });
    const { res } = await signin(t, p.email, 'customer');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WRONG_PORTAL');
    expect(res.body.error.message).toMatch(/partner portal/);
  });

  it('QA #7 6th sign-in attempt in a minute → 429 RATE_LIMITED', async () => {
    const u = await signup(t);
    const one = new ApiClient(t.http); // one client = one IP
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await one.post('/auth/signin', {
        email: u.email,
        password: 'Wrong1234',
        portal: 'customer',
      });
      statuses.push(res.status);
      if (i === 5) {
        expect(res.body.error.code).toBe('RATE_LIMITED');
        expect(res.headers['retry-after']).toBeDefined();
      }
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('QA #8 verify link: a made-up token → VERIFY_LINK_INVALID; resend retires the old link, the new one verifies', async () => {
    const u = await signup(t);
    const first = lastVerifyTokenFor(u.email);
    const bad = await u.api
      .post('/auth/verify-email', { token: `${first}x` })
      .expect(400);
    expect(bad.body.error.code).toBe('VERIFY_LINK_INVALID');
    await t.ds.query(
      `UPDATE email_verification_tokens SET created_at = created_at - interval '61 seconds' WHERE user_id = $1`,
      [u.userId],
    );
    await u.api.post('/auth/resend-verification').expect(200);
    const fresh = lastVerifyTokenFor(u.email);
    expect(emailsTo(u.email)).toHaveLength(2);
    const old = await u.api
      .post('/auth/verify-email', { token: first })
      .expect(400);
    expect(old.body.error.code).toBe('VERIFY_LINK_INVALID');
    await u.api.post('/auth/verify-email', { token: fresh }).expect(200);
  });

  it('QA #9 access token after 15 min → 401; refresh succeeds', async () => {
    const u = await signup(t);
    const jwt = t.app.get(JwtService, { strict: false });
    const [row] = await t.ds.query(
      'SELECT family_id FROM refresh_tokens WHERE token_hash = $1',
      [sha256(u.refreshToken)],
    );
    const now = Math.floor(Date.now() / 1000);
    const stale = jwt.sign(
      {
        sub: u.userId,
        role: 'customer',
        sid: row.family_id,
        ver: 0,
        jti: randomUUID(),
        iat: now - 16 * 60,
        exp: now - 60,
      },
      { audience: 'access' },
    );
    const api = new ApiClient(t.http);
    api.token = stale;
    const res = await api.get('/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toMatch(/expired/);

    const refreshed = await api
      .post('/auth/refresh-token', { refreshToken: u.refreshToken })
      .expect(200);
    api.token = refreshed.body.data.accessToken;
    await api.get('/auth/me').expect(200);
  });

  it('QA #10 refresh token used twice > 10 s apart → 401 REFRESH_REUSED; family revoked', async () => {
    const u = await signup(t);
    const first = await u.api
      .post('/auth/refresh-token', { refreshToken: u.refreshToken })
      .expect(200);
    await t.ds.query(
      `UPDATE refresh_tokens SET revoked_at = revoked_at - interval '11 seconds' WHERE token_hash = $1`,
      [sha256(u.refreshToken)],
    );
    const reused = await u.api
      .post('/auth/refresh-token', { refreshToken: u.refreshToken })
      .expect(401);
    expect(reused.body.error.code).toBe('REFRESH_REUSED');
    await u.api
      .post('/auth/refresh-token', {
        refreshToken: first.body.data.refreshToken,
      })
      .expect(401);
    const [{ live }] = await t.ds.query(
      `SELECT count(*)::int AS live FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
      [u.userId],
    );
    expect(live).toBe(0);
  });

  it('QA #11 logout then reuse the access token → 401 TOKEN_REVOKED', async () => {
    const u = await signup(t);
    await u.api.post('/auth/logout').expect(200);
    const res = await u.api.get('/auth/me').expect(401);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('QA #12 forgot password for an unknown email → 200, same body as a known one', async () => {
    const u = await signup(t);
    const known = await new ApiClient(t.http)
      .post('/auth/forgot-password', { email: u.email })
      .expect(200);
    const unknown = await new ApiClient(t.http)
      .post('/auth/forgot-password', { email: uniqueEmail('nobody') })
      .expect(200);
    expect(unknown.body).toEqual(known.body);
  });

  it('QA #13 reset password → old sessions dead, new password works', async () => {
    const u = await signup(t);
    const anon = new ApiClient(t.http);
    await anon.post('/auth/forgot-password', { email: u.email }).expect(200);
    const { body } = await anon
      .post('/auth/verify-otp', { email: u.email, otp: lastOtpFor(u.email) })
      .expect(200);
    await anon
      .post('/auth/reset-password', {
        resetToken: body.data.resetToken,
        password: 'Reset9Password',
      })
      .expect(200);
    await u.api.get('/auth/me').expect(401);
    await anon
      .post('/auth/refresh-token', { refreshToken: u.refreshToken })
      .expect(401);
    expect(
      (await signin(t, u.email, 'customer', 'Reset9Password')).res.status,
    ).toBe(200);
  });

  it('QA #14 Google new user → customer created, verified, tokens', async () => {
    const email = uniqueEmail('g');
    const res = await new ApiClient(t.http)
      .post('/auth/google', {
        idToken: googleToken({ sub: `g-${email}`, email }),
      })
      .expect(200);
    expect(res.body.data.user).toMatchObject({
      email,
      role: 'customer',
      isEmailVerified: true,
    });
    expect(res.body.data.tokens.refreshToken).toEqual(expect.any(String));
  });

  it("QA #15 Google with a partner's email → 403 WRONG_PORTAL", async () => {
    const p = await signup(t, { role: 'partner' });
    const res = await new ApiClient(t.http)
      .post('/auth/google', {
        idToken: googleToken({ sub: `g-${p.email}`, email: p.email }),
      })
      .expect(403);
    expect(res.body.error.code).toBe('WRONG_PORTAL');
  });

  it('QA #16 partner creates a 2nd business → 409 BUSINESS_EXISTS', async () => {
    const p = await verifiedPartner(t);
    await p.api.post('/businesses', DOCTOR_BUSINESS).expect(201);
    const res = await p.api.post('/businesses', DOCTOR_BUSINESS).expect(409);
    expect(res.body.error.code).toBe('BUSINESS_EXISTS');
  });

  it("QA #17 doctor submits without PMDC → 422 DOCUMENTS_MISSING missing ['pmdc_certificate']", async () => {
    const p = await verifiedPartner(t);
    await p.api.post('/businesses', DOCTOR_BUSINESS).expect(201);
    await addDocuments(p, ['cnic_front', 'cnic_back', 'degree_certificate']);
    const res = await p.api.post('/businesses/me/submit').expect(422);
    expect(res.body.error.code).toBe('DOCUMENTS_MISSING');
    expect(res.body.error.details.missing).toEqual(['pmdc_certificate']);
  });

  it('QA #18 document URL from another cloud/folder → 400 VALIDATION_FAILED', async () => {
    const p = await verifiedPartner(t);
    const stranger = await verifiedPartner(t);
    await p.api.post('/businesses', DOCTOR_BUSINESS).expect(201);
    const mine = uploadedDocument(p.userId);
    for (const doc of [
      {
        url: mine.url.replace('metromatrix-test', 'other-cloud'),
        publicId: mine.publicId,
      },
      uploadedDocument(stranger.userId),
    ]) {
      const res = await p.api
        .post('/businesses/me/documents', { kind: 'cnic_front', ...doc })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('QA #19 admin sign-in without TOTP → no tokens issued', async () => {
    const { email } = await seedAdmin(t);
    const { res } = await adminChallenge(t, email);
    expect(res.status).toBe(200);
    expect(res.body.data.totpRequired).toBe(true);
    expect(res.body.data.tokens).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
    const [{ n }] = await t.ds.query(
      `SELECT count(*)::int AS n FROM refresh_tokens r JOIN users u ON u.id = r.user_id WHERE u.email = $1`,
      [email],
    );
    expect(n).toBe(0);
  });

  it('QA #20 approve → partner status approved; audit row written; email sent', async () => {
    const admin = await enrolledAdmin(t);
    const { partner, businessId } = await submittedDoctor(t);
    await verifyDoctorPmdc(admin, businessId);
    await admin.api.post(`/admin/businesses/${businessId}/approve`).expect(200);
    const status = await partner.api.get('/businesses/me/status').expect(200);
    expect(status.body.data.status).toBe('approved');
    const audit = await t.ds.query(
      `SELECT 1 FROM operational_audit_events WHERE action = 'business.approve' AND target_id = $1`,
      [businessId],
    );
    expect(audit).toHaveLength(1);
    expect(lastEmailTo(partner.email)?.subject).toMatch(/approved/);
  });

  it('QA #21 reject → edit → resubmit → pending_approval again, rejection_reason cleared', async () => {
    const admin = await enrolledAdmin(t);
    const { partner, businessId } = await submittedDoctor(t);
    await admin.api
      .post(`/admin/businesses/${businessId}/reject`, {
        reason: 'Address does not match the CNIC.',
      })
      .expect(200);
    const seen = await partner.api.get('/businesses/me/status').expect(200);
    expect(seen.body.data).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Address does not match the CNIC.',
    });
    await partner.api
      .patch('/businesses/me', { addressLine: '7 Mall Road, Lahore' })
      .expect(200);
    const again = await partner.api.post('/businesses/me/submit').expect(200);
    expect(again.body.data.status).toBe('pending_approval');
    const [row] = await t.ds.query(
      'SELECT rejection_reason FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(row.rejection_reason).toBeNull();
  });

  it('QA #22 suspended partner hits a guarded route → 403 BUSINESS_SUSPENDED', async () => {
    const admin = await enrolledAdmin(t);
    const { partner, businessId } = await submittedDoctor(t);
    await verifyDoctorPmdc(admin, businessId);
    await admin.api.post(`/admin/businesses/${businessId}/approve`).expect(200);
    await partner.api.get('/__test__/partner-only').expect(200);
    await admin.api
      .post(`/admin/businesses/${businessId}/suspend`, {
        reason: 'Expired PMDC registration',
      })
      .expect(200);
    const res = await partner.api.get('/__test__/partner-only').expect(403);
    expect(res.body.error.code).toBe('BUSINESS_SUSPENDED');
  });

  it('QA #23 delete account → cannot sign in; email reusable; tokens revoked', async () => {
    const admin = await enrolledAdmin(t);
    const { partner, businessId } = await submittedDoctor(t);
    await verifyDoctorPmdc(admin, businessId);
    await admin.api.post(`/admin/businesses/${businessId}/approve`).expect(200);

    await partner.api
      .delete('/auth/account', { password: PASSWORD })
      .expect(200);
    await partner.api.get('/auth/me').expect(401);
    await partner.api
      .post('/auth/refresh-token', { refreshToken: partner.refreshToken })
      .expect(401);
    expect((await signin(t, partner.email, 'partner')).res.status).toBe(401);
    const again = await signup(t, { email: partner.email, role: 'customer' });
    expect(again.userId).not.toBe(partner.userId);
    // The deleted owner's live business is taken out of circulation.
    const [biz] = await t.ds.query(
      'SELECT status, suspension_reason FROM businesses WHERE id = $1',
      [businessId],
    );
    expect(biz).toEqual({
      status: 'suspended',
      suspension_reason: 'Owner account deleted',
    });
  });

  it('QA #24 any 500 → generic message, no stack/SQL in the body, Sentry event', async () => {
    const capture = Sentry.captureException as jest.Mock;
    capture.mockClear();
    const res = await new ApiClient(t.http).get('/__test__/boom').expect(500);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /SELECT|relation|password|at \w/,
    );
    expect(capture).toHaveBeenCalledTimes(1);
    expect((capture.mock.calls[0][0] as Error).message).toMatch(
      /relation "users"/,
    );
  });
});
