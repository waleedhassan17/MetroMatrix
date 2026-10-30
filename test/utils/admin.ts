import { authenticator } from 'otplib';
import { seedSuperAdmin } from '../../src/database/seeds/super-admin';
import { ApiClient, TestApp } from './test-app';
import { PASSWORD, uniqueEmail } from './factories';

export const totpCode = (secret: string) => authenticator.generate(secret);

/**
 * A code the server will accept again. A TOTP code's 30 s step is spent once
 * used (sign-in, rotation, step-up); clearing the admin's last spent step
 * stands in for waiting for the next step, as the suites back-date rows
 * rather than sleep.
 */
export async function freshTotp(
  t: TestApp,
  admin: { userId: string; secret: string },
): Promise<string> {
  await t.ds.query(`UPDATE users SET totp_last_step = NULL WHERE id = $1`, [
    admin.userId,
  ]);
  return authenticator.generate(admin.secret);
}

/** A brand-new super admin, as `npm run seed:superadmin` would create. */
export async function seedAdmin(t: TestApp) {
  const email = uniqueEmail('admin');
  const { userId } = await seedSuperAdmin(t.ds, {
    email,
    password: PASSWORD,
    bcryptRounds: 4,
  });
  return { email, userId };
}

/** Admin portal step 1 on a fresh client. */
export async function adminChallenge(t: TestApp, email: string) {
  const api = new ApiClient(t.http);
  const res = await api.post('/auth/signin', {
    email,
    password: PASSWORD,
    portal: 'admin',
  });
  return { api, res, challengeToken: res.body.data?.challengeToken as string };
}

/**
 * A TOTP code is accepted once (users.totp_last_step). Tests can't wait for
 * the next 30 s step, so they move the accepted step back instead: the
 * current code then counts as a later one.
 */
export const nextTotpWindow = (t: TestApp, userId: string) =>
  t.ds.query(
    'UPDATE users SET totp_last_step = totp_last_step - 10 WHERE id = $1',
    [userId],
  );

/** Seed an admin and enrol TOTP through the challenge — a signed-in admin. */
export async function enrolledAdmin(t: TestApp) {
  const { email, userId } = await seedAdmin(t);
  const { challengeToken } = await adminChallenge(t, email);
  const viaChallenge = new ApiClient(t.http);
  viaChallenge.token = challengeToken;
  const enrol = await viaChallenge.post('/admin/me/totp/enrol');
  const secret = enrol.body.data.secret as string;
  const confirm = await viaChallenge.post('/admin/me/totp/confirm', {
    code: totpCode(secret),
  });
  if (confirm.status !== 200) {
    throw new Error(
      `confirm failed: ${confirm.status} ${JSON.stringify(confirm.body)}`,
    );
  }
  // The confirming code is now spent (users.totp_last_step); tests sign in
  // right away, as if the next 30 s window had come.
  await nextTotpWindow(t, userId);
  const api = new ApiClient(t.http);
  api.token = confirm.body.data.auth.tokens.accessToken;
  return {
    api,
    email,
    userId,
    secret,
    recoveryCodes: confirm.body.data.recoveryCodes as string[],
  };
}

/**
 * Chunk 3: a doctor business can only be approved once MetroMatrix has
 * verified its PMDC number. Finds the doctor row created at submit and
 * verifies it; returns the doctor id.
 */
export async function verifyDoctorPmdc(
  admin: { api: ApiClient },
  businessId: string,
): Promise<string> {
  const list = await admin.api.get(
    `/admin/health/doctors?businessId=${businessId}`,
  );
  const id = list.body.data?.items?.[0]?.id;
  if (!id)
    throw new Error(
      `no doctor for business ${businessId}: ${JSON.stringify(list.body)}`,
    );
  const res = await admin.api.post(
    `/admin/health/doctors/${id}/pmdc-verify`,
    {},
  );
  if (res.status !== 200)
    throw new Error(
      `pmdc-verify failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  return id;
}

export interface SignedInAdmin {
  api: ApiClient;
  email: string;
  userId: string;
  secret: string;
  password: string;
}

/**
 * A regular admin with exactly `permissions`, made the way the console makes
 * one: a super admin creates it (temporary password, step-up), the new admin
 * signs in with it, enrols an authenticator through the challenge, then
 * replaces the temporary password. Fully set up and signed in.
 */
export async function limitedAdmin(
  t: TestApp,
  superAdmin: { api: ApiClient; userId: string; secret: string },
  permissions: string[],
): Promise<SignedInAdmin> {
  const email = uniqueEmail('staff');
  // A fresh client per call: the step-up routes are throttled per address.
  const creator = new ApiClient(t.http);
  creator.token = superAdmin.api.token;
  const created = await creator.post('/admin/admins', {
    email,
    displayName: 'Staff Member',
    permissions,
    totpCode: await freshTotp(t, superAdmin),
  });
  if (created.status !== 201) {
    throw new Error(
      `create admin failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  const userId = created.body.data.admin.id as string;
  const temporary = created.body.data.temporaryPassword as string;

  const step1 = await new ApiClient(t.http).post('/auth/signin', {
    email,
    password: temporary,
    portal: 'admin',
  });
  const viaChallenge = new ApiClient(t.http);
  viaChallenge.token = step1.body.data.challengeToken;
  const enrol = await viaChallenge.post('/admin/me/totp/enrol');
  const secret = enrol.body.data.secret as string;
  const confirm = await viaChallenge.post('/admin/me/totp/confirm', {
    code: totpCode(secret),
  });
  if (confirm.status !== 200) {
    throw new Error(
      `confirm failed: ${confirm.status} ${JSON.stringify(confirm.body)}`,
    );
  }
  const api = new ApiClient(t.http);
  api.token = confirm.body.data.auth.tokens.accessToken;
  const changed = await api.post('/auth/change-password', {
    currentPassword: temporary,
    newPassword: PASSWORD,
  });
  if (changed.status !== 200) {
    throw new Error(
      `change-password failed: ${changed.status} ${JSON.stringify(changed.body)}`,
    );
  }
  // A password change ends every session; this one carries on with the new pair.
  api.token = changed.body.data.tokens.accessToken;
  return { api, email, userId, secret, password: PASSWORD };
}

/**
 * A signed-in rider. Made directly in the database — the vendor flow that
 * normally creates riders is irrelevant to the admin suites.
 */
export async function plainRider(t: TestApp): Promise<{ api: ApiClient }> {
  const bcrypt = await import('bcryptjs');
  const username = `rider${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  await t.ds.query(
    `INSERT INTO users (email, username, password_hash, display_name, role, is_email_verified, status)
     VALUES ($1, $2, $3, 'Rider', 'rider', true, 'active')`,
    [
      `${username}@riders.metromatrix.invalid`,
      username,
      await bcrypt.hash(PASSWORD, 4),
    ],
  );
  const api = new ApiClient(t.http);
  const res = await api.post('/auth/signin', {
    identifier: username,
    password: PASSWORD,
    portal: 'partner',
  });
  if (res.status !== 200) {
    throw new Error(`rider signin: ${res.status} ${JSON.stringify(res.body)}`);
  }
  api.token = res.body.data.tokens.accessToken;
  return { api };
}
