import { authenticator } from 'otplib';
import { seedSuperAdmin } from '../../src/database/seeds/super-admin';
import { ApiClient, TestApp } from './test-app';
import { PASSWORD, uniqueEmail } from './factories';

export const totpCode = (secret: string) => authenticator.generate(secret);

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
