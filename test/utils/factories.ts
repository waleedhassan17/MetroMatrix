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

/** A partner whose email is verified — ready to onboard. */
export async function verifiedPartner(t: TestApp): Promise<SignedUp> {
  const p = await signup(t, { role: 'partner' });
  const { lastOtpFor } = await import('./outbox');
  const res = await p.api.post('/auth/verify-email', {
    otp: lastOtpFor(p.email),
  });
  if (res.status !== 200) {
    throw new Error(`verify failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return p;
}

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME ?? 'metromatrix-test';
let docSeq = 0;

/** What Cloudinary would hand back for an upload signed for this user. */
export function uploadedDocument(
  userId: string,
  purpose: 'business_document' | 'avatar' = 'business_document',
) {
  docSeq += 1;
  const publicId = `metromatrix/test/${userId}/${purpose}/doc${docSeq}`;
  return {
    url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1712345678/${publicId}.jpg`,
    publicId,
  };
}

let pmdcSeq = 0;
/** A PMDC number no other test business has used. */
export const nextPmdc = () =>
  `${String(Date.now() % 1e6).padStart(6, '0')}${++pmdcSeq}-P`;

/**
 * A doctor business. `pmdcNumber` is a getter, so every spread gets a fresh,
 * unique number; spreads for other business types must drop it
 * (`pmdcNumber: undefined`).
 */
export const DOCTOR_BUSINESS = {
  serviceType: 'healthcare',
  subType: 'doctor',
  name: "Dr. Sana's Clinic",
  phone: '042 35761234',
  city: 'Lahore',
  addressLine: '12-B Main Boulevard, Gulberg III',
  lat: 31.520369,
  lng: 74.358749,
  get pmdcNumber(): string {
    return nextPmdc();
  },
};

/** Upload (fake) and attach each kind; returns the created document ids. */
export async function addDocuments(p: SignedUp, kinds: string[]) {
  const ids: string[] = [];
  for (const kind of kinds) {
    const res = await p.api.post('/businesses/me/documents', {
      kind,
      ...uploadedDocument(p.userId),
    });
    if (res.status !== 201) {
      throw new Error(
        `add ${kind} failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    ids.push(res.body.data.id);
  }
  return ids;
}

/** A doctor's business submitted with every document → pending_approval. */
export async function submittedDoctor(t: TestApp) {
  const p = await verifiedPartner(t);
  const created = await p.api.post('/businesses', DOCTOR_BUSINESS);
  if (created.status !== 201) {
    throw new Error(
      `create failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  await addDocuments(p, [
    'cnic_front',
    'cnic_back',
    'pmdc_certificate',
    'degree_certificate',
  ]);
  const submitted = await p.api.post('/businesses/me/submit');
  if (submitted.status !== 200) {
    throw new Error(
      `submit failed: ${submitted.status} ${JSON.stringify(submitted.body)}`,
    );
  }
  return { partner: p, businessId: created.body.data.id as string };
}
