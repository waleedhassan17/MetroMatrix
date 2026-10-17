import { randomUUID } from 'crypto';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
import {
  Admin,
  addAddress,
  approvedPartner,
  asset,
  shopper,
  testIban,
} from './utils/shopping';
import {
  Doctor,
  addClinic,
  approvedDoctor,
  expectOk,
  fullProfile,
  setSchedule,
  specialtyId,
} from './utils/health';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map(
  (w) => [w, '00:00', '24:00'] as [number, string, string],
);
const REVIEW = {
  diagnosis: 5,
  staff: 5,
  environment: 5,
  recommend: true,
  tags: ['explained_well'],
  text: 'Explained everything clearly.',
};

/**
 * Chunk 3 P8: the Health home (its city, cities, staff banners, featured
 * doctors, emergency numbers) and the additions the app's Health client
 * reads (docs/API_HEALTH.md §10, A1–A12).
 */
describe('Healthcare P8: home, banners and app additions (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const anon = () => new ApiClient(t.http);
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const audited = async (action: string, targetId: string) =>
    (
      await sql(
        `SELECT count(*)::int AS n FROM operational_audit_events WHERE action = $1 AND target_id = $2`,
        [action, targetId],
      )
    )[0].n;

  /** A listed doctor with one all-day clinic in `city`. */
  async function doctor(
    city = 'Multan',
    over: Record<string, unknown> = {},
  ): Promise<{ d: Doctor; clinic: { id: string } }> {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'dermatologist')),
        minNoticeMinutes: 0,
        cancelCutoffMinutes: 120,
        ...over,
      }),
    );
    const clinic = await addClinic(d, {
      city,
      fee: 2000,
      slotMinutes: 15,
      lat: 30.1575,
      lng: 71.5249,
    });
    await setSchedule(d, clinic.id, ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    return { d, clinic };
  }

  async function book(p: SignedUp, d: Doctor, locationId: string, i = 0) {
    const slots = await expectOk(
      await anon().get(
        `/health/doctors/${d.doctorId}/locations/${locationId}/slots?days=2`,
      ),
    );
    return expectOk(
      await p.api
        .post('/health/appointments', {
          doctorId: d.doctorId,
          locationId,
          startsAt: slots.days[1].slots[i].startsAt,
        })
        .set('Idempotency-Key', randomUUID()),
      201,
    );
  }

  async function completeVisit(d: Doctor, code: string, rx?: object) {
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${code}/check-in`),
    );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${code}/start`),
    );
    const written = rx
      ? await expectOk(
          await d.api.post(
            `/health/doctor/appointments/${code}/prescription`,
            rx,
          ),
          201,
        )
      : null;
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${code}/complete`, {
        paymentCollected: true,
      }),
    );
    return written;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  describe('banners (staff)', () => {
    it('admins only; the image is their own upload; the target exists; the window is sane; audited', async () => {
      const p = await shopper(t);
      await p.api.get('/admin/health/banners').expect(403);
      const { d } = await doctor();
      await d.api.get('/admin/health/banners').expect(403);

      const image = asset(admin.userId, 'banner').url;
      const refused = async (body: object, field: string) => {
        const res = await admin.api
          .post('/admin/health/banners', body)
          .expect(400);
        expect(res.body.error.details.fields[field]).toBeDefined();
      };
      await refused(
        {
          imageUrl: asset(p.userId, 'banner').url,
          title: 'Not mine',
          targetType: 'none',
        },
        'imageUrl',
      );
      await refused(
        { imageUrl: image, title: 'No screen', targetType: 'screen' },
        'targetScreen',
      );
      await refused(
        { imageUrl: image, title: 'No specialty', targetType: 'specialty' },
        'targetId',
      );
      await refused(
        {
          imageUrl: image,
          title: 'Nobody',
          targetType: 'doctor',
          targetId: randomUUID(),
        },
        'targetId',
      );
      await refused(
        {
          imageUrl: image,
          title: 'Backwards',
          targetType: 'none',
          startsAt: '2026-10-20T00:00:00.000Z',
          endsAt: '2026-10-19T00:00:00.000Z',
        },
        'endsAt',
      );
      await admin.api
        .post('/admin/health/banners', {
          imageUrl: image,
          title: 'Teleport',
          targetType: 'screen',
          targetScreen: 'teleport',
        })
        .expect(400);

      const derm = await specialtyId(t, 'dermatologist');
      const made = await expectOk(
        await admin.api.post('/admin/health/banners', {
          imageUrl: image,
          title: 'Skin specialists',
          subtitle: 'Acne and eczema, near you.',
          targetType: 'specialty',
          targetId: derm,
          city: 'Multan',
        }),
        201,
      );
      expect(made).toMatchObject({
        title: 'Skin specialists',
        targetType: 'specialty',
        targetId: derm,
        targetScreen: null,
        city: 'Multan',
        isActive: true,
      });
      expect(await audited('health.banner.create', made.id)).toBe(1);

      // The current image may be re-sent; a different one must be the admin's own.
      await expectOk(
        await admin.api.patch(`/admin/health/banners/${made.id}`, {
          imageUrl: image,
          title: 'Skin and hair',
        }),
      );
      await admin.api
        .patch(`/admin/health/banners/${made.id}`, {
          imageUrl: asset(p.userId, 'banner').url,
        })
        .expect(400);
      // Pointing it at a screen drops the specialty.
      const screen = await expectOk(
        await admin.api.patch(`/admin/health/banners/${made.id}`, {
          targetType: 'screen',
          targetScreen: 'records',
        }),
      );
      expect(screen).toMatchObject({
        title: 'Skin and hair',
        targetType: 'screen',
        targetId: null,
        targetScreen: 'records',
      });
      expect(await audited('health.banner.update', made.id)).toBe(2);

      await expectOk(
        await admin.api.delete(`/admin/health/banners/${made.id}`),
      );
      await admin.api.delete(`/admin/health/banners/${made.id}`).expect(404);
      expect(await audited('health.banner.delete', made.id)).toBe(1);
    });

    it('reorder puts the given banners first and renumbers every banner', async () => {
      const image = asset(admin.userId, 'banner').url;
      const make = async (title: string) =>
        expectOk(
          await admin.api.post('/admin/health/banners', {
            imageUrl: image,
            title,
            targetType: 'none',
            sort: 900,
          }),
          201,
        );
      const a = await make('Reorder A');
      const b = await make('Reorder B');
      const c = await make('Reorder C');
      const list = await expectOk(
        await admin.api.put('/admin/health/banners/order', {
          ids: [c.id, a.id],
        }),
      );
      const at = (id: string) => list.findIndex((x: any) => x.id === id);
      expect([at(c.id), at(a.id)]).toEqual([0, 1]);
      expect(at(b.id)).toBeGreaterThan(1);
      expect(list.map((x: any) => x.sort)).toEqual(
        list.map((_: any, i: number) => i),
      );
      await admin.api
        .put('/admin/health/banners/order', { ids: [a.id, a.id] })
        .expect(400);
      await admin.api
        .put('/admin/health/banners/order', { ids: [randomUUID()] })
        .expect(404);
      for (const x of [a, b, c])
        await admin.api.delete(`/admin/health/banners/${x.id}`).expect(200);
    });
  });

  describe('the home', () => {
    it('the asked city, else the patient’s default address city, else the busiest; nationwide when nobody practises there', async () => {
      const { d } = await doctor('Multan');
      const multan = await expectOk(
        await anon().get('/health/home?city=Multan'),
      );
      expect(multan.city).toBe('Multan');
      expect(multan.cities).toContain('Multan');
      expect(multan.featuredScope).toBe('city');
      expect(multan.featuredDoctors.map((c: any) => c.id)).toContain(
        d.doctorId,
      );
      expect(multan.availableTodayNearby.map((c: any) => c.id)).toContain(
        d.doctorId,
      );
      for (const s of multan.specialties)
        expect(typeof s.doctorCount).toBe('number');
      expect(multan.emergencyNumbers).toEqual([
        { label: 'Rescue', number: '1122' },
        { label: 'Edhi ambulance', number: '115' },
      ]);
      expect(Array.isArray(multan.banners)).toBe(true);

      const nowhere = await expectOk(
        await anon().get('/health/home?city=Skardu'),
      );
      expect(nowhere).toMatchObject({
        city: 'Skardu',
        featuredScope: 'nationwide',
        availableTodayNearby: [],
      });
      expect(nowhere.featuredDoctors.length).toBeGreaterThan(0);

      const busiest = await expectOk(await anon().get('/health/home'));
      expect(busiest.city).toBe(busiest.cities[0]);

      // A patient whose default address is in Multan (spelt in lower case).
      const p = await shopper(t);
      await addAddress(p, { city: 'multan' });
      const mine = await expectOk(await p.api.get('/health/home'));
      expect(mine.city).toBe('Multan');
    });

    it('banners carry their resolved target: a doctor by name, a specialty by slug', async () => {
      const { d } = await doctor('Multan');
      const image = asset(admin.userId, 'banner').url;
      const derm = await specialtyId(t, 'dermatologist');
      const forDoctor = await expectOk(
        await admin.api.post('/admin/health/banners', {
          imageUrl: image,
          title: 'Meet Dr. Sana',
          targetType: 'doctor',
          targetId: d.doctorId,
          city: 'Multan',
        }),
        201,
      );
      const forSpecialty = await expectOk(
        await admin.api.post('/admin/health/banners', {
          imageUrl: image,
          title: 'Skin specialists in Multan',
          targetType: 'specialty',
          targetId: derm,
          city: 'Multan',
        }),
        201,
      );
      const home = await expectOk(await anon().get('/health/home?city=multan'));
      const byId = new Map(home.banners.map((b: any) => [b.id, b]));
      expect(byId.get(forDoctor.id)).toEqual({
        id: forDoctor.id,
        imageUrl: image,
        title: 'Meet Dr. Sana',
        subtitle: null,
        targetType: 'doctor',
        targetScreen: null,
        target: { id: d.doctorId, name: 'Dr. Sana Iqbal' },
      });
      expect(byId.get(forSpecialty.id)).toMatchObject({
        target: { id: derm, slug: 'dermatologist', name: 'Dermatologist' },
      });
      for (const x of [forDoctor, forSpecialty])
        await admin.api.delete(`/admin/health/banners/${x.id}`).expect(200);
    });
  });

  describe('what the app reads', () => {
    it('A1: a doctor’s business says whether they are listed and PMDC-verified; other businesses do not', async () => {
      const d = await approvedDoctor(t, admin);
      expect(await expectOk(await d.api.get('/businesses/me'))).toMatchObject({
        isListed: false,
        pmdcVerified: true,
      });
      await expectOk(
        await d.api.patch('/health/doctor/profile', {
          ...fullProfile(d, await specialtyId(t, 'dermatologist')),
        }),
      );
      const clinic = await addClinic(d);
      await setSchedule(d, clinic.id, ALL_DAY);
      await expectOk(await d.api.post('/health/doctor/listing/publish'));
      expect(await expectOk(await d.api.get('/businesses/me'))).toMatchObject({
        isListed: true,
        pmdcVerified: true,
      });
      expect(
        await expectOk(
          await admin.api.get(`/admin/businesses/${d.businessId}`),
        ),
      ).toMatchObject({ isListed: true, pmdcVerified: true });
      // The session says so too (sign-in and /auth/me share one view), so
      // the doctor app opens on Today rather than Practice setup.
      expect(
        (await expectOk(await d.api.get('/auth/me'))).business,
      ).toMatchObject({ isListed: true, pmdcVerified: true });

      const shop = await approvedPartner(t, admin, 'store');
      const store = await expectOk(await shop.api.get('/businesses/me'));
      expect(store).not.toHaveProperty('isListed');
      expect(store).not.toHaveProperty('pmdcVerified');
      const session = (await expectOk(await shop.api.get('/auth/me'))).business;
      expect(session).not.toHaveProperty('isListed');
      expect(session).not.toHaveProperty('pmdcVerified');
    });

    it('A2 + A3: slug filters match the id filters; cards say whether a clinic is offered', async () => {
      const { d } = await doctor('Multan');
      const derm = await specialtyId(t, 'dermatologist');
      const [{ id: acne }] = await sql(
        `SELECT id FROM conditions WHERE slug = 'acne'`,
      );
      const ids = async (q: string) =>
        (
          await expectOk(await anon().get(`/health/doctors?pageSize=100&${q}`))
        ).items.map((c: any) => c.id);
      expect(await ids('specialty=dermatologist')).toEqual(
        await ids(`specialtyId=${derm}`),
      );
      expect(await ids('condition=acne')).toEqual(
        await ids(`conditionId=${acne}`),
      );
      expect(await ids('specialty=dermatologist')).toContain(d.doctorId);
      expect(await ids('specialty=no-such-specialty')).toEqual([]);
      await anon().get('/health/doctors?specialty=Not%20a%20slug').expect(400);

      const page = await expectOk(
        await anon().get('/health/doctors?city=Multan&pageSize=100'),
      );
      expect(page.items.find((c: any) => c.id === d.doctorId)).toMatchObject({
        offersClinic: true,
        offersVideo: false,
      });
    });

    it('A4 + A7: reviews per star, a star filter, the doctor’s own summary, names on the staff list', async () => {
      const { d, clinic } = await doctor('Multan');
      for (const [i, stars] of [5, 4, 5].entries()) {
        const p = await shopper(t);
        const a = await book(p, d, clinic.id, i);
        await completeVisit(d, a.code);
        await expectOk(
          await p.api.post(`/health/appointments/${a.code}/review`, {
            ...REVIEW,
            overall: stars,
          }),
          201,
        );
      }
      const profile = await expectOk(
        await anon().get(`/health/doctors/${d.doctorId}`),
      );
      expect(profile.reviewSummary.distribution).toEqual([0, 0, 0, 1, 2]);
      const fives = await expectOk(
        await anon().get(`/health/doctors/${d.doctorId}/reviews?rating=5`),
      );
      expect(fives.items.map((r: any) => r.overall)).toEqual([5, 5]);
      await anon()
        .get(`/health/doctors/${d.doctorId}/reviews?rating=6`)
        .expect(400);
      expect(
        await expectOk(await d.api.get('/health/doctor/reviews/summary')),
      ).toMatchObject({ count: 3, distribution: [0, 0, 0, 1, 2] });
      const staff = await expectOk(
        await admin.api.get(`/admin/health/reviews?doctorId=${d.doctorId}`),
      );
      expect(staff.items.map((r: any) => r.doctorName)).toEqual([
        'Dr. Sana Iqbal',
        'Dr. Sana Iqbal',
        'Dr. Sana Iqbal',
      ]);
    });

    it('A5 + A6 + A12: the patient’s visit has its cutoff, prescription and review state; staff see only that a prescription exists', async () => {
      const { d, clinic } = await doctor('Multan');
      const p = await shopper(t);
      const a = await book(p, d, clinic.id);
      const before = await expectOk(
        await p.api.get(`/health/appointments/${a.code}`),
      );
      expect(before).toMatchObject({
        prescriptionId: null,
        reviewed: false,
        location: { lat: 30.1575, lng: 71.5249 },
      });
      expect(before.cancelCutoffAt).toMatch(/\+05:00$/);
      expect(
        new Date(before.startsAt).getTime() -
          new Date(before.cancelCutoffAt).getTime(),
      ).toBe(120 * 60_000);

      const rx = await completeVisit(d, a.code, {
        diagnosis: 'Acne vulgaris',
        medicines: [
          {
            name: 'Doxycycline',
            form: 'capsule',
            dosePattern: '1+0+0',
            timing: 'after_meal',
          },
        ],
      });
      await expectOk(
        await p.api.post(`/health/appointments/${a.code}/review`, {
          ...REVIEW,
          overall: 5,
        }),
        201,
      );
      const after = await expectOk(
        await p.api.get(`/health/appointments/${a.code}`),
      );
      expect(after).toMatchObject({ prescriptionId: rx.id, reviewed: true });
      const list = await expectOk(
        await p.api.get('/health/appointments?scope=past'),
      );
      expect(list.items.find((x: any) => x.code === a.code)).toMatchObject({
        prescriptionId: rx.id,
        reviewed: true,
      });

      expect(
        await expectOk(await d.api.get('/health/doctor/diagnoses/recent')),
      ).toEqual(['Acne vulgaris']);

      const staffView = await expectOk(
        await admin.api.get(`/admin/health/appointments/${a.code}`),
      );
      expect(staffView).toMatchObject({
        hasPrescription: true,
        doctor: { businessId: d.businessId },
      });
      expect(staffView).not.toHaveProperty('prescriptionId');
      const doctors = await expectOk(
        await admin.api.get(`/admin/health/doctors?businessId=${d.businessId}`),
      );
      expect(doctors.items[0]).toMatchObject({
        specialty: { slug: 'dermatologist', name: 'Dermatologist' },
      });
      expect(doctors.items[0].documents.length).toBeGreaterThan(0);
      for (const doc of doctors.items[0].documents)
        expect(Object.keys(doc).sort()).toEqual([
          'id',
          'kind',
          'status',
          'url',
        ]);
    });

    it('A9: re-sending the current photo is fine; a different one must be the doctor’s own upload', async () => {
      const { d } = await doctor('Multan');
      // A seeded or migrated photo the doctor didn't upload themselves.
      const seeded =
        'https://images.unsplash.com/photo-1659353888906-adb3e0041693?w=600&h=600&fit=facearea&facepad=3.2';
      await sql(`UPDATE doctors SET photo_url = $2 WHERE id = $1`, [
        d.doctorId,
        seeded,
      ]);
      await expectOk(
        await d.api.patch('/health/doctor/profile', {
          photoUrl: seeded,
          about: 'Consultant dermatologist for acne, eczema and hair loss.',
        }),
      );
      await d.api
        .patch('/health/doctor/profile', {
          photoUrl: asset(admin.userId, 'doctor_photo').url,
        })
        .expect(400);
      await expectOk(
        await d.api.patch('/health/doctor/profile', {
          photoUrl: asset(d.userId, 'doctor_photo').url,
        }),
      );
    });

    it('A11: the doctor’s payment actions arrive as flags', async () => {
      const d = await approvedDoctor(t, admin);
      await expectOk(
        await d.api.patch('/health/doctor/profile', {
          ...fullProfile(d, await specialtyId(t, 'dermatologist')),
          minNoticeMinutes: 0,
        }),
      );
      await expectOk(
        await d.api.post('/health/doctor/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Dr Sana Iqbal',
          accountNumber: testIban(),
          bankName: 'HBL',
        }),
        201,
      );
      const video = await expectOk(
        await d.api.post('/health/doctor/locations', {
          kind: 'video',
          fee: 1500,
          slotMinutes: 30,
        }),
        201,
      );
      await setSchedule(d, video.id, ALL_DAY);
      await expectOk(await d.api.post('/health/doctor/listing/publish'));
      const p = await shopper(t);
      const a = await book(p, d, video.id);
      const can = async () =>
        (
          await expectOk(
            await d.api.get(`/health/doctor/appointments/${a.code}`),
          )
        ).can;
      expect(await can()).toMatchObject({
        confirmPayment: true,
        rejectPayment: false,
        refund: false,
      });
      await expectOk(
        await p.api.post(`/health/appointments/${a.code}/payment-proof`, {
          paymentRef: 'IBFT 77',
        }),
      );
      expect(await can()).toMatchObject({
        confirmPayment: true,
        rejectPayment: true,
        refund: false,
      });
      await expectOk(
        await d.api.post(
          `/health/doctor/appointments/${a.code}/payment/confirm`,
        ),
      );
      expect(await can()).toMatchObject({
        confirmPayment: false,
        rejectPayment: false,
        refund: false,
      });
      await expectOk(
        await d.api.post(`/health/doctor/appointments/${a.code}/cancel`, {
          reason: 'Called away to an emergency',
        }),
      );
      expect(await can()).toMatchObject({ refund: true });
    });
  });
});
