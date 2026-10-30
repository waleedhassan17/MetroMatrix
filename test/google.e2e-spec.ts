import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { signup, uniqueEmail } from './utils/factories';
import { FakeGoogleVerifier, googleToken } from './utils/fake-google';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';
import { lastVerifyTokenFor } from './utils/outbox';

describe('Google sign-in (e2e, fake verifier)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) =>
        b
          .overrideProvider(GoogleTokenVerifier)
          .useValue(new FakeGoogleVerifier()),
    });
  });
  afterAll(() => t.close());

  it('a new Google user becomes a verified customer with tokens; the same Google account signs back in', async () => {
    const email = uniqueEmail('google');
    const idToken = googleToken({
      sub: `sub-${email}`,
      email,
      name: 'Zara Ahmed',
    });

    const first = await new ApiClient(t.http)
      .post('/auth/google', { idToken })
      .expect(200);
    expect(first.body.data.user).toMatchObject({
      email,
      role: 'customer',
      isEmailVerified: true,
      hasPassword: false,
      displayName: 'Zara Ahmed',
    });
    expect(first.body.data.tokens.accessToken).toEqual(expect.any(String));

    const again = await new ApiClient(t.http)
      .post('/auth/google', { idToken })
      .expect(200);
    expect(again.body.data.user.id).toBe(first.body.data.user.id);
  });

  it("a partner's email is refused with WRONG_PORTAL", async () => {
    const partner = await signup(t, { role: 'partner' });
    const res = await new ApiClient(t.http)
      .post('/auth/google', {
        idToken: googleToken({
          sub: `sub-${partner.email}`,
          email: partner.email,
        }),
      })
      .expect(403);
    expect(res.body.error.code).toBe('WRONG_PORTAL');
  });

  it('pre-account hijack: the victim continuing with Google locks the squatter out completely', async () => {
    // The attacker signs up first with the victim's address and keeps the session.
    const victimEmail = uniqueEmail('victim');
    const attacker = await signup(t, {
      email: victimEmail,
      displayName: 'Not The Victim',
      phone: '03001112233',
    });

    const victim = await new ApiClient(t.http)
      .post('/auth/google', {
        idToken: googleToken({
          sub: `sub-${victimEmail}`,
          email: victimEmail,
          name: 'Real Owner',
        }),
      })
      .expect(200);
    expect(victim.body.data.user).toMatchObject({
      id: attacker.userId,
      isEmailVerified: true,
      hasPassword: false,
      displayName: 'Real Owner',
      phone: null,
    });

    // The squatter's password no longer signs in …
    const pw = await new ApiClient(t.http)
      .post('/auth/signin', {
        email: victimEmail,
        password: attacker.password,
        portal: 'customer',
      })
      .expect(401);
    expect(pw.body.error.code).toBe('INVALID_CREDENTIALS');
    // … their access token is dead at once …
    const me = await attacker.api.get('/auth/me').expect(401);
    expect(me.body.error.code).toBe('TOKEN_REVOKED');
    // … and so is their refresh token.
    const refresh = await new ApiClient(t.http)
      .post('/auth/refresh-token', { refreshToken: attacker.refreshToken })
      .expect(401);
    expect(['REFRESH_INVALID', 'REFRESH_REUSED']).toContain(
      refresh.body.error.code,
    );

    // The victim's own session works.
    const owner = new ApiClient(t.http);
    owner.token = victim.body.data.tokens.accessToken;
    await owner.get('/auth/me').expect(200);
  });

  it('a VERIFIED password account linked by Google keeps its password and other sessions', async () => {
    const u = await signup(t);
    await u.api
      .post('/auth/verify-email', { token: lastVerifyTokenFor(u.email) })
      .expect(200);
    await new ApiClient(t.http)
      .post('/auth/google', {
        idToken: googleToken({ sub: `sub-${u.email}`, email: u.email }),
      })
      .expect(200);
    await u.api.get('/auth/me').expect(200);
    await new ApiClient(t.http)
      .post('/auth/signin', {
        email: u.email,
        password: u.password,
        portal: 'customer',
      })
      .expect(200);
  });

  it('a forged token is INVALID_CREDENTIALS', async () => {
    const res = await new ApiClient(t.http)
      .post('/auth/google', { idToken: 'eyJhbGciOiJSUzI1NiJ9.forged.token' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('a Google-only account sets a first password without currentPassword, and deletes itself with a fresh Google token', async () => {
    const email = uniqueEmail('google');
    const idToken = googleToken({ sub: `sub-${email}`, email });
    const res = await new ApiClient(t.http)
      .post('/auth/google', { idToken })
      .expect(200);
    const api = new ApiClient(t.http);
    api.token = res.body.data.tokens.accessToken;

    // Deleting needs the Google account that owns this user.
    const other = googleToken({ sub: 'someone-else', email: uniqueEmail('x') });
    await api.delete('/auth/account', { idToken: other }).expect(403);
    await api.delete('/auth/account', { idToken }).expect(200);
    await api.get('/auth/me').expect(401);
  });

  it('a Google-only account sets its first password only with a fresh token for ITS Google account', async () => {
    const email = uniqueEmail('google');
    const idToken = googleToken({ sub: `sub-${email}`, email });
    const res = await new ApiClient(t.http)
      .post('/auth/google', { idToken })
      .expect(200);
    const api = new ApiClient(t.http);
    api.token = res.body.data.tokens.accessToken;

    // A session alone is not enough …
    const bare = await api
      .post('/auth/change-password', { newPassword: 'First1Password' })
      .expect(403);
    expect(bare.body.error.code).toBe('INVALID_CREDENTIALS');
    // … nor is someone else's Google account.
    const otherSub = googleToken({ sub: 'someone-else', email });
    await api
      .post('/auth/change-password', {
        newPassword: 'First1Password',
        idToken: otherSub,
      })
      .expect(403);

    const ok = await api
      .post('/auth/change-password', {
        newPassword: 'First1Password',
        idToken,
      })
      .expect(200);
    api.token = ok.body.data.tokens.accessToken;
    const me = await api.get('/auth/me').expect(200);
    expect(me.body.data.user.hasPassword).toBe(true);
    const signin = await new ApiClient(t.http)
      .post('/auth/signin', {
        email,
        password: 'First1Password',
        portal: 'customer',
      })
      .expect(200);
    expect(signin.body.data.user.id).toBe(res.body.data.user.id);
  });
});
