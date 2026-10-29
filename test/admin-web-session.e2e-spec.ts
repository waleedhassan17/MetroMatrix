import request from 'supertest';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import {
  adminChallenge,
  enrolledAdmin,
  freshTotp,
  totpCode,
} from './utils/admin';
import { seedAdmin } from './utils/admin';
import { signup } from './utils/factories';

const ORIGIN = process.env.ADMIN_WEB_ORIGIN!;
const CONSOLE = {
  Origin: ORIGIN,
  'X-Requested-With': 'metromatrix-admin',
  'X-Client': 'admin-web',
};

/** `mm_admin_rt=…` and its attributes from a Set-Cookie header. */
function cookieOf(res: request.Response) {
  const raw = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('mm_admin_rt='));
  if (!raw) return null;
  const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
  return {
    value: decodeURIComponent(pair.slice('mm_admin_rt='.length)),
    attrs: attrs.map((a) => a.toLowerCase()),
  };
}

/**
 * Super admin S9: the web console's cookie session — flags, rotation, reuse,
 * idle and absolute expiry, CSRF (header + Origin), and the separation from
 * the app's /auth/refresh-token.
 */
describe('Admin web console sessions (e2e)', () => {
  let t: TestApp;
  let root: Awaited<ReturnType<typeof enrolledAdmin>>;

  beforeAll(async () => {
    t = await createTestApp();
    root = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  const web = (path: string) => {
    const r = request(t.http).post(`/api/v1${path}`);
    for (const [k, v] of Object.entries(CONSOLE)) r.set(k, v);
    return r.set(
      'X-Forwarded-For',
      `10.200.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    );
  };

  /** Console sign-in: challenge, then TOTP with X-Client: admin-web. */
  async function consoleSignin() {
    const ch = await adminChallenge(t, root.email);
    const res = await web('/auth/admin/totp')
      .send({
        challengeToken: ch.challengeToken,
        code: await freshTotp(t, root),
      })
      .expect(200);
    return res;
  }

  const refresh = (
    cookie: string | null,
    headers: Record<string, string> = CONSOLE,
  ) => {
    const r = request(t.http).post('/api/v1/auth/web/refresh');
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    if (cookie) r.set('Cookie', `mm_admin_rt=${encodeURIComponent(cookie)}`);
    return r.set(
      'X-Forwarded-For',
      `10.201.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    );
  };

  it('sign-in with X-Client: admin-web sets the HttpOnly cookie and returns no refresh token', async () => {
    const res = await consoleSignin();
    expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
    expect(res.body.data.tokens.expiresIn).toBe(600);
    expect(JSON.stringify(res.body)).not.toContain(cookieOf(res)!.value);

    const cookie = cookieOf(res)!;
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(cookie.attrs).toEqual(
      expect.arrayContaining([
        'httponly',
        'secure',
        'samesite=strict',
        'path=/api/v1/auth/web',
        `max-age=${12 * 3600}`,
      ]),
    );
    const [row] = await t.ds.query(
      `SELECT client, session_started_at FROM refresh_tokens WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [cookie.value],
    );
    expect(row.client).toBe('admin_web');
    expect(row.session_started_at).not.toBeNull();
  });

  it('the app sign-in (no X-Client) still returns both tokens', async () => {
    const ch = await adminChallenge(t, root.email);
    const res = await new ApiClient(t.http)
      .post('/auth/admin/totp', {
        challengeToken: ch.challengeToken,
        code: await freshTotp(t, root),
      })
      .expect(200);
    expect(res.body.data.tokens.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.tokens.expiresIn).toBe(600);
    expect(cookieOf(res)).toBeNull();
  });

  it('refresh rotates the cookie; the old one replayed revokes the family', async () => {
    const first = cookieOf(await consoleSignin())!.value;
    const r1 = await refresh(first).expect(200);
    expect(r1.body.data).toEqual({
      accessToken: expect.any(String),
      expiresIn: 600,
    });
    const second = cookieOf(r1)!.value;
    expect(second).not.toBe(first);

    // The new access token works.
    const api = new ApiClient(t.http);
    api.token = r1.body.data.accessToken;
    await api.get('/admin/businesses').expect(200);

    // Replay the rotated cookie after the grace window: theft.
    await t.ds.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute'
        WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [first],
    );
    const reused = await refresh(first).expect(401);
    expect(reused.body.error.code).toBe('REFRESH_REUSED');
    expect(cookieOf(reused)?.value ?? '').toBe('');
    // …and the whole family is gone, including the newest cookie.
    const dead = await refresh(second).expect(401);
    expect(dead.body.error.code).toBe('REFRESH_REUSED');
  });

  it('no refresh for longer than the idle limit → 401 SESSION_IDLE', async () => {
    const c = cookieOf(await consoleSignin())!.value;
    await t.ds.query(
      `UPDATE refresh_tokens SET created_at = now() - interval '31 minutes'
        WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [c],
    );
    const res = await refresh(c).expect(401);
    expect(res.body.error.code).toBe('SESSION_IDLE');
  });

  it('past ADMIN_REFRESH_TTL from sign-in → 401 REFRESH_INVALID, even with fresh refreshes', async () => {
    const c = cookieOf(await consoleSignin())!.value;
    await t.ds.query(
      `UPDATE refresh_tokens SET session_started_at = now() - interval '13 hours'
        WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [c],
    );
    const res = await refresh(c).expect(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });

  it('CSRF: a missing header or another Origin is refused before the cookie is touched', async () => {
    const c = cookieOf(await consoleSignin())!.value;
    const noHeader = await refresh(c, { Origin: ORIGIN }).expect(403);
    expect(noHeader.body.error.code).toBe('CSRF_REJECTED');
    const wrongOrigin = await refresh(c, {
      Origin: 'https://evil.example',
      'X-Requested-With': 'metromatrix-admin',
    }).expect(403);
    expect(wrongOrigin.body.error.code).toBe('CSRF_REJECTED');
    const noOrigin = await refresh(c, {
      'X-Requested-With': 'metromatrix-admin',
    }).expect(403);
    expect(noOrigin.body.error.code).toBe('CSRF_REJECTED');
    // The cookie was not spent by the refused attempts.
    await refresh(c).expect(200);

    // A console sign-in from another origin is refused too.
    const ch = await adminChallenge(t, root.email);
    const evil = await request(t.http)
      .post('/api/v1/auth/admin/totp')
      .set('X-Client', 'admin-web')
      .set('Origin', 'https://evil.example')
      .set('X-Requested-With', 'metromatrix-admin')
      .send({
        challengeToken: ch.challengeToken,
        code: await freshTotp(t, root),
      })
      .expect(403);
    expect(evil.body.error.code).toBe('CSRF_REJECTED');
  });

  it('console and app refresh tokens never cross over', async () => {
    const consoleToken = cookieOf(await consoleSignin())!.value;
    const viaApp = await new ApiClient(t.http)
      .post('/auth/refresh-token', { refreshToken: consoleToken })
      .expect(401);
    expect(viaApp.body.error.code).toBe('REFRESH_INVALID');

    const ch = await adminChallenge(t, root.email);
    const app = await new ApiClient(t.http)
      .post('/auth/admin/totp', {
        challengeToken: ch.challengeToken,
        code: await freshTotp(t, root),
      })
      .expect(200);
    const viaCookie = await refresh(app.body.data.tokens.refreshToken).expect(
      401,
    );
    expect(viaCookie.body.error.code).toBe('REFRESH_INVALID');
  });

  it('customer refresh tokens are refused on the cookie endpoint', async () => {
    const customer = await signup(t);
    const res = await refresh(customer.refreshToken).expect(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });

  it('first enrolment through the console also lands in a cookie session', async () => {
    const { email } = await seedAdmin(t);
    const ch = await adminChallenge(t, email);
    const viaChallenge = new ApiClient(t.http);
    viaChallenge.token = ch.challengeToken;
    const enrol = await viaChallenge.post('/admin/me/totp/enrol').expect(200);
    const res = await web('/admin/me/totp/confirm')
      .set('Authorization', `Bearer ${ch.challengeToken}`)
      .send({ code: totpCode(enrol.body.data.secret) })
      .expect(200);
    expect(res.body.data.recoveryCodes).toHaveLength(10);
    expect(res.body.data.auth.tokens.refreshToken).toBeUndefined();
    expect(cookieOf(res)?.attrs).toContain('httponly');
  });

  it('logout revokes the session and clears the cookie; idempotent', async () => {
    const signin = await consoleSignin();
    const c = cookieOf(signin)!.value;
    const access = signin.body.data.tokens.accessToken as string;
    const out = await web('/auth/web/logout')
      .set('Cookie', `mm_admin_rt=${encodeURIComponent(c)}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(out.body.data).toEqual({ signedOut: true });
    const cleared = cookieOf(out)!;
    expect(cleared.value).toBe('');
    expect(
      cleared.attrs.some((a) => a.startsWith('expires=thu, 01 jan 1970')),
    ).toBe(true);

    await refresh(c).expect(401);
    const api = new ApiClient(t.http);
    api.token = access;
    await api.get('/auth/me').expect(401);
    await web('/auth/web/logout').expect(200);
  });
});
