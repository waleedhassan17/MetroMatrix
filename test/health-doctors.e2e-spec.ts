import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin, verifyDoctorPmdc } from './utils/admin';
import {
  addDocuments,
  DOCTOR_BUSINESS,
  verifiedPartner,
} from './utils/factories';
import { Admin, approvedPartner, asset, testIban } from './utils/shopping';
import {
  addClinic,
  approvedDoctor,
  fullProfile,
  setSchedule,
  specialtyId,
} from './utils/health';

describe('Healthcare P1: PMDC gate, doctor profile, practice, listing (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let anon: ApiClient;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    anon = new ApiClient(t.http);
  });
  afterAll(() => t.close());

  describe('PMDC gate on Chunk 1 onboarding', () => {
    it('a doctor business needs a PMDC number to submit, and verification to be approved', async () => {
      const p = await verifiedPartner(t);
      const created = await p.api
        .post('/businesses', { ...DOCTOR_BUSINESS, pmdcNumber: undefined })
        .expect(201);
      expect(created.body.data.pmdcNumber).toBeNull();
      await addDocuments(p, [
        'cnic_front',
        'cnic_back',
        'pmdc_certificate',
        'degree_certificate',
      ]);
      const noPmdc = await p.api.post('/businesses/me/submit').expect(400);
      expect(noPmdc.body.error.details.fields.pmdcNumber).toBeDefined();

      await p.api
        .patch('/businesses/me', { pmdcNumber: 'bad number!' })
        .expect(400);
      const pmdc = `${Date.now() % 1e6}-P`;
      const patched = await p.api
        .patch('/businesses/me', { pmdcNumber: ` ${pmdc.toLowerCase()} ` })
        .expect(200);
      expect(patched.body.data.pmdcNumber).toBe(pmdc);
      await p.api.post('/businesses/me/submit').expect(200);

      // The doctor row exists (unverified) for the admin to check.
      const queue = await admin.api
        .get(
          `/admin/health/doctors?pmdc=unverified&businessId=${created.body.data.id}`,
        )
        .expect(200);
      expect(queue.body.data.items).toEqual([
        expect.objectContaining({
          pmdcNumber: pmdc,
          pmdcVerifiedAt: null,
          business: expect.objectContaining({ status: 'pending_approval' }),
        }),
      ]);

      const blocked = await admin.api
        .post(`/admin/businesses/${created.body.data.id}/approve`)
        .expect(422);
      expect(blocked.body.error).toMatchObject({
        code: 'PMDC_NOT_VERIFIED',
        details: { pmdcNumber: pmdc },
      });
      const [{ status }] = await t.ds.query(
        `SELECT status FROM businesses WHERE id = $1`,
        [created.body.data.id],
      );
      expect(status).toBe('pending_approval'); // the refused approval rolled back

      const doctorId = await verifyDoctorPmdc(admin, created.body.data.id);
      await admin.api
        .post(`/admin/businesses/${created.body.data.id}/approve`)
        .expect(200);
      const audit = await t.ds.query(
        `SELECT 1 FROM operational_audit_events WHERE action = 'health.doctor.pmdc_verify' AND target_id = $1`,
        [doctorId],
      );
      expect(audit).toHaveLength(1);
      const profile = await p.api.get('/health/doctor/profile').expect(200);
      expect(profile.body.data).toMatchObject({
        id: doctorId,
        pmdcNumber: pmdc,
        pmdcVerified: true,
        isListed: false,
      });
    });

    it('PMDC numbers are doctor-only and unique', async () => {
      const store = await verifiedPartner(t);
      await store.api
        .post('/businesses', {
          ...DOCTOR_BUSINESS,
          serviceType: 'shopping',
          subType: 'store',
          pmdcNumber: '77777-P',
        })
        .expect(400);
      const a = await verifiedPartner(t);
      const pmdc = `${(Date.now() + 7) % 1e6}-D`;
      await a.api
        .post('/businesses', { ...DOCTOR_BUSINESS, pmdcNumber: pmdc })
        .expect(201);
      const b = await verifiedPartner(t);
      const dup = await b.api
        .post('/businesses', { ...DOCTOR_BUSINESS, pmdcNumber: pmdc })
        .expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');
    });

    it('a shop partner on a doctor route → 403 WRONG_SERVICE', async () => {
      const shop = await approvedPartner(t, admin, 'store');
      const res = await shop.api.get('/health/doctor/profile').expect(403);
      expect(res.body.error).toMatchObject({
        code: 'WRONG_SERVICE',
        details: { required: 'healthcare', actual: 'shopping' },
      });
    });
  });

  describe('profile, practice, listing', () => {
    it('publishing waits for a complete profile, a location and hours; unlisted doctors are invisible', async () => {
      const d = await approvedDoctor(t, admin);
      const derm = await specialtyId(t, 'dermatologist');

      const start = await d.api
        .get('/health/doctor/profile/completeness')
        .expect(200);
      expect(start.body.data.percent).toBeLessThan(100);
      expect(start.body.data.missing).toEqual(
        expect.arrayContaining([
          'gender',
          'photo',
          'primary_specialty',
          'about',
          'qualifications',
          'active_location',
          'weekly_schedule',
        ]),
      );
      expect(start.body.data.missing).not.toContain('pmdc_verified');
      const early = await d.api
        .post('/health/doctor/listing/publish')
        .expect(422);
      expect(early.body.error).toMatchObject({
        code: 'PROFILE_INCOMPLETE',
        details: { missing: start.body.data.missing },
      });
      await anon.get(`/health/doctors/${d.doctorId}`).expect(404);

      await d.api
        .patch('/health/doctor/profile', {
          primarySpecialtyId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      await d.api
        .patch('/health/doctor/profile', {
          photoUrl: asset(admin.userId, 'doctor_photo').url,
        })
        .expect(400);
      const saved = await d.api
        .patch('/health/doctor/profile', {
          ...fullProfile(d, derm),
          secondarySpecialtyIds: [await specialtyId(t, 'allergy-specialist')],
          experiences: [
            {
              designation: 'Consultant',
              institute: 'Services Hospital',
              fromYear: 2016,
              toYear: null,
            },
          ],
          services: [
            'Acne scar treatment',
            'Chemical peel',
            'Acne scar treatment',
          ],
          conditionIds: (
            await t.ds.query(
              `SELECT id FROM conditions WHERE slug IN ('acne', 'eczema')`,
            )
          ).map((r: any) => r.id),
        })
        .expect(200);
      expect(saved.body.data).toMatchObject({
        primarySpecialty: { slug: 'dermatologist', nameUr: 'ماہر امراض جلد' },
        services: ['Acne scar treatment', 'Chemical peel'],
        yearsExperience: new Date().getUTCFullYear() - 2012,
      });
      expect(saved.body.data.conditions.map((c: any) => c.slug).sort()).toEqual(
        ['acne', 'eczema'],
      );
      // Lists replace: sending one qualification leaves one.
      const replaced = await d.api
        .patch('/health/doctor/profile', {
          qualifications: [{ degree: 'FCPS', institute: 'CPSP' }],
        })
        .expect(200);
      expect(replaced.body.data.qualifications).toEqual([
        { degree: 'FCPS', institute: 'CPSP', year: null },
      ]);

      await d.api
        .post('/health/doctor/locations', { kind: 'clinic', fee: 2000 })
        .expect(400); // address required
      const clinicA = await addClinic(d);
      const clinicB = await addClinic(d, {
        name: 'DHA Medical Centre',
        area: 'DHA Phase 5',
      });
      const video = await d.api
        .post('/health/doctor/locations', { kind: 'video', fee: 1500 })
        .expect(201);
      expect(video.body.data).toMatchObject({
        name: 'Video consultation',
        addressLine: null,
        timezone: 'Asia/Karachi',
      });
      expect(
        (
          await d.api
            .post('/health/doctor/locations', { kind: 'video', fee: 1000 })
            .expect(409)
        ).body.error.code,
      ).toBe('CONFLICT');
      await d.api
        .post('/health/doctor/locations', {
          kind: 'video',
          fee: 1000,
          timezone: 'Mars/Olympus',
        })
        .expect(400);

      // Monday 14:00–19:00 at A; Monday 18:00–20:00 at B overlaps across clinics.
      await setSchedule(d, clinicA.id, [
        [1, '14:00', '19:00'],
        [3, '09:00', '13:00'],
      ]);
      const clash = await d.api
        .put(`/health/doctor/locations/${clinicB.id}/schedule`, [
          { weekday: 1, start: '18:00', end: '20:00' },
        ])
        .expect(409);
      expect(clash.body.error).toMatchObject({
        code: 'SCHEDULE_OVERLAP',
        details: {
          range: {
            locationId: clinicB.id,
            weekday: 1,
            start: '18:00',
            end: '20:00',
          },
          conflict: {
            locationId: clinicA.id,
            locationName: 'Gulberg Skin Clinic',
            weekday: 1,
            start: '14:00',
            end: '19:00',
          },
        },
      });
      await setSchedule(d, clinicB.id, [[1, '19:00', '21:00']]); // touching is fine
      const own = await d.api
        .put(`/health/doctor/locations/${clinicB.id}/schedule`, [
          { weekday: 2, start: '10:00', end: '12:00' },
          { weekday: 2, start: '11:30', end: '13:00' },
        ])
        .expect(409);
      expect(own.body.error.code).toBe('SCHEDULE_OVERLAP');
      await d.api
        .put(`/health/doctor/locations/${clinicB.id}/schedule`, [
          { weekday: 2, start: '12:00', end: '11:00' },
        ])
        .expect(400);
      await d.api
        .put(`/health/doctor/locations/${clinicB.id}/schedule`, [
          { weekday: 7, start: '10:00', end: '11:00' },
        ])
        .expect(400);
      const week = await d.api
        .get(`/health/doctor/locations/${clinicA.id}/schedule`)
        .expect(200);
      expect(week.body.data.ranges).toEqual([
        { weekday: 1, weekdayLabel: 'Mon', start: '14:00', end: '19:00' },
        { weekday: 3, weekdayLabel: 'Wed', start: '09:00', end: '13:00' },
      ]);

      const done = await d.api
        .get('/health/doctor/profile/completeness')
        .expect(200);
      expect(done.body.data).toEqual({
        percent: 100,
        missing: [],
        isListed: false,
      });
      await anon.get(`/health/doctors/${d.doctorId}`).expect(404);
      await d.api.post('/health/doctor/listing/publish').expect(200);
      expect(
        (await anon.get(`/health/doctors/${d.doctorId}`).expect(200)).body.data
          .id,
      ).toBe(d.doctorId);

      // Closing every location unlists the doctor automatically.
      for (const l of [clinicA, clinicB, video.body.data]) {
        await d.api
          .patch(`/health/doctor/locations/${l.id}`, { isActive: false })
          .expect(200);
      }
      expect(
        (await d.api.get('/health/doctor/profile/completeness').expect(200))
          .body.data.isListed,
      ).toBe(false);
      const gone = await anon.get(`/health/doctors/${d.doctorId}`).expect(404);
      expect(gone.body.error.code).toBe('DOCTOR_NOT_LISTED');
    });

    it('time off, payment accounts, and admin unlisting', async () => {
      const d = await approvedDoctor(t, admin);
      await d.api
        .patch(
          '/health/doctor/profile',
          fullProfile(d, await specialtyId(t, 'cardiologist')),
        )
        .expect(200);
      const clinic = await addClinic(d);
      await setSchedule(d, clinic.id, [[5, '17:00', '21:00']]);

      const off = await d.api
        .post('/health/doctor/time-off', {
          startsAt: '2030-01-04T00:00:00+05:00',
          endsAt: '2030-01-05T00:00:00+05:00',
          reason: 'Conference',
        })
        .expect(201);
      await d.api
        .post('/health/doctor/time-off', {
          startsAt: '2030-01-05T00:00:00+05:00',
          endsAt: '2030-01-04T00:00:00+05:00',
        })
        .expect(400);
      expect(
        (await d.api.get('/health/doctor/time-off').expect(200)).body.data.map(
          (x: any) => x.id,
        ),
      ).toEqual([off.body.data.id]);
      await d.api
        .delete(`/health/doctor/time-off/${off.body.data.id}`)
        .expect(200);

      const iban = testIban();
      const acct = await d.api
        .post('/health/doctor/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Dr Sana Iqbal',
          accountNumber: iban,
          bankName: 'Meezan Bank',
        })
        .expect(201);
      expect(acct.body.data.accountNumber).toBe(iban);
      await d.api
        .post('/health/doctor/payment-accounts', {
          kind: 'jazzcash',
          accountTitle: 'Dr Sana',
          accountNumber: '042 35761234',
        })
        .expect(400);
      await d.api
        .post('/health/doctor/payment-accounts', {
          kind: 'bank',
          accountTitle: 'Dr Sana',
          accountNumber: iban.slice(0, -1) + '0',
        })
        .expect(400);

      await d.api.post('/health/doctor/listing/publish').expect(200);
      await admin.api
        .post(`/admin/health/doctors/${d.doctorId}/unlist`, {
          reason: 'Complaints under review',
        })
        .expect(200);
      await anon.get(`/health/doctors/${d.doctorId}`).expect(404);
      const refused = await d.api
        .post('/health/doctor/listing/publish')
        .expect(403);
      expect(refused.body.error.details.unlistedReason).toBe(
        'Complaints under review',
      );
      await admin.api
        .post(`/admin/health/doctors/${d.doctorId}/clear-unlist`)
        .expect(200);
      await d.api.post('/health/doctor/listing/publish').expect(200);
      await admin.api
        .post(`/admin/health/doctors/${d.doctorId}/pmdc-unverify`, {
          reason: 'Registration lapsed',
        })
        .expect(200);
      expect(
        (await d.api.get('/health/doctor/profile/completeness').expect(200))
          .body.data,
      ).toMatchObject({
        isListed: false,
        missing: ['pmdc_verified'],
      });
      await d.api.post('/health/doctor/listing/publish').expect(422);
    });

    it('another doctor gets 404 on every practice row', async () => {
      const a = await approvedDoctor(t, admin);
      const b = await approvedDoctor(t, admin);
      const clinic = await addClinic(a);
      const off = await a.api
        .post('/health/doctor/time-off', {
          startsAt: '2030-02-01T00:00:00Z',
          endsAt: '2030-02-02T00:00:00Z',
        })
        .expect(201);
      const acct = await a.api
        .post('/health/doctor/payment-accounts', {
          kind: 'easypaisa',
          accountTitle: 'Dr A',
          accountNumber: '0300 1234567',
        })
        .expect(201);
      for (const call of [
        () => b.api.patch(`/health/doctor/locations/${clinic.id}`, { fee: 1 }),
        () => b.api.delete(`/health/doctor/locations/${clinic.id}`),
        () => b.api.get(`/health/doctor/locations/${clinic.id}/schedule`),
        () => b.api.put(`/health/doctor/locations/${clinic.id}/schedule`, []),
        () => b.api.delete(`/health/doctor/time-off/${off.body.data.id}`),
        () =>
          b.api.patch(`/health/doctor/payment-accounts/${acct.body.data.id}`, {
            isActive: false,
          }),
        () =>
          b.api.delete(`/health/doctor/payment-accounts/${acct.body.data.id}`),
      ]) {
        const res = await call();
        expect({ status: res.status, code: res.body.error?.code }).toEqual({
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      expect(
        (await b.api.get('/health/doctor/locations').expect(200)).body.data,
      ).toEqual([]);
    });
  });
});
