import { createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import {
  signup,
  verifiedPartner,
  DOCTOR_BUSINESS,
  addDocuments,
} from './utils/factories';
import { Admin, approvedPartner, asset } from './utils/shopping';
import { buildPkIban } from '../src/modules/shopping/common/payment-account.validation';

describe('Shopping P1: stores, payment accounts, collections (e2e)', () => {
  let t: TestApp;
  let admin: Admin;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('approving a shopping business opens its store; food and healthcare get none', async () => {
    const store = await approvedPartner(t, admin, 'store', 'Kurta Corner');
    const [row] = await t.ds.query(
      `SELECT s.slug, b.slug AS business_slug, s.cod_enabled, s.cod_limit, s.return_window_days,
              s.brand_color, s.on_brand_color
         FROM stores s JOIN businesses b ON b.id = s.business_id WHERE s.business_id = $1`,
      [store.businessId],
    );
    expect(row).toMatchObject({
      cod_enabled: true,
      cod_limit: 10000,
      return_window_days: 7,
      brand_color: '#16151A',
      on_brand_color: '#FFFFFF',
    });
    expect(row.slug).toBe(row.business_slug);

    const profile = await store.api.get('/shop/partner/store').expect(200);
    expect(profile.body.data).toMatchObject({
      name: 'Kurta Corner',
      slug: row.slug,
    });

    for (const kind of ['doctor', 'restaurant'] as const) {
      const other = await approvedPartner(t, admin, kind);
      const [{ n }] = await t.ds.query(
        `SELECT count(*)::int AS n FROM stores WHERE business_id = $1`,
        [other.businessId],
      );
      expect(n).toBe(0);
      const res = await other.api.get('/shop/partner/store').expect(403);
      expect(res.body.error).toMatchObject({
        code: 'WRONG_SERVICE',
        details: {
          required: 'shopping',
          actual: kind === 'doctor' ? 'healthcare' : 'food',
        },
      });
    }
  });

  it('only approved shopping partners reach /shop/partner', async () => {
    const customer = await signup(t);
    expect(
      (await customer.api.get('/shop/partner/store').expect(403)).body.error
        .code,
    ).toBe('FORBIDDEN');

    const pending = await verifiedPartner(t);
    await pending.api
      .post('/businesses', {
        ...DOCTOR_BUSINESS,
        serviceType: 'shopping',
        subType: 'store',
        name: 'Not yet',
      })
      .expect(201);
    await addDocuments(pending, ['cnic_front', 'cnic_back', 'shop_photo']);
    await pending.api.post('/businesses/me/submit').expect(200);
    const res = await pending.api.get('/shop/partner/store').expect(403);
    expect(res.body.error.code).toBe('BUSINESS_NOT_APPROVED');
  });

  it('a store missing its row (approved before Shopping) is created on first use', async () => {
    const store = await approvedPartner(t, admin, 'store');
    await t.ds.query(`DELETE FROM stores WHERE business_id = $1`, [
      store.businessId,
    ]);
    await store.api.get('/shop/partner/store').expect(200);
    const [{ n }] = await t.ds.query(
      `SELECT count(*)::int AS n FROM stores WHERE business_id = $1`,
      [store.businessId],
    );
    expect(n).toBe(1);
  });

  it('branding: brandColor must pass AA contrast; onBrandColor is derived; images must be owned uploads', async () => {
    const store = await approvedPartner(t, admin, 'store');
    const grey = await store.api
      .patch('/shop/partner/store', { brandColor: '#777777' })
      .expect(400);
    expect(grey.body.error.code).toBe('VALIDATION_FAILED');
    expect(grey.body.error.details.fields.brandColor).toBeDefined();

    const rose = await store.api
      .patch('/shop/partner/store', { brandColor: '#be123c' })
      .expect(200);
    expect(rose.body.data).toMatchObject({
      brandColor: '#BE123C',
      onBrandColor: '#FFFFFF',
    });
    const yellow = await store.api
      .patch('/shop/partner/store', { brandColor: '#FACC15' })
      .expect(200);
    expect(yellow.body.data.onBrandColor).toBe('#16151A');

    const logo = asset(store.userId, 'store_branding');
    const ok = await store.api
      .patch('/shop/partner/store', {
        logoUrl: logo.url,
        tagline: 'Hand-stitched in Lahore',
        socials: { instagram: '@kurtacorner' },
      })
      .expect(200);
    expect(ok.body.data).toMatchObject({
      logoUrl: logo.url,
      tagline: 'Hand-stitched in Lahore',
      socials: { instagram: '@kurtacorner' },
    });
    await store.api
      .patch('/shop/partner/store', {
        logoUrl: asset(store.userId, 'avatar').url,
      })
      .expect(400);
  });

  it('settings: cities normalised and de-duplicated; dispatch range checked', async () => {
    const store = await approvedPartner(t, admin, 'store');
    const res = await store.api
      .patch('/shop/partner/store/settings', {
        deliveryCities: [
          ' lahore',
          'LAHORE',
          'rawalpindi  ',
          'dera ghazi   khan',
        ],
        shippingFlatFee: 200,
        freeShippingOver: 5000,
        codLimit: 15000,
        returnWindowDays: 14,
      })
      .expect(200);
    expect(res.body.data).toMatchObject({
      deliveryCities: ['Lahore', 'Rawalpindi', 'Dera Ghazi Khan'],
      shippingFlatFee: 200,
      freeShippingOver: 5000,
      codLimit: 15000,
      returnWindowDays: 14,
    });
    await store.api
      .patch('/shop/partner/store/settings', { returnWindowDays: 31 })
      .expect(400);
    await store.api
      .patch('/shop/partner/store/settings', {
        dispatchDaysMin: 5,
        dispatchDaysMax: 2,
      })
      .expect(400);
    const cleared = await store.api
      .patch('/shop/partner/store/settings', { freeShippingOver: null })
      .expect(200);
    expect(cleared.body.data.freeShippingOver).toBeNull();
  });

  it('payment accounts: validated per kind, normalised, max 4 active', async () => {
    const store = await approvedPartner(t, admin, 'store');
    const iban = buildPkIban('MEZN', '0001234567890123');

    const badIban = await store.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Kurta Corner',
        accountNumber: iban.slice(0, -1) + ((Number(iban.slice(-1)) + 1) % 10),
        bankName: 'Meezan Bank',
      })
      .expect(400);
    expect(badIban.body.error.details.fields.accountNumber).toBeDefined();
    await store.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'bank',
        accountTitle: 'X store',
        accountNumber: iban,
      })
      .expect(400); // bank needs bankName
    await store.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'jazzcash',
        accountTitle: 'Kurta Corner',
        accountNumber: '042 35761234',
      })
      .expect(400);

    const bank = await store.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Kurta Corner',
        accountNumber: iban.toLowerCase().replace(/(.{4})/g, '$1 '),
        bankName: 'Meezan Bank',
      })
      .expect(201);
    expect(bank.body.data).toMatchObject({
      kind: 'bank',
      accountNumber: iban,
      isActive: true,
    });

    const wallets = [
      ['jazzcash', '0301 1111111'],
      ['easypaisa', '0302 2222222'],
      ['raast', '0303 3333333'],
    ];
    for (const [kind, number] of wallets) {
      const res = await store.api
        .post('/shop/partner/store/payment-accounts', {
          kind,
          accountTitle: 'Kurta Corner',
          accountNumber: number,
        })
        .expect(201);
      expect(res.body.data.accountNumber).toMatch(/^\+923\d{9}$/);
    }
    const fifth = await store.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'raast',
        accountTitle: 'Kurta Corner',
        accountNumber: '0304 4444444',
      })
      .expect(400);
    expect(fifth.body.error.message).toMatch(/at most 4/);
    const inactive = await store.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'raast',
        accountTitle: 'Kurta Corner',
        accountNumber: '0304 4444444',
        isActive: false,
      })
      .expect(201);
    await store.api
      .patch(`/shop/partner/store/payment-accounts/${inactive.body.data.id}`, {
        isActive: true,
      })
      .expect(400);

    const dup = await store.api
      .post('/shop/partner/store/payment-accounts', {
        kind: 'jazzcash',
        accountTitle: 'Again',
        accountNumber: '03011111111',
        isActive: false,
      })
      .expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });

  it('collections: unique per store, reorder, and another store gets 404 on every id', async () => {
    const a = await approvedPartner(t, admin, 'store');
    const b = await approvedPartner(t, admin, 'store');
    const c1 = (
      await a.api
        .post('/shop/partner/collections', { name: 'Eid edit' })
        .expect(201)
    ).body.data;
    const c2 = (
      await a.api
        .post('/shop/partner/collections', { name: 'Winter shawls' })
        .expect(201)
    ).body.data;
    expect(c1).toMatchObject({ slug: 'eid-edit', sort: 0 });
    await a.api
      .post('/shop/partner/collections', { name: 'EID EDIT' })
      .expect(409);
    // Another store may use the same name.
    await b.api
      .post('/shop/partner/collections', { name: 'Eid edit' })
      .expect(201);

    const reordered = await a.api
      .patch('/shop/partner/collections/reorder', { ids: [c2.id, c1.id] })
      .expect(200);
    expect(reordered.body.data.map((c: any) => c.id)).toEqual([c2.id, c1.id]);

    // Isolation: B cannot see, change, reorder or delete A's collection.
    await b.api
      .patch(`/shop/partner/collections/${c1.id}`, { name: 'Hijacked' })
      .expect(404);
    await b.api.delete(`/shop/partner/collections/${c1.id}`).expect(404);
    await b.api
      .patch('/shop/partner/collections/reorder', { ids: [c1.id] })
      .expect(404);
    const acct = (
      await a.api
        .post('/shop/partner/store/payment-accounts', {
          kind: 'raast',
          accountTitle: 'Store A',
          accountNumber: '0305 5555555',
        })
        .expect(201)
    ).body.data;
    await b.api
      .patch(`/shop/partner/store/payment-accounts/${acct.id}`, {
        accountTitle: 'Hijacked',
      })
      .expect(404);
    await b.api
      .delete(`/shop/partner/store/payment-accounts/${acct.id}`)
      .expect(404);

    const list = (await a.api.get('/shop/partner/collections').expect(200)).body
      .data;
    expect(list.map((c: any) => c.name)).toEqual(['Winter shawls', 'Eid edit']);
    const [unchanged] = await t.ds.query(
      'SELECT account_title FROM store_payment_accounts WHERE id = $1',
      [acct.id],
    );
    expect(unchanged.account_title).toBe('Store A');
  });
});
