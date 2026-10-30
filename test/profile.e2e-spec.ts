import { createTestApp, TestApp } from './utils/test-app';
import { signup, uploadedDocument, verifiedPartner } from './utils/factories';
import { shopper } from './utils/shopping';

/** A3: the customer's Complete Profile (PATCH /users/me/profile). */
describe('Complete profile (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const PROFILE = {
    dateOfBirth: '1998-02-14',
    gender: 'female',
    streetAddress: '7 Canal View, Johar Town',
    city: 'Lahore',
    postalCode: '54000',
  };

  it('a new customer starts incomplete and not skippable', async () => {
    const u = await signup(t);
    expect(u.body.data.user).toMatchObject({
      profileComplete: false,
      profileSkippable: false,
      dateOfBirth: null,
      gender: null,
      streetAddress: null,
      city: null,
      postalCode: null,
    });
  });

  it('saving the profile makes it complete, in /auth/me too', async () => {
    const c = await shopper(t);
    const res = await c.api.patch('/users/me/profile', PROFILE).expect(200);
    expect(res.body.data.user).toMatchObject({
      ...PROFILE,
      profileComplete: true,
    });
    const me = await c.api.get('/auth/me').expect(200);
    expect(me.body.data.user).toMatchObject({
      profileComplete: true,
      city: 'Lahore',
    });
  });

  it('postal code and photo are optional; a photo must be your own avatar upload', async () => {
    const c = await shopper(t);
    const { postalCode: _p, ...required } = PROFILE;
    const res = await c.api.patch('/users/me/profile', required).expect(200);
    expect(res.body.data.user).toMatchObject({
      profileComplete: true,
      postalCode: null,
    });

    const mine = uploadedDocument(c.userId, 'avatar');
    await c.api
      .patch('/users/me/profile', { ...PROFILE, avatarUrl: mine.url })
      .expect(200);
    const someoneElses = uploadedDocument(
      '00000000-0000-0000-0000-000000000000',
      'avatar',
    );
    await c.api
      .patch('/users/me/profile', { ...PROFILE, avatarUrl: someoneElses.url })
      .expect(400);
  });

  it.each([
    ['a date in the future', { dateOfBirth: '2999-01-01' }],
    ['not a real date', { dateOfBirth: '2001-02-30' }],
    ['under 13', { dateOfBirth: new Date().toISOString().slice(0, 10) }],
    ['an unknown gender', { gender: 'robot' }],
    ['a street address too short', { streetAddress: 'abc' }],
    ['a postal code that is not 5 digits', { postalCode: '5400' }],
    ['a missing city', { city: undefined }],
  ])('refuses %s with VALIDATION_FAILED', async (_name, change) => {
    const c = await shopper(t);
    const res = await c.api
      .patch('/users/me/profile', { ...PROFILE, ...change })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.error.details.fields)).toHaveLength(1);
  });

  it('is for customers only; partners and staff are always "complete"', async () => {
    const p = await verifiedPartner(t);
    expect(p.body.data.user).toMatchObject({
      profileComplete: true,
      profileSkippable: false,
    });
    const res = await p.api.patch('/users/me/profile', PROFILE).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('customers from before the profile existed are skippable (the migration backfill)', async () => {
    const c = await shopper(t);
    // What the CustomerProfile migration does to customers already there.
    await t.ds.query(
      `UPDATE users SET profile_skippable = true WHERE id = $1 AND role = 'customer'`,
      [c.userId],
    );
    const me = await c.api.get('/auth/me').expect(200);
    expect(me.body.data.user).toMatchObject({
      profileComplete: false,
      profileSkippable: true,
    });
  });
});
