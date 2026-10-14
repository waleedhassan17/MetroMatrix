import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { ProbeController } from './utils/probe.controller';
import {
  signin,
  signup,
  submittedDoctor,
  uploadedDocument,
} from './utils/factories';
import {
  adminChallenge,
  enrolledAdmin,
  seedAdmin,
  totpCode,
} from './utils/admin';
import { lastEmailTo } from './utils/outbox';

describe('Admin: TOTP and approvals (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [ProbeController] });
  });
  afterAll(() => t.close());

  describe('TOTP', () => {
    it('a fresh admin gets a challenge, never tokens; enrols with it; the challenge then dies', async () => {
      const { email } = await seedAdmin(t);
      const { res, challengeToken } = await adminChallenge(t, email);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        totpRequired: true,
        enrolmentRequired: true,
        challengeToken: expect.any(String),
      });
      expect(res.body.data.tokens).toBeUndefined();

      // A challenge is not an access token.
      const asAccess = new ApiClient(t.http);
      asAccess.token = challengeToken;
      await asAccess.get('/auth/me').expect(401);

      // Not enrolled yet: step 2 says so.
      const early = await new ApiClient(t.http)
        .post('/auth/admin/totp', { challengeToken, code: '123456' })
        .expect(403);
      expect(early.body.error.code).toBe('TOTP_REQUIRED');

      const enrol = await asAccess.post('/admin/me/totp/enrol').expect(200);
      expect(enrol.body.data).toEqual({
        otpauthUri: expect.stringMatching(/^otpauth:\/\/totp\/MetroMatrix:/),
        qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        secret: expect.stringMatching(/^[A-Z2-7]+$/),
      });
      const secret = enrol.body.data.secret;

      const wrong = await asAccess
        .post('/admin/me/totp/confirm', {
          code: totpCode(secret) === '000000' ? '111111' : '000000',
        })
        .expect(400);
      expect(wrong.body.error.code).toBe('TOTP_INVALID');

      const ok = await asAccess
        .post('/admin/me/totp/confirm', { code: totpCode(secret) })
        .expect(200);
      expect(ok.body.data.recoveryCodes).toHaveLength(10);
      expect(ok.body.data.auth.user.role).toBe('super_admin');
      expect(ok.body.data.auth.tokens.accessToken).toEqual(expect.any(String));

      // Single-use.
      await asAccess.post('/admin/me/totp/enrol').expect(401);
      await new ApiClient(t.http)
        .post('/auth/admin/totp', { challengeToken, code: totpCode(secret) })
        .expect(401);
    });

    it('enrolled: wrong code → 401 TOTP_INVALID, right code → tokens; challenges are single-use; recovery codes work once', async () => {
      const admin = await enrolledAdmin(t);

      const step1 = await adminChallenge(t, admin.email);
      expect(step1.res.body.data.enrolmentRequired).toBe(false);
      const bad = await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: step1.challengeToken,
          code: totpCode(admin.secret) === '000000' ? '111111' : '000000',
        })
        .expect(401);
      expect(bad.body.error.code).toBe('TOTP_INVALID');

      const good = await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: step1.challengeToken,
          code: totpCode(admin.secret),
        })
        .expect(200);
      expect(good.body.data.tokens.accessToken).toEqual(expect.any(String));
      await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: step1.challengeToken,
          code: totpCode(admin.secret),
        })
        .expect(401);

      // A recovery code, typed sloppily, works exactly once.
      const recovery = admin.recoveryCodes[0].toUpperCase().replace('-', ' ');
      const r1 = await adminChallenge(t, admin.email);
      await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: r1.challengeToken,
          recoveryCode: recovery,
        })
        .expect(200);
      const r2 = await adminChallenge(t, admin.email);
      await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: r2.challengeToken,
          recoveryCode: recovery,
        })
        .expect(401);

      // An enrolled admin's challenge cannot enrol a new authenticator.
      const sneaky = new ApiClient(t.http);
      sneaky.token = r2.challengeToken;
      const res = await sneaky.post('/admin/me/totp/enrol').expect(403);
      expect(res.body.error.code).toBe('TOTP_REQUIRED');
    });

    it('rotation with a session needs a code from the current authenticator', async () => {
      const admin = await enrolledAdmin(t);
      const enrol = await admin.api.post('/admin/me/totp/enrol').expect(200);
      const next = enrol.body.data.secret;
      const noProof = await admin.api
        .post('/admin/me/totp/confirm', { code: totpCode(next) })
        .expect(400);
      expect(noProof.body.error.code).toBe('TOTP_INVALID');

      // The old authenticator still works while the rotation is unfinished.
      const mid = await adminChallenge(t, admin.email);
      await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: mid.challengeToken,
          code: totpCode(admin.secret),
        })
        .expect(200);

      const ok = await admin.api
        .post('/admin/me/totp/confirm', {
          code: totpCode(next),
          currentCode: totpCode(admin.secret),
        })
        .expect(200);
      expect(ok.body.data.auth).toBeNull();
      expect(ok.body.data.recoveryCodes).toHaveLength(10);
    });
  });

  describe('business review', () => {
    it('approve: partner status becomes approved, an audit row is written, the partner is emailed', async () => {
      const admin = await enrolledAdmin(t);
      const { partner, businessId } = await submittedDoctor(t);

      const queue = await admin.api
        .get('/admin/businesses?status=pending_approval&pageSize=100')
        .expect(200);
      expect(Object.keys(queue.body.data).sort()).toEqual([
        'items',
        'page',
        'pageSize',
        'total',
      ]);
      expect(queue.body.data.items.map((b: any) => b.id)).toContain(businessId);

      const one = await admin.api
        .get(`/admin/businesses/${businessId}`)
        .expect(200);
      expect(one.body.data.owner.email).toBe(partner.email);
      expect(one.body.data.documents).toHaveLength(4);

      const approved = await admin.api
        .post(`/admin/businesses/${businessId}/approve`)
        .expect(200);
      expect(approved.body.data.status).toBe('approved');
      expect(
        approved.body.data.documents.every((d: any) => d.status === 'accepted'),
      ).toBe(true);

      const status = await partner.api.get('/businesses/me/status').expect(200);
      expect(status.body.data.status).toBe('approved');

      const audit = await t.ds.query(
        `SELECT action, actor_user_id FROM operational_audit_events
          WHERE target_type = 'business' AND target_id = $1 ORDER BY created_at`,
        [businessId],
      );
      expect(audit.map((a: any) => a.action)).toEqual([
        'business.create',
        'business.submit',
        'business.approve',
      ]);
      expect(audit[2].actor_user_id).toBe(admin.userId);
      expect(lastEmailTo(partner.email)?.subject).toMatch(
        /is approved on MetroMatrix/,
      );

      // Approving twice is not a legal transition.
      const twice = await admin.api
        .post(`/admin/businesses/${businessId}/approve`)
        .expect(409);
      expect(twice.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('reject with reason + document note → partner sees both, fixes, resubmits → pending again, reason cleared', async () => {
      const admin = await enrolledAdmin(t);
      const { partner, businessId } = await submittedDoctor(t);
      const detail = await partner.api.get('/businesses/me').expect(200);
      const cnic = detail.body.data.documents.find(
        (d: any) => d.kind === 'cnic_front',
      );

      await admin.api
        .post(`/admin/businesses/${businessId}/reject`, {
          reason: 'Your CNIC photo is unreadable.',
          documentNotes: [
            { documentId: '00000000-0000-4000-8000-000000000000', note: 'x' },
          ],
        })
        .expect(400);

      await admin.api
        .post(`/admin/businesses/${businessId}/reject`, {
          reason: 'Your CNIC photo is unreadable.',
          documentNotes: [
            { documentId: cnic.id, note: 'Blurry — retake in daylight.' },
          ],
        })
        .expect(200);

      const seen = await partner.api.get('/businesses/me').expect(200);
      expect(seen.body.data.status).toBe('rejected');
      expect(seen.body.data.rejectionReason).toBe(
        'Your CNIC photo is unreadable.',
      );
      const rejectedDoc = seen.body.data.documents.find(
        (d: any) => d.id === cnic.id,
      );
      expect(rejectedDoc).toMatchObject({
        status: 'rejected',
        reviewNote: 'Blurry — retake in daylight.',
      });
      expect(seen.body.data.missingDocuments).toEqual(['cnic_front']);
      const email = lastEmailTo(partner.email)!;
      expect(email.subject).toMatch(/Changes needed/);
      expect(email.text).toContain('Your CNIC photo is unreadable.');
      expect(email.text).toContain('CNIC (front): Blurry');

      // Edit, replace the document, resubmit.
      await partner.api
        .patch('/businesses/me', { city: 'Islamabad' })
        .expect(200);
      await partner.api
        .post('/businesses/me/documents', {
          kind: 'cnic_front',
          ...uploadedDocument(partner.userId),
        })
        .expect(201);
      const again = await partner.api.post('/businesses/me/submit').expect(200);
      expect(again.body.data).toMatchObject({
        status: 'pending_approval',
        rejectionReason: null,
        city: 'Islamabad',
      });
    });

    it('suspend → the partner’s guarded route answers 403 BUSINESS_SUSPENDED; reinstate restores it', async () => {
      const admin = await enrolledAdmin(t);
      const { partner, businessId } = await submittedDoctor(t);

      const pending = await partner.api
        .get('/__test__/partner-only')
        .expect(403);
      expect(pending.body.error).toMatchObject({
        code: 'BUSINESS_NOT_APPROVED',
        details: { status: 'pending_approval' },
      });

      await admin.api
        .post(`/admin/businesses/${businessId}/approve`)
        .expect(200);
      const ok = await partner.api.get('/__test__/partner-only').expect(200);
      expect(ok.body.data.business).toEqual({
        id: businessId,
        status: 'approved',
        serviceType: 'healthcare',
        subType: 'doctor',
      });

      await admin.api
        .post(`/admin/businesses/${businessId}/suspend`, {
          reason: 'Customer complaints under review',
        })
        .expect(200);
      const blocked = await partner.api
        .get('/__test__/partner-only')
        .expect(403);
      expect(blocked.body.error).toMatchObject({
        code: 'BUSINESS_SUSPENDED',
        details: { suspensionReason: 'Customer complaints under review' },
      });
      expect(lastEmailTo(partner.email)?.subject).toMatch(/suspended/);
      const me = await partner.api.get('/auth/me').expect(200);
      expect(me.body.data.business.suspensionReason).toBe(
        'Customer complaints under review',
      );

      await admin.api
        .post(`/admin/businesses/${businessId}/reinstate`, {
          reason: 'Resolved',
        })
        .expect(200);
      await partner.api.get('/__test__/partner-only').expect(200);
      expect(lastEmailTo(partner.email)?.subject).toMatch(/reinstated/);
    });

    it('non-admins cannot reach /admin', async () => {
      const customer = await signup(t);
      const res = await customer.api.get('/admin/businesses').expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      const partner = await signup(t, { role: 'partner' });
      await partner.api.get('/admin/users').expect(403);
    });
  });

  describe('accounts', () => {
    it('disable signs a user out at once and blocks sign-in; enable restores it; admins cannot disable themselves', async () => {
      const admin = await enrolledAdmin(t);
      const victim = await signup(t);

      const list = await admin.api
        .get(`/admin/users?role=customer&q=${encodeURIComponent(victim.email)}`)
        .expect(200);
      expect(list.body.data.total).toBe(1);
      expect(list.body.data.items[0]).toMatchObject({
        id: victim.userId,
        status: 'active',
      });

      const disabled = await admin.api
        .post(`/admin/users/${victim.userId}/disable`, { reason: 'Spam' })
        .expect(200);
      expect(disabled.body.data.status).toBe('disabled');

      await victim.api.get('/auth/me').expect(401);
      await victim.api
        .post('/auth/refresh-token', { refreshToken: victim.refreshToken })
        .expect(403);
      const login = await signin(t, victim.email, 'customer');
      expect(login.res.status).toBe(403);
      expect(login.res.body.error.code).toBe('ACCOUNT_DISABLED');

      await admin.api.post(`/admin/users/${victim.userId}/enable`).expect(200);
      expect((await signin(t, victim.email, 'customer')).res.status).toBe(200);

      const self = await admin.api
        .post(`/admin/users/${admin.userId}/disable`)
        .expect(403);
      expect(self.body.error.code).toBe('FORBIDDEN');

      const audit = await t.ds.query(
        `SELECT action FROM operational_audit_events WHERE target_id = $1 AND action LIKE 'user.%' ORDER BY created_at`,
        [victim.userId],
      );
      expect(audit.map((a: any) => a.action)).toEqual([
        'user.disable',
        'user.enable',
      ]);
    });
  });
});
