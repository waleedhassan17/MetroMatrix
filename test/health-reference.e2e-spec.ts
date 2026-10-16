import { ApiClient, createTestApp, TestApp } from './utils/test-app';

describe('Healthcare P0: reference data + suggest (e2e)', () => {
  let t: TestApp;
  let anon: ApiClient;

  beforeAll(async () => {
    t = await createTestApp();
    anon = new ApiClient(t.http);
  });
  afterAll(() => t.close());

  const suggest = async (q: string) =>
    (
      await anon
        .get(`/health/search/suggest?q=${encodeURIComponent(q)}`)
        .expect(200)
    ).body.data;

  it('finds Dermatologist from "skin", "pimples", the Urdu name and a typo', async () => {
    for (const q of [
      'skin',
      'pimples',
      'ماہر امراض جلد',
      'dermatologst',
      'jild',
    ]) {
      const d = await suggest(q);
      expect({ q, first: d.specialties[0]?.slug }).toEqual({
        q,
        first: 'dermatologist',
      });
      expect(d.specialties.length).toBeLessThanOrEqual(3);
      expect(d.conditions.length).toBeLessThanOrEqual(3);
      expect(d.doctors.length).toBeLessThanOrEqual(5); // doctors join in once listed (P2)
    }
    const pimples = await suggest('pimples');
    expect(pimples.conditions[0]).toMatchObject({
      slug: 'acne',
      nameUr: 'کیل مہاسے',
    });
    expect(pimples.conditions[0].specialties[0]).toMatchObject({
      slug: 'dermatologist',
      nameUr: 'ماہر امراض جلد',
    });
  });

  it('Roman-Urdu and lay words reach the right specialty', async () => {
    expect((await suggest('bukhar')).conditions[0].slug).toBe('fever');
    expect(
      (await suggest('sugar')).specialties.map((s: any) => s.slug),
    ).toContain('endocrinologist');
    expect((await suggest('daant dard')).specialties[0].slug).toBe('dentist');
    await anon.get('/health/search/suggest').expect(400);
  });

  it('lists specialties in English and Urdu, and the common conditions', async () => {
    const specialties = (await anon.get('/health/specialties').expect(200)).body
      .data;
    expect(specialties.length).toBeGreaterThanOrEqual(35);
    specialties.forEach((s: any) => expect(s.nameUr).toMatch(/[؀-ۿ]/));
    const common = (
      await anon.get('/health/conditions?common=true').expect(200)
    ).body.data;
    expect(common.length).toBeGreaterThanOrEqual(10);
    common.forEach((c: any) => expect(c.isCommon).toBe(true));
    const fever = (
      await anon.get('/health/conditions?q=temperature').expect(200)
    ).body.data;
    expect(fever[0].slug).toBe('fever');
    // Every condition maps to at least one live specialty.
    const all = (await anon.get('/health/conditions').expect(200)).body.data;
    all.forEach((c: any) => expect(c.specialties.length).toBeGreaterThan(0));
  });
});
