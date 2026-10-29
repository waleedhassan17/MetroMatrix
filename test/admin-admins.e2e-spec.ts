import { randomUUID } from 'crypto';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import {
  adminChallenge,
  enrolledAdmin,
  freshTotp,
  limitedAdmin,
  totpCode,
} from './utils/admin';
import { PASSWORD, signup, uniqueEmail } from './utils/factories';
import { assertSuperAdminRemains } from '../src/modules/admin/admins/super-admin-invariant';

type Admin = Awaited<ReturnType<typeof enrolledAdmin>>;

/**
 * Super admin S2 + S3: /admin/admins, temporary passwords, the restricted
 * session, step-up, session revocation and the invariants.
 */
describe('Admin management (e2e)', () => {
  let t: TestApp;
  let root: Admin;

  beforeAll(async () => {
    t = await createTestApp();
    root = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  const stepUp = async () => ({ totpCode: await freshTotp(t, root) });

  async function createAdmin(permissions: string[] = ['approvePartners']) {
    const email = uniqueEmail('staff');
    // A fresh client per call: the step-up routes are throttled per address.
    const creator = new ApiClient(t.http);
    creator.token = root.api.token;
    creator.headers = { ...root.api.headers };
    const res = await creator
      .post('/admin/admins', {
        email,
        displayName: 'New Staff',
        permissions,
        ...(await stepUp()),
      })
      .expect(201);
    return {
      email,
      id: res.body.data.admin.id as string,
      temporaryPassword: res.body.data.temporaryPassword as string,
      body: res.body,
    };
  }

  describe('create and first sign-in', () => {
    it('returns the temporary password once and stores only its hash', async () => {
      const key = randomUUID();
      root.api.headers = { 'Idempotency-Key': key };
      let created: Awaited<ReturnType<typeof createAdmin>>;
      try {
        created = await createAdmin(['manageUsers', 'approvePartners']);
      } finally {
        root.api.headers = {};
      }
      const { admin } = created.body.data;
      expect(admin).toMatchObject({
        email: created.email,
        role: 'admin',
        status: 'active',
        isSuperAdmin: false,
        mustChangePassword: true,
        totpEnabled: false,
        permissions: ['approvePartners', 'manageUsers'],
      });
      expect(created.temporaryPassword).toMatch(/^[A-Za-z2-9]{16}$/);

      const [row] = await t.ds.query(
        `SELECT password_hash, admin_permissions, must_change_password FROM users WHERE id = $1`,
        [created.id],
      );
      expect(row.password_hash).toMatch(/^\$2[aby]\$/);
      expect(row.password_hash).not.toContain(created.temporaryPassword);
      expect(row.must_change_password).toBe(true);

      // Not replayable: the response was never stored under the key.
      const stored = await t.ds.query(
        `SELECT count(*)::int AS n FROM idempotency_records WHERE idempotency_key = $1`,
        [key],
      );
      expect(stored[0].n).toBe(0);
      // Not in the audit trail either.
      const leaked = await t.ds.query(
        `SELECT count(*)::int AS n FROM operational_audit_events
          WHERE target_id = $1 AND (details::text LIKE $2 OR before::text LIKE $2 OR after::text LIKE $2)`,
        [created.id, `%${created.temporaryPassword}%`],
      );
      expect(leaked[0].n).toBe(0);

      // GET never shows it again.
      const again = await root.api
        .get(`/admin/admins/${created.id}`)
        .expect(200);
      expect(JSON.stringify(again.body)).not.toContain(
        created.temporaryPassword,
      );
    });

    it('the new admin enrols, is held to change-password, then works within its permissions', async () => {
      const created = await createAdmin(['approvePartners']);

      const step1 = await new ApiClient(t.http)
        .post('/auth/signin', {
          email: created.email,
          password: created.temporaryPassword,
          portal: 'admin',
        })
        .expect(200);
      expect(step1.body.data).toMatchObject({
        totpRequired: true,
        enrolmentRequired: true,
      });

      const viaChallenge = new ApiClient(t.http);
      viaChallenge.token = step1.body.data.challengeToken;
      const enrol = await viaChallenge.post('/admin/me/totp/enrol').expect(200);
      const confirm = await viaChallenge
        .post('/admin/me/totp/confirm', {
          code: totpCode(enrol.body.data.secret),
        })
        .expect(200);
      const api = new ApiClient(t.http);
      api.token = confirm.body.data.auth.tokens.accessToken;
      expect(confirm.body.data.auth.admin).toMatchObject({
        isSuperAdmin: false,
        mustChangePassword: true,
        totpEnabled: true,
        permissions: ['approvePartners'],
        recoveryCodesRemaining: 10,
      });

      // Restricted: only /auth/me and change-password.
      const me = await api.get('/auth/me').expect(200);
      expect(me.body.data.admin.mustChangePassword).toBe(true);
      const held = await api.get('/admin/businesses').expect(403);
      expect(held.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const same = await api
        .post('/auth/change-password', {
          currentPassword: created.temporaryPassword,
          newPassword: created.temporaryPassword,
        })
        .expect(400);
      expect(same.body.error.code).toBe('VALIDATION_FAILED');

      await api
        .post('/auth/change-password', {
          currentPassword: created.temporaryPassword,
          newPassword: PASSWORD,
        })
        .expect(200);

      const after = await api.get('/auth/me').expect(200);
      expect(after.body.data.admin.mustChangePassword).toBe(false);
      await api.get('/admin/businesses').expect(200);
      const denied = await api.get('/admin/users').expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      const notMine = await api.get('/admin/admins').expect(403);
      expect(notMine.body.error.code).toBe('FORBIDDEN');
    });

    it('a session whose authenticator was removed is held to TOTP_REQUIRED', async () => {
      const staff = await limitedAdmin(t, root, ['approvePartners']);
      await t.ds.query(`UPDATE users SET totp_enabled = false WHERE id = $1`, [
        staff.userId,
      ]);
      const res = await staff.api.get('/admin/businesses').expect(403);
      expect(res.body.error.code).toBe('TOTP_REQUIRED');
      await staff.api.get('/auth/me').expect(200);
    });
  });

  describe('step-up', () => {
    it('missing code → STEP_UP_REQUIRED; wrong or reused code → TOTP_INVALID', async () => {
      const body = {
        email: uniqueEmail('staff'),
        displayName: 'Step Up',
        permissions: [],
      };
      const missing = await root.api.post('/admin/admins', body).expect(403);
      expect(missing.body.error.code).toBe('STEP_UP_REQUIRED');

      const code = await freshTotp(t, root);
      const wrong = await root.api
        .post('/admin/admins', {
          ...body,
          totpCode: code === '000000' ? '111111' : '000000',
        })
        .expect(403);
      expect(wrong.body.error.code).toBe('TOTP_INVALID');

      await root.api
        .post('/admin/admins', { ...body, totpCode: code })
        .expect(201);
      // The same code a second time: its step is spent.
      const reused = await root.api
        .post('/admin/admins', {
          ...body,
          email: uniqueEmail('staff'),
          totpCode: code,
        })
        .expect(403);
      expect(reused.body.error.code).toBe('TOTP_INVALID');
    });

    it('checks the actor’s own secret, not another admin’s', async () => {
      const other = await enrolledAdmin(t);
      const res = await root.api
        .post('/admin/admins', {
          email: uniqueEmail('staff'),
          displayName: 'Wrong Secret',
          permissions: [],
          totpCode: await freshTotp(t, other),
        })
        .expect(403);
      expect(res.body.error.code).toBe('TOTP_INVALID');
    });
  });

  describe('changes revoke the target’s sessions', () => {
    it('permissions: old access token dies, new grants apply at next sign-in', async () => {
      const staff = await limitedAdmin(t, root, ['approvePartners']);
      await staff.api.get('/admin/businesses').expect(200);

      const res = await root.api
        .patch(`/admin/admins/${staff.userId}/permissions`, {
          permissions: ['manageUsers'],
          ...(await stepUp()),
        })
        .expect(200);
      expect(res.body.data.permissions).toEqual(['manageUsers']);
      const dead = await staff.api.get('/admin/businesses').expect(401);
      expect(dead.body.error.code).toBe('TOKEN_REVOKED');

      const ch = await adminChallenge(t, staff.email);
      const again = await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: ch.challengeToken,
          code: await freshTotp(t, staff),
        })
        .expect(200);
      const api = new ApiClient(t.http);
      api.token = again.body.data.tokens.accessToken;
      await api.get('/admin/users').expect(200);
      await api.get('/admin/businesses').expect(403);
    });

    it('disable blocks sign-in; enable restores it', async () => {
      const staff = await limitedAdmin(t, root, ['manageUsers']);
      await root.api
        .post(`/admin/admins/${staff.userId}/disable`, {
          reason: 'Left the team',
          ...(await stepUp()),
        })
        .expect(200);
      expect((await staff.api.get('/auth/me')).status).toBe(401);
      const blocked = await new ApiClient(t.http)
        .post('/auth/signin', {
          email: staff.email,
          password: PASSWORD,
          portal: 'admin',
        })
        .expect(403);
      expect(blocked.body.error.code).toBe('ACCOUNT_DISABLED');

      const enabled = await root.api
        .post(`/admin/admins/${staff.userId}/enable`, await stepUp())
        .expect(200);
      expect(enabled.body.data.status).toBe('active');
      await new ApiClient(t.http)
        .post('/auth/signin', {
          email: staff.email,
          password: PASSWORD,
          portal: 'admin',
        })
        .expect(200);
    });

    it('reset-password: a new temporary password, sessions revoked, change required', async () => {
      const staff = await limitedAdmin(t, root, ['manageUsers']);
      const res = await root.api
        .post(`/admin/admins/${staff.userId}/reset-password`, await stepUp())
        .expect(200);
      const temporary = res.body.data.temporaryPassword as string;
      expect(res.body.data.admin.mustChangePassword).toBe(true);
      expect((await staff.api.get('/auth/me')).status).toBe(401);

      await new ApiClient(t.http)
        .post('/auth/signin', {
          email: staff.email,
          password: PASSWORD,
          portal: 'admin',
        })
        .expect(401);
      const ch = await new ApiClient(t.http)
        .post('/auth/signin', {
          email: staff.email,
          password: temporary,
          portal: 'admin',
        })
        .expect(200);
      const signedIn = await new ApiClient(t.http)
        .post('/auth/admin/totp', {
          challengeToken: ch.body.data.challengeToken,
          code: await freshTotp(t, staff),
        })
        .expect(200);
      expect(signedIn.body.data.admin.mustChangePassword).toBe(true);
    });

    it('reset-totp: sessions revoked; the next sign-in enrols again', async () => {
      const staff = await limitedAdmin(t, root, ['manageUsers']);
      const res = await root.api
        .post(`/admin/admins/${staff.userId}/reset-totp`, await stepUp())
        .expect(200);
      expect(res.body.data.totpEnabled).toBe(false);
      expect((await staff.api.get('/auth/me')).status).toBe(401);
      const ch = await adminChallenge(t, staff.email);
      expect(ch.res.body.data.enrolmentRequired).toBe(true);
      const codes = await t.ds.query(
        `SELECT count(*)::int AS n FROM admin_recovery_codes WHERE user_id = $1`,
        [staff.userId],
      );
      expect(codes[0].n).toBe(0);
    });
  });

  describe('invariants', () => {
    it('nobody acts on themselves', async () => {
      const self = `/admin/admins/${root.userId}`;
      for (const action of [
        'disable',
        'enable',
        'reset-password',
        'reset-totp',
      ]) {
        const res = await root.api.post(`${self}/${action}`, await stepUp());
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('SELF_ACTION_FORBIDDEN');
      }
      const perms = await root.api
        .patch(`${self}/permissions`, { permissions: [], ...(await stepUp()) })
        .expect(403);
      expect(perms.body.error.code).toBe('SELF_ACTION_FORBIDDEN');
      const users = await root.api
        .post(`/admin/users/${root.userId}/sign-out-everywhere`)
        .expect(403);
      expect(users.body.error.code).toBe('SELF_ACTION_FORBIDDEN');
    });

    it('a super admin may disable another super admin, never the last one', async () => {
      const peer = await enrolledAdmin(t);
      await root.api
        .post(`/admin/admins/${peer.userId}/disable`, await stepUp())
        .expect(200);

      // The rule itself, against the real table, inside a transaction that
      // is rolled back: with every other super admin inactive, losing the
      // last one is refused.
      const runner = t.ds.createQueryRunner();
      await runner.startTransaction();
      try {
        await runner.query(
          `UPDATE users SET status = 'disabled' WHERE role = 'super_admin' AND id <> $1`,
          [root.userId],
        );
        await expect(
          assertSuperAdminRemains(runner.manager, root.userId),
        ).rejects.toMatchObject({
          response: { code: 'LAST_SUPER_ADMIN' },
        });
        await expect(
          assertSuperAdminRemains(runner.manager, peer.userId),
        ).resolves.toBeUndefined();
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('the API never creates or promotes a super admin', async () => {
      const created = await root.api
        .post('/admin/admins', {
          email: uniqueEmail('staff'),
          displayName: 'Sneaky',
          permissions: [],
          role: 'super_admin',
          ...(await stepUp()),
        })
        .expect(201);
      expect(created.body.data.admin.role).toBe('admin');

      const grant = await root.api
        .post('/admin/admins', {
          email: uniqueEmail('staff'),
          displayName: 'Sneaky',
          permissions: ['manageAdmins'],
          ...(await stepUp()),
        })
        .expect(400);
      expect(grant.body.error.code).toBe('VALIDATION_FAILED');

      const peer = await enrolledAdmin(t);
      const patchSuper = await root.api
        .patch(`/admin/admins/${peer.userId}/permissions`, {
          permissions: [],
          ...(await stepUp()),
        })
        .expect(400);
      expect(patchSuper.body.error.code).toBe('VALIDATION_FAILED');

      // An existing account (a customer) is never turned into an admin.
      const customer = await signup(t);
      const taken = await root.api
        .post('/admin/admins', {
          email: customer.email,
          displayName: 'Customer',
          permissions: [],
          ...(await stepUp()),
        })
        .expect(409);
      expect(taken.body.error.code).toBe('EMAIL_EXISTS');
      const [row] = await t.ds.query(`SELECT role FROM users WHERE id = $1`, [
        customer.userId,
      ]);
      expect(row.role).toBe('customer');

      // The database refuses grants outside the list, and grants to non-admins.
      await expect(
        t.ds.query(
          `UPDATE users SET admin_permissions = '["manageAdmins"]' WHERE id = $1`,
          [created.body.data.admin.id],
        ),
      ).rejects.toThrow(/CHK_users_admin_permissions_known/);
      await expect(
        t.ds.query(
          `UPDATE users SET admin_permissions = '["manageUsers"]' WHERE id = $1`,
          [customer.userId],
        ),
      ).rejects.toThrow(/CHK_users_admin_permissions_admin_only/);
    });

    it('a regular admin holding every permission still cannot manage admins', async () => {
      const all = await limitedAdmin(t, root, [
        'approvePartners',
        'manageUsers',
        'manageShopping',
        'manageHealthcare',
        'manageFood',
        'manageKitchen',
        'manageContent',
        'viewAnalytics',
        'broadcast',
        'viewAudit',
        'manageSettings',
      ]);
      await all.api.get('/admin/admins').expect(403);
      const res = await all.api
        .post('/admin/admins', {
          email: uniqueEmail('staff'),
          displayName: 'Nope',
          permissions: [],
          totpCode: await freshTotp(t, all),
        })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('list and get', () => {
    it('lists admins and super admins, filtered and paged', async () => {
      const staff = await limitedAdmin(t, root, ['viewAudit']);
      const page = await root.api
        .get(`/admin/admins?q=${encodeURIComponent(staff.email)}`)
        .expect(200);
      expect(page.body.data).toMatchObject({ total: 1, page: 1 });
      expect(page.body.data.items[0]).toMatchObject({
        id: staff.userId,
        permissions: ['viewAudit'],
      });
      const supers = await root.api
        .get('/admin/admins?role=super_admin&pageSize=100')
        .expect(200);
      for (const a of supers.body.data.items) {
        expect(a.isSuperAdmin).toBe(true);
        expect(a.permissions).toHaveLength(11);
      }
      const customer = await signup(t);
      await root.api.get(`/admin/admins/${customer.userId}`).expect(404);
    });
  });
});
