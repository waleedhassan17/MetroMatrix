import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { signup, uniqueEmail } from './utils/factories';
import { FakeGoogleVerifier, googleToken } from './utils/fake-google';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';

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

  it('a Google-only account may set its first password', async () => {
    const email = uniqueEmail('google');
    const res = await new ApiClient(t.http)
      .post('/auth/google', {
        idToken: googleToken({ sub: `sub-${email}`, email }),
      })
      .expect(200);
    const api = new ApiClient(t.http);
    api.token = res.body.data.tokens.accessToken;
    await api
      .post('/auth/change-password', { newPassword: 'First1Password' })
      .expect(200);
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
