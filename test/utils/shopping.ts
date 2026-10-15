import { TestApp } from './test-app';
import { buildPkIban } from '../../src/modules/shopping/common/payment-account.validation';
import {
  addDocuments,
  DOCTOR_BUSINESS,
  SignedUp,
  signup,
  verifiedPartner,
} from './factories';
import { enrolledAdmin } from './admin';
import { lastOtpFor } from './outbox';

export type PartnerKind = 'store' | 'doctor' | 'restaurant';

const KINDS: Record<
  PartnerKind,
  { serviceType: string; subType: string; docs: string[] }
> = {
  store: {
    serviceType: 'shopping',
    subType: 'store',
    docs: ['cnic_front', 'cnic_back', 'ntn_certificate'],
  },
  doctor: {
    serviceType: 'healthcare',
    subType: 'doctor',
    docs: ['cnic_front', 'cnic_back', 'pmdc_certificate', 'degree_certificate'],
  },
  restaurant: {
    serviceType: 'food',
    subType: 'restaurant',
    docs: ['cnic_front', 'cnic_back', 'pfa_licence', 'storefront_photo'],
  },
};

export type Admin = Awaited<ReturnType<typeof enrolledAdmin>>;

let storeSeq = 0;

/** A partner of the given kind, through signup → documents → submit → approve. */
export async function approvedPartner(
  t: TestApp,
  admin: Admin,
  kind: PartnerKind = 'store',
  name?: string,
): Promise<SignedUp & { businessId: string }> {
  storeSeq += 1;
  const spec = KINDS[kind];
  const p = await verifiedPartner(t);
  const created = await p.api.post('/businesses', {
    ...DOCTOR_BUSINESS,
    serviceType: spec.serviceType,
    subType: spec.subType,
    name: name ?? `Test ${kind} ${storeSeq}`,
  });
  if (created.status !== 201) {
    throw new Error(
      `create failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  await addDocuments(p, spec.docs);
  const submitted = await p.api.post('/businesses/me/submit');
  if (submitted.status !== 200) {
    throw new Error(
      `submit failed: ${submitted.status} ${JSON.stringify(submitted.body)}`,
    );
  }
  const approved = await admin.api.post(
    `/admin/businesses/${created.body.data.id}/approve`,
  );
  if (approved.status !== 200) {
    throw new Error(
      `approve failed: ${approved.status} ${JSON.stringify(approved.body)}`,
    );
  }
  return { ...p, businessId: created.body.data.id };
}

/** A verified customer, ready to shop. */
export async function shopper(t: TestApp): Promise<SignedUp> {
  const c = await signup(t);
  const res = await c.api.post('/auth/verify-email', {
    otp: lastOtpFor(c.email),
  });
  if (res.status !== 200) throw new Error(`verify failed: ${res.status}`);
  return c;
}

/** Shape-correct Cloudinary URL for an upload signed for this user + purpose. */
let assetSeq = 0;
export function asset(userId: string, purpose: string) {
  assetSeq += 1;
  const publicId = `metromatrix/test/${userId}/${purpose}/a${assetSeq}`;
  return {
    url: `https://res.cloudinary.com/metromatrix-test/image/upload/v1712345678/${publicId}.jpg`,
    publicId,
  };
}

export type Partner = SignedUp & { businessId: string };

const categoryIds = new Map<string, string>();
/** A seeded category id by slug. */
export async function categoryId(t: TestApp, slug: string): Promise<string> {
  if (!categoryIds.size) {
    const rows = await t.ds.query(`SELECT id, slug FROM shop_categories`);
    rows.forEach((r: { id: string; slug: string }) =>
      categoryIds.set(r.slug, r.id),
    );
  }
  const id = categoryIds.get(slug);
  if (!id) throw new Error(`no category ${slug}`);
  return id;
}

/** An active product with one image; pass variants/prices to taste. */
export async function listProduct(
  t: TestApp,
  p: Partner,
  body: Record<string, unknown> & { name: string },
): Promise<any> {
  const res = await p.api.post('/shop/partner/products', {
    description: 'A fixture product.',
    categoryId: await categoryId(t, 'women-kurtas-tunics'),
    basePrice: 1000,
    status: 'active',
    images: [asset(p.userId, 'product_image')],
    ...body,
  });
  if (res.status !== 201) {
    throw new Error(
      `product failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data;
}

/** Save a delivery address for a customer; returns its id. */
export async function addAddress(
  c: SignedUp,
  over: Record<string, unknown> = {},
): Promise<string> {
  const res = await c.api.post('/addresses', {
    label: 'home',
    fullName: 'Ayesha Khan',
    phone: '0312 4890176',
    city: 'Lahore',
    area: 'Gulberg III',
    line1: 'House 12, Street 4',
    ...over,
  });
  if (res.status !== 201) {
    throw new Error(
      `address failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.id;
}

/** The partner's store row id and slug. */
export async function storeOf(
  p: Partner,
): Promise<{ id: string; slug: string }> {
  const res = await p.api.get('/shop/partner/store');
  return { id: res.body.data.id, slug: res.body.data.slug };
}

/** A valid PK IBAN, unique per call. */
let ibanSeq = 0;
export function testIban(): string {
  ibanSeq += 1;
  return buildPkIban('MEZN', `7${String(ibanSeq).padStart(15, '0')}`);
}
