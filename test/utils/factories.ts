import { createHash } from 'crypto';
import { ApiClient, TestApp } from './test-app';

export const PASSWORD = 'Secret123';

let seq = 0;
export function uniqueEmail(prefix = 'user'): string {
  seq += 1;
  return `${prefix}.${Date.now().toString(36)}.${seq}@example.com`;
}

export interface SignedUp {
  api: ApiClient;
  email: string;
  password: string;
  userId: string;
  refreshToken: string;
  body: any;
}

/** POST /auth/signup on a fresh client and keep its access token. */
export async function signup(
  t: TestApp,
  over: Partial<{
    email: string;
    password: string;
    displayName: string;
    role: 'customer' | 'partner';
    phone: string;
  }> = {},
): Promise<SignedUp> {
  const api = new ApiClient(t.http);
  const email = over.email ?? uniqueEmail(over.role ?? 'customer');
  const password = over.password ?? PASSWORD;
  const res = await api.post('/auth/signup', {
    email,
    password,
    displayName: over.displayName ?? 'Test User',
    role: over.role ?? 'customer',
    ...(over.phone ? { phone: over.phone } : {}),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  api.token = res.body.data.tokens.accessToken;
  return {
    api,
    email,
    password,
    userId: res.body.data.user.id,
    refreshToken: res.body.data.tokens.refreshToken,
    body: res.body,
  };
}

/** Sign in on a fresh client (a second device). */
export async function signin(
  t: TestApp,
  email: string,
  portal: 'customer' | 'partner' | 'admin',
  password = PASSWORD,
) {
  const api = new ApiClient(t.http);
  const res = await api.post('/auth/signin', { email, password, portal });
  if (res.status === 200 && res.body.data?.tokens) {
    api.token = res.body.data.tokens.accessToken;
  }
  return { api, res };
}

export const sha256 = (s: string) =>
  createHash('sha256').update(s).digest('hex');
