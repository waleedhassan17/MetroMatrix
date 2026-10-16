import { v2 as cloudinary } from 'cloudinary';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import {
  addDocuments,
  DOCTOR_BUSINESS,
  signin,
  signup,
  uploadedDocument,
  verifiedPartner,
} from './utils/factories';

describe('Partner onboarding (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('the full path: create → 422 lists exactly the missing kinds → add docs → submit → pending → PATCH 409', async () => {
    const p = await verifiedPartner(t);

    const created = await p.api
      .post('/businesses', DOCTOR_BUSINESS)
      .expect(201);
    expect(created.body.data).toMatchObject({
      name: "Dr. Sana's Clinic",
      slug: expect.stringMatching(/^dr-sanas-clinic-[0-9a-f]{5}$/),
      serviceType: 'healthcare',
      subType: 'doctor',
      phone: '+924235761234',
      lat: 31.520369,
      lng: 74.358749,
      status: 'draft',
      documents: [],
      missingDocuments: [
        'cnic_front',
        'cnic_back',
        'pmdc_certificate',
        'degree_certificate',
      ],
    });

    const none = await p.api.post('/businesses/me/submit').expect(422);
    expect(none.body.error.code).toBe('DOCUMENTS_MISSING');
    expect(none.body.error.details.missing).toEqual([
      'cnic_front',
      'cnic_back',
      'pmdc_certificate',
      'degree_certificate',
    ]);

    // QA #17: a doctor without the PMDC certificate.
    await addDocuments(p, ['cnic_front', 'cnic_back', 'degree_certificate']);
    const noPmdc = await p.api.post('/businesses/me/submit').expect(422);
    expect(noPmdc.body.error.details.missing).toEqual(['pmdc_certificate']);

    await addDocuments(p, ['pmdc_certificate']);
    const submitted = await p.api.post('/businesses/me/submit').expect(200);
    expect(submitted.body.data.status).toBe('pending_approval');
    expect(submitted.body.data.submittedAt).toEqual(expect.any(String));
    expect(submitted.body.data.missingDocuments).toEqual([]);

    const status = await p.api.get('/businesses/me/status').expect(200);
    expect(status.body.data).toEqual({
      status: 'pending_approval',
      rejectionReason: null,
      suspensionReason: null,
    });

    const patch = await p.api
      .patch('/businesses/me', { city: 'Karachi' })
      .expect(409);
    expect(patch.body.error.code).toBe('BUSINESS_NOT_EDITABLE');
    const doc = await p.api
      .post('/businesses/me/documents', {
        kind: 'cnic_front',
        ...uploadedDocument(p.userId),
      })
      .expect(409);
    expect(doc.body.error.code).toBe('BUSINESS_NOT_EDITABLE');
    const again = await p.api.post('/businesses/me/submit').expect(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');

    // The auth responses carry the business summary for a partner.
    const me = await p.api.get('/auth/me').expect(200);
    expect(me.body.data.business).toMatchObject({
      id: created.body.data.id,
      status: 'pending_approval',
      serviceType: 'healthcare',
      subType: 'doctor',
    });
    const relogin = await signin(t, p.email, 'partner');
    expect(relogin.res.body.data.business.status).toBe('pending_approval');
  });

  it('customers cannot reach /businesses (403); unverified partners are told to verify', async () => {
    const customer = await signup(t);
    const res = await customer.api
      .post('/businesses', DOCTOR_BUSINESS)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await customer.api.get('/businesses/me').expect(403);

    const unverified = await signup(t, { role: 'partner' });
    const r2 = await unverified.api
      .post('/businesses', DOCTOR_BUSINESS)
      .expect(403);
    expect(r2.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('one business per partner: a second one is 409 BUSINESS_EXISTS', async () => {
    const p = await verifiedPartner(t);
    await p.api.post('/businesses', DOCTOR_BUSINESS).expect(201);
    const res = await p.api
      .post('/businesses', { ...DOCTOR_BUSINESS, name: 'Second' })
      .expect(409);
    expect(res.body.error.code).toBe('BUSINESS_EXISTS');
  });

  it('a sub-type must belong to its service', async () => {
    const p = await verifiedPartner(t);
    const res = await p.api
      .post('/businesses', {
        ...DOCTOR_BUSINESS,
        serviceType: 'food',
        pmdcNumber: undefined,
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields.subType).toBeDefined();
  });

  it('document URLs must be our cloud, the caller’s own folder, and a kind the sub-type uses', async () => {
    const p = await verifiedPartner(t);
    const other = await verifiedPartner(t);
    await p.api.post('/businesses', DOCTOR_BUSINESS).expect(201);
    const mine = uploadedDocument(p.userId);

    const foreignCloud = await p.api
      .post('/businesses/me/documents', {
        kind: 'cnic_front',
        url: mine.url.replace('metromatrix-test', 'evil-cloud'),
        publicId: mine.publicId,
      })
      .expect(400);
    expect(foreignCloud.body.error.code).toBe('VALIDATION_FAILED');

    const theirs = uploadedDocument(other.userId);
    const foreignFolder = await p.api
      .post('/businesses/me/documents', { kind: 'cnic_front', ...theirs })
      .expect(400);
    expect(foreignFolder.body.error.code).toBe('VALIDATION_FAILED');

    const wrongKind = await p.api
      .post('/businesses/me/documents', { kind: 'pfa_licence', ...mine })
      .expect(400);
    expect(wrongKind.body.error.details.allowed).toContain('pmdc_certificate');
  });

  it('re-uploading a kind replaces it; a document can be removed while draft', async () => {
    const p = await verifiedPartner(t);
    await p.api.post('/businesses', DOCTOR_BUSINESS).expect(201);
    const [first] = await addDocuments(p, ['cnic_front']);
    const [second] = await addDocuments(p, ['cnic_front']);
    const detail = await p.api.get('/businesses/me').expect(200);
    expect(detail.body.data.documents.map((d: any) => d.id)).toEqual([second]);
    expect(first).not.toBe(second);

    await p.api.delete(`/businesses/me/documents/${second}`).expect(200);
    await p.api.delete(`/businesses/me/documents/${second}`).expect(404);
  });

  it('home kitchen: two kitchen photos required, at most four', async () => {
    const p = await verifiedPartner(t);
    await p.api
      .post('/businesses', {
        ...DOCTOR_BUSINESS,
        serviceType: 'food',
        subType: 'home_kitchen',
        pmdcNumber: undefined,
        name: 'Ammi Ka Khana',
      })
      .expect(201);
    await addDocuments(p, ['cnic_front', 'cnic_back', 'kitchen_photo']);
    const one = await p.api.post('/businesses/me/submit').expect(422);
    expect(one.body.error.details.missing).toEqual(['kitchen_photo']);

    await addDocuments(p, ['kitchen_photo', 'kitchen_photo', 'kitchen_photo']);
    const fifth = await p.api
      .post('/businesses/me/documents', {
        kind: 'kitchen_photo',
        ...uploadedDocument(p.userId),
      })
      .expect(400);
    expect(fifth.body.error.code).toBe('VALIDATION_FAILED');
    await p.api.post('/businesses/me/submit').expect(200);
  });

  it('store: CNIC both sides plus NTN or a shop photo', async () => {
    const p = await verifiedPartner(t);
    await p.api
      .post('/businesses', {
        ...DOCTOR_BUSINESS,
        serviceType: 'shopping',
        subType: 'store',
        pmdcNumber: undefined,
        name: 'Hafeez General Store',
      })
      .expect(201);
    await addDocuments(p, ['cnic_front', 'cnic_back']);
    const res = await p.api.post('/businesses/me/submit').expect(422);
    expect(res.body.error.details.missing).toEqual([
      'ntn_certificate|shop_photo',
    ]);
    await addDocuments(p, ['shop_photo']);
    await p.api.post('/businesses/me/submit').expect(200);
  });

  it('PATCH while draft can change the type; it must stay consistent', async () => {
    const p = await verifiedPartner(t);
    await p.api.post('/businesses', DOCTOR_BUSINESS).expect(201);
    const bad = await p.api
      .patch('/businesses/me', { subType: 'store' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const ok = await p.api
      .patch('/businesses/me', {
        serviceType: 'shopping',
        subType: 'store',
        name: 'Renamed',
      })
      .expect(200);
    expect(ok.body.data).toMatchObject({
      serviceType: 'shopping',
      subType: 'store',
      name: 'Renamed',
      slug: expect.stringMatching(/^renamed-/),
    });
  });

  it('sign-upload returns a signature Cloudinary will accept for the caller’s folder', async () => {
    const p = await verifiedPartner(t);
    const res = await p.api
      .post('/media/sign-upload', { purpose: 'business_document' })
      .expect(200);
    const s = res.body.data;
    expect(s).toMatchObject({
      cloudName: 'metromatrix-test',
      apiKey: '123456789012345',
      folder: `metromatrix/test/${p.userId}/business_document`,
      publicIdPrefix: `metromatrix/test/${p.userId}/business_document/`,
      uploadUrl: 'https://api.cloudinary.com/v1_1/metromatrix-test/auto/upload',
    });
    const expected = cloudinary.utils.api_sign_request(
      {
        allowed_formats: s.allowedFormats,
        folder: s.folder,
        timestamp: s.timestamp,
      },
      'test-only-cloudinary-secret',
    );
    expect(s.signature).toBe(expected);

    await p.api.post('/media/sign-upload', { purpose: 'nope' }).expect(400);
    await new ApiClient(t.http)
      .post('/media/sign-upload', { purpose: 'avatar' })
      .expect(401);
  });

  it('PATCH /users/me normalises the phone and only takes an avatar from the caller’s own avatar folder', async () => {
    const u = await signup(t);
    const ok = await u.api
      .patch('/users/me', {
        displayName: 'Ayesha K.',
        phone: '0312 4890176',
        avatarUrl: uploadedDocument(u.userId, 'avatar').url,
      })
      .expect(200);
    expect(ok.body.data).toMatchObject({
      displayName: 'Ayesha K.',
      phone: '+923124890176',
      avatarUrl: expect.stringContaining(`/${u.userId}/avatar/`),
    });

    const bad = await u.api
      .patch('/users/me', {
        avatarUrl: uploadedDocument(u.userId, 'business_document').url,
      })
      .expect(400);
    expect(bad.body.error.details.fields.avatarUrl).toBeDefined();

    const cleared = await u.api
      .patch('/users/me', { avatarUrl: null })
      .expect(200);
    expect(cleared.body.data.avatarUrl).toBeNull();
  });

  it('push tokens: upsert, move between accounts on one phone, delete on sign-out', async () => {
    const a = await signup(t);
    const b = await signup(t);
    const token = `ExponentPushToken[${'x'.repeat(22)}${Date.now()}]`;

    await a.api
      .put('/users/me/devices', { expoPushToken: token, platform: 'android' })
      .expect(200);
    await a.api
      .put('/users/me/devices', { expoPushToken: token, platform: 'android' })
      .expect(200);
    await b.api
      .put('/users/me/devices', { expoPushToken: token, platform: 'ios' })
      .expect(200);
    const rows = await t.ds.query(
      `SELECT user_id, platform FROM user_devices WHERE expo_push_token = $1`,
      [token],
    );
    expect(rows).toEqual([{ user_id: b.userId, platform: 'ios' }]);

    const notMine = await a.api
      .delete(`/users/me/devices/${encodeURIComponent(token)}`)
      .expect(200);
    expect(notMine.body.data).toEqual({ removed: false });
    const mine = await b.api
      .delete(`/users/me/devices/${encodeURIComponent(token)}`)
      .expect(200);
    expect(mine.body.data).toEqual({ removed: true });

    await a.api
      .put('/users/me/devices', {
        expoPushToken: 'not-a-token',
        platform: 'android',
      })
      .expect(400);
  });
});
