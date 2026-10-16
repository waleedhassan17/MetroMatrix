import { randomUUID } from 'crypto';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp, submittedDoctor } from './utils/factories';
import {
  Admin,
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
import { HealthJobsService } from '../src/modules/healthcare/jobs/health-jobs.service';
import {
  ModelSuggestion,
  SymptomModel,
} from '../src/modules/healthcare/symptom-checker/symptom-model';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map(
  (w) => [w, '00:00', '24:00'] as [number, string, string],
);
const PKT = 5 * 3600e3;
/** Today's date in Karachi (UTC+5, no DST) plus n days. */
const pktDate = (n = 0) =>
  new Date(Date.now() + PKT + n * 86400e3).toISOString().slice(0, 10);

class CountingModel extends SymptomModel {
  enabled = true;
  calls = 0;
  async suggest(): Promise<ModelSuggestion | null> {
    this.calls += 1;
    return null;
  }
}

/**
 * The Chunk 3 release gate: one test per row of the Healthcare QA matrix.
 * Add rows, never delete them.
 */
describe('QA matrix — Healthcare (Chunk 3)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: HealthJobsService;
  const model = new CountingModel();
  const anon = () => new ApiClient(t.http);
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  /** A listed doctor with one location (all-day hours unless given). */
  async function doctor(
    opts: {
      specialty?: string;
      profile?: Record<string, unknown>;
      kind?: 'clinic' | 'video';
      hours?: Array<[number, string, string]>;
      location?: Record<string, unknown>;
    } = {},
  ) {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(
          d,
          await specialtyId(t, opts.specialty ?? 'dermatologist'),
        ),
        minNoticeMinutes: 0,
        cancelCutoffMinutes: 120,
        ...opts.profile,
      }),
    );
    const loc =
      opts.kind === 'video'
        ? await expectOk(
            await d.api.post('/health/doctor/locations', {
              kind: 'video',
              fee: 2000,
              slotMinutes: 30,
              ...opts.location,
            }),
            201,
          )
        : await addClinic(d, { fee: 2000, slotMinutes: 15, ...opts.location });
    await setSchedule(d, loc.id, opts.hours ?? ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    return { d, loc };
  }

  async function slotsOf(d: Doctor, locationId: string, q = 'days=2') {
    return expectOk(
      await anon().get(
        `/health/doctors/${d.doctorId}/locations/${locationId}/slots?${q}`,
      ),
    );
  }

  const tomorrow = async (d: Doctor, locationId: string, i = 0) =>
    (await slotsOf(d, locationId)).days[1].slots[i].startsAt as string;

  const bookRaw = async (
    p: SignedUp,
    d: Doctor,
    locationId: string,
    startsAt: string,
    over = {},
  ) =>
    p.api
      .post('/health/appointments', {
        doctorId: d.doctorId,
        locationId,
        startsAt,
        ...over,
      })
      .set('Idempotency-Key', randomUUID());

  const book = async (
    p: SignedUp,
    d: Doctor,
    locationId: string,
    i = 0,
    over = {},
  ) =>
    expectOk(
      await bookRaw(p, d, locationId, await tomorrow(d, locationId, i), over),
      201,
    );

  const moveTo = (code: string, minutesFromNow: number, length = 15) =>
    sql(
      `UPDATE appointments SET starts_at = now() + make_interval(mins => $2),
              ends_at = now() + make_interval(mins => $2 + $3) WHERE code = $1`,
      [code, minutesFromNow, length],
    );

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) => b.overrideProvider(SymptomModel).useValue(model),
    });
    jobs = t.app.get(HealthJobsService);
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('QA #1 search "skin" / "pimples" / Urdu finds Dermatologist and dermatologists', async () => {
    const acne = (await sql(`SELECT id FROM conditions WHERE slug = 'acne'`))[0]
      .id;
    const { d } = await doctor({ profile: { conditionIds: [acne] } });
    for (const q of ['skin', 'pimples', 'ماہر امراض جلد']) {
      const s = await expectOk(
        await anon().get(`/health/search/suggest?q=${encodeURIComponent(q)}`),
      );
      expect([q, s.specialties.map((x: any) => x.slug)]).toEqual([
        q,
        expect.arrayContaining(['dermatologist']),
      ]);
    }
    for (const q of ['skin', 'pimples']) {
      const list = await expectOk(
        await anon().get(`/health/doctors?q=${q}&pageSize=100`),
      );
      expect(list.items.map((c: any) => c.id)).toContain(d.doctorId);
    }
    const derm = await specialtyId(t, 'dermatologist');
    const bySpecialty = await expectOk(
      await anon().get(`/health/doctors?specialtyId=${derm}&pageSize=100`),
    );
    expect(bySpecialty.items.map((c: any) => c.id)).toContain(d.doctorId);
  });

  it('QA #2 available today + video + female: the right subset, labels in PKT', async () => {
    const { d: yes } = await doctor({
      kind: 'video',
      profile: { gender: 'female' },
    });
    const { d: male } = await doctor({
      kind: 'video',
      profile: { gender: 'male' },
    });
    const { d: clinicOnly } = await doctor({ profile: { gender: 'female' } });
    const list = await expectOk(
      await anon().get(
        '/health/doctors?availableToday=true&kind=video&gender=female&pageSize=100',
      ),
    );
    const ids = list.items.map((c: any) => c.id);
    expect(ids).toContain(yes.doctorId);
    expect(ids).not.toContain(male.doctorId);
    expect(ids).not.toContain(clinicOnly.doctorId);
    const card = list.items.find((c: any) => c.id === yes.doctorId);
    expect(card.nextAvailable.label).toMatch(
      /^Available today, \d{1,2}:\d{2} (AM|PM)$/,
    );
    expect(card.nextAvailable.at).toMatch(/\+05:00$/);
  });

  it('QA #3 sort=earliest orders by next available', async () => {
    await doctor({
      hours: EVERY_DAY.map(
        (w) => [w, '09:00', '10:00'] as [number, string, string],
      ),
    });
    await doctor();
    const list = await expectOk(
      await anon().get('/health/doctors?sort=earliest&pageSize=100'),
    );
    const times = list.items
      .map((c: any) => c.nextAvailable?.at)
      .filter(Boolean)
      .map((s: string) => new Date(s).getTime());
    expect(times.length).toBeGreaterThan(1);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('QA #4 an unlisted doctor by id → 404 DOCTOR_NOT_LISTED', async () => {
    const { d } = await doctor();
    await expectOk(await d.api.post('/health/doctor/listing/unpublish'));
    const res = await anon().get(`/health/doctors/${d.doctorId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DOCTOR_NOT_LISTED');
  });

  it('QA #5 slots respect the minimum notice and the booking window', async () => {
    const { d, loc } = await doctor({
      profile: { minNoticeMinutes: 120, bookingWindowDays: 3 },
    });
    const view = await slotsOf(d, loc.id, 'days=7');
    const earliest = Date.now() + 120 * 60_000;
    for (const day of view.days)
      for (const s of day.slots)
        expect(new Date(s.startsAt).getTime()).toBeGreaterThanOrEqual(
          earliest - 1000,
        );
    const lastBookable = pktDate(2);
    for (const day of view.days) {
      if (day.date > lastBookable)
        expect([day.date, day.isAvailable, day.slots.length]).toEqual([
          day.date,
          false,
          0,
        ]);
    }
    expect(view.days.find((x: any) => x.date === pktDate(1)).isAvailable).toBe(
      true,
    );
  });

  it('QA #6 time off on Friday → Friday shows isAvailable: false', async () => {
    const { d, loc } = await doctor();
    let n = 1;
    while (new Date(`${pktDate(n)}T12:00:00Z`).getUTCDay() !== 5) n++;
    const friday = pktDate(n);
    await expectOk(
      await d.api.post('/health/doctor/time-off', {
        startsAt: `${friday}T00:00:00+05:00`,
        endsAt: `${pktDate(n + 1)}T00:00:00+05:00`,
        reason: 'Family event',
      }),
      201,
    );
    const view = await slotsOf(d, loc.id, `from=${friday}&days=2`);
    expect(view.days[0]).toMatchObject({
      date: friday,
      isAvailable: false,
      slots: [],
    });
    expect(view.days[1].isAvailable).toBe(true);
  });

  it('QA #7 ten parallel bookings for one slot: 1 success, 9 SLOT_TAKEN with alternatives', async () => {
    const { d, loc } = await doctor();
    const slot = await tomorrow(d, loc.id);
    const patients = await Promise.all(
      Array.from({ length: 10 }, () => shopper(t)),
    );
    const results = await Promise.all(
      patients.map((p) => bookRaw(p, d, loc.id, slot)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      201,
      ...Array(9).fill(409),
    ]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('SLOT_TAKEN');
      expect(r.body.error.details.alternatives).toHaveLength(3);
    }
  });

  it('QA #8 same doctor, two clinics, same time → the second is rejected', async () => {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'dermatologist')),
        minNoticeMinutes: 0,
      }),
    );
    const a = await addClinic(d);
    const b = await addClinic(d, {
      name: 'Second Clinic',
      area: 'DHA Phase 5',
    });
    await setSchedule(
      d,
      a.id,
      EVERY_DAY.map((w) => [w, '00:00', '12:00'] as [number, string, string]),
    );
    await setSchedule(
      d,
      b.id,
      EVERY_DAY.map((w) => [w, '12:00', '24:00'] as [number, string, string]),
    );
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    const p1 = await shopper(t);
    const first = await book(p1, d, a.id);
    // Force clinic B's same instant past the availability check: the database refuses it.
    await sql(
      `UPDATE weekly_schedules SET start_time = '00:00' WHERE location_id = $1`,
      [b.id],
    );
    const p2 = await shopper(t);
    const second = await bookRaw(p2, d, b.id, first.startsAt);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SLOT_TAKEN');
  });

  it('QA #9 one patient, overlapping appointments with two doctors → PATIENT_OVERLAP', async () => {
    const { d: d1, loc: l1 } = await doctor();
    const { d: d2, loc: l2 } = await doctor();
    const p = await shopper(t);
    const a = await book(p, d1, l1.id);
    const res = await bookRaw(p, d2, l2.id, a.startsAt);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'PATIENT_OVERLAP',
      details: { appointmentCode: a.code },
    });
  });

  it("QA #10 booking for a family member snapshots the member's name and age", async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const dob = `${new Date().getUTCFullYear() - 7}-01-01`;
    const kid = await expectOk(
      await p.api.post('/health/family-members', {
        fullName: 'Zara Khan',
        relation: 'child',
        gender: 'female',
        dateOfBirth: dob,
      }),
      201,
    );
    const a = await book(p, d, loc.id, 0, { familyMemberId: kid.id });
    expect(a.patient).toMatchObject({
      name: 'Zara Khan',
      age: 7,
      relation: 'child',
      gender: 'female',
    });
    expect(a.familyMemberId).toBe(kid.id);
  });

  it('QA #11 a 4th upcoming appointment with the same doctor → BOOKING_LIMIT', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    for (const i of [0, 2, 4]) await book(p, d, loc.id, i);
    const res = await bookRaw(p, d, loc.id, await tomorrow(d, loc.id, 6));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_LIMIT');
  });

  it('QA #12 rescheduling twice → RESCHEDULE_NOT_ALLOWED', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const a = await book(p, d, loc.id);
    const moved = await expectOk(
      await p.api
        .post(`/health/appointments/${a.code}/reschedule`, {
          startsAt: await tomorrow(d, loc.id, 4),
        })
        .set('Idempotency-Key', randomUUID()),
    );
    const again = await p.api
      .post(`/health/appointments/${moved.code}/reschedule`, {
        startsAt: await tomorrow(d, loc.id, 8),
      })
      .set('Idempotency-Key', randomUUID());
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('RESCHEDULE_NOT_ALLOWED');
  });

  it('QA #13 cancelling 30 minutes before (cutoff 120) is allowed and marked lateCancel', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const a = await book(p, d, loc.id);
    await moveTo(a.code, 30);
    const res = await expectOk(
      await p.api.post(`/health/appointments/${a.code}/cancel`, {
        reason: 'Stuck in traffic',
      }),
    );
    expect(res).toMatchObject({
      status: 'cancelled',
      lateCancel: true,
      cancelledBy: 'patient',
    });
  });

  it('QA #14 prepaid video unpaid at pay_by: auto-cancelled, slot free, both notified', async () => {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'psychiatrist')),
        minNoticeMinutes: 0,
      }),
    );
    await expectOk(
      await d.api.post('/health/doctor/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Dr QA',
        accountNumber: testIban(),
        bankName: 'HBL',
      }),
      201,
    );
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        videoPrepayRequired: true,
      }),
    );
    const video = await expectOk(
      await d.api.post('/health/doctor/locations', {
        kind: 'video',
        fee: 3000,
        slotMinutes: 30,
      }),
      201,
    );
    await setSchedule(d, video.id, ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    const p = await shopper(t);
    const slot = await tomorrow(d, video.id);
    const a = await expectOk(await bookRaw(p, d, video.id, slot), 201);
    expect(a.payment.payBy).not.toBeNull();
    await sql(
      `UPDATE appointments SET pay_by = now() - interval '1 minute' WHERE code = $1`,
      [a.code],
    );
    expect((await jobs.cancelUnpaidPrepay()).cancelled).toBeGreaterThanOrEqual(
      1,
    );
    const after = await expectOk(
      await p.api.get(`/health/appointments/${a.code}`),
    );
    expect(after).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      payment: { status: 'void' },
    });
    expect(await tomorrow(d, video.id)).toBe(slot);
    for (const userId of [p.userId, d.userId]) {
      const n = await sql(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'health.appointment.cancelled' AND data->>'appointmentCode' = $2`,
        [userId, a.code],
      );
      expect(n).toHaveLength(1);
    }
  });

  it('QA #15 joining a video call 20 minutes early → VIDEO_NOT_JOINABLE', async () => {
    const { d, loc } = await doctor({ kind: 'video' });
    const p = await shopper(t);
    const a = await book(p, d, loc.id);
    await moveTo(a.code, 20, 30);
    const res = await p.api.post(`/health/appointments/${a.code}/video/join`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'VIDEO_NOT_JOINABLE',
      details: { reason: 'window' },
    });
    await moveTo(a.code, 9, 30);
    await expectOk(
      await p.api.post(`/health/appointments/${a.code}/video/join`),
    );
  });

  it('QA #16 check-in → start → complete with payment collected: statuses, timestamps, paid', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const a = await book(p, d, loc.id);
    const step = (s: string, body?: object) =>
      d.api.post(`/health/doctor/appointments/${a.code}/${s}`, body);
    expect((await expectOk(await step('check-in'))).status).toBe('checked_in');
    expect((await expectOk(await step('start'))).status).toBe(
      'in_consultation',
    );
    const done = await expectOk(
      await step('complete', { paymentCollected: true }),
    );
    expect(done).toMatchObject({
      status: 'completed',
      payment: { status: 'paid' },
    });
    for (const k of ['checkedInAt', 'startedAt', 'completedAt'])
      expect(done[k]).toMatch(/\+05:00$/);
    expect(done.payment.paidAt).not.toBeNull();
  });

  it('QA #17 a no-show before start + 15 minutes → INVALID_TRANSITION', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const a = await book(p, d, loc.id);
    await moveTo(a.code, -10);
    const res = await d.api.post(
      `/health/doctor/appointments/${a.code}/no-show`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('QA #18 an unrelated doctor reading a patient → 404', async () => {
    const { d, loc } = await doctor();
    const { d: other } = await doctor();
    const p = await shopper(t);
    await book(p, d, loc.id);
    expect(
      (await other.api.get(`/health/doctor/patients/${p.userId}`)).status,
    ).toBe(404);
    await expectOk(await d.api.get(`/health/doctor/patients/${p.userId}`));
  });

  it('QA #19 a doctor reading an unshared record → 404; shared → 200 and an audit row', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const file = asset(p.userId, 'health_record', 'pdf');
    const rec = await expectOk(
      await p.api.post('/health/records', {
        title: 'CBC',
        type: 'lab_report',
        files: [{ ...file, mime: 'application/pdf' }],
      }),
      201,
    );
    const a = await book(p, d, loc.id);
    const path = `/health/doctor/appointments/${a.code}/records/${rec.id}`;
    expect((await d.api.get(path)).status).toBe(404);
    await expectOk(
      await p.api.post(`/health/appointments/${a.code}/attachments`, {
        recordIds: [rec.id],
      }),
      201,
    );
    await expectOk(await d.api.get(path));
    const audit = await sql(
      `SELECT 1 FROM operational_audit_events WHERE action = 'phi.read' AND actor_user_id = $1 AND target_id = $2`,
      [d.userId, rec.id],
    );
    expect(audit).toHaveLength(1);
  });

  it('QA #20 editing a prescription 24 h after completion → PRESCRIPTION_LOCKED', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const a = await book(p, d, loc.id);
    for (const s of ['check-in', 'start'])
      await expectOk(
        await d.api.post(`/health/doctor/appointments/${a.code}/${s}`),
      );
    const rx = {
      diagnosis: 'Acne',
      medicines: [
        {
          name: 'Doxycycline',
          strength: '100 mg',
          form: 'capsule',
          dosePattern: '1+0+0',
          timing: 'after_meal',
        },
      ],
    };
    const path = `/health/doctor/appointments/${a.code}/prescription`;
    await expectOk(await d.api.post(path, rx), 201);
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/complete`),
    );
    await expectOk(
      await d.api.post(path, { ...rx, diagnosis: 'Acne vulgaris' }),
      201,
    );
    await sql(
      `UPDATE appointments SET completed_at = now() - interval '25 hours' WHERE code = $1`,
      [a.code],
    );
    const res = await d.api.post(path, rx);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRESCRIPTION_LOCKED');
  });

  it('QA #21 reviewing twice / before completion → REVIEW_EXISTS / REVIEW_NOT_ALLOWED', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const a = await book(p, d, loc.id);
    const body = { overall: 5, diagnosis: 5, recommend: true };
    const early = await p.api.post(
      `/health/appointments/${a.code}/review`,
      body,
    );
    expect([early.status, early.body.error.code]).toEqual([
      403,
      'REVIEW_NOT_ALLOWED',
    ]);
    for (const s of ['check-in', 'start', 'complete'])
      await expectOk(
        await d.api.post(`/health/doctor/appointments/${a.code}/${s}`),
      );
    await expectOk(
      await p.api.post(`/health/appointments/${a.code}/review`, body),
      201,
    );
    const twice = await p.api.post(
      `/health/appointments/${a.code}/review`,
      body,
    );
    expect([twice.status, twice.body.error.code]).toEqual([
      409,
      'REVIEW_EXISTS',
    ]);
  });

  it('QA #22 the wait-time stat is hidden with 4 samples and shown with 5', async () => {
    const { d, loc } = await doctor();
    const codes: string[] = [];
    for (let i = 0; i < 5; i++)
      codes.push((await book(await shopper(t), d, loc.id, i * 2)).code);
    const finish = (code: string, daysAgo: number, wait: number) =>
      sql(
        `UPDATE appointments SET status = 'completed', payment_status = 'paid',
                starts_at = now() - make_interval(days => $2), ends_at = now() - make_interval(days => $2) + interval '15 minutes',
                checked_in_at = now() - make_interval(days => $2),
                started_at = now() - make_interval(days => $2) + make_interval(mins => $3),
                completed_at = now() - make_interval(days => $2) + make_interval(mins => $3 + 10)
          WHERE code = $1`,
        [code, daysAgo, wait],
      );
    for (let i = 0; i < 4; i++) await finish(codes[i], i + 1, 10);
    await jobs.nightlyRun();
    let profile = await expectOk(
      await anon().get(`/health/doctors/${d.doctorId}`),
    );
    expect(profile.stats.avgWaitMinutes).toBeNull();
    await finish(codes[4], 5, 20);
    await jobs.nightlyRun();
    profile = await expectOk(await anon().get(`/health/doctors/${d.doctorId}`));
    expect(profile.stats).toMatchObject({
      avgWaitMinutes: 12,
      avgConsultMinutes: 10,
    });
  });

  it('QA #23 red flag "seene mein dard aur saans nahi aa rahi" → emergency, no model call', async () => {
    const p = await shopper(t);
    model.calls = 0;
    const r = await expectOk(
      await p.api.post('/health/symptom-checker', {
        text: 'seene mein dard aur saans nahi aa rahi',
      }),
    );
    expect(r).toMatchObject({ emergency: true });
    expect(r.numbers.map((n: any) => n.number)).toEqual(['1122', '115']);
    expect(r.flags.map((f: any) => f.id)).toEqual(
      expect.arrayContaining(['chest_pain', 'breathing']),
    );
    expect(model.calls).toBe(0);
  });

  it('QA #24 a shop partner calling /health/doctor/today → 403 WRONG_SERVICE', async () => {
    const shop = await approvedPartner(t, admin, 'store');
    const res = await shop.api.get('/health/doctor/today');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WRONG_SERVICE');
  });

  it('QA #25 approving a doctor business without PMDC verification → PMDC_NOT_VERIFIED', async () => {
    const { businessId } = await submittedDoctor(t);
    const res = await admin.api.post(`/admin/businesses/${businessId}/approve`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PMDC_NOT_VERIFIED');
    const [b] = await sql(`SELECT status FROM businesses WHERE id = $1`, [
      businessId,
    ]);
    expect(b.status).toBe('pending_approval');
  });

  it('QA #26 running every job twice leaves identical state', async () => {
    const { d, loc } = await doctor();
    const p = await shopper(t);
    const due = await book(p, d, loc.id, 0);
    await moveTo(due.code, -180); // never checked in, ended > 2 h ago → auto no-show
    const soon = await book(await shopper(t), d, loc.id, 2);
    await moveTo(soon.code, 50); // inside the 1 h reminder
    const at = new Date();
    const all = async () => {
      await jobs.cancelUnpaidPrepay(at);
      await jobs.autoNoShow(at);
      await jobs.reminders(at);
      await jobs.refreshNextAvailable(at);
      await jobs.doctorDigest(at);
      await jobs.nightlyRun(at);
    };
    const digest = async () =>
      (
        await sql(`SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
           SELECT concat_ws(',', id, status, payment_status, reminded_24h_at, reminded_1h_at) AS x FROM appointments
           UNION ALL SELECT concat_ws(',', id, rating_avg, rating_count, satisfaction_pct, avg_wait_minutes, avg_consult_minutes,
                                      patients_served, completed_30d, is_top_booked, next_available_at, daily_digest_on) FROM doctors
           UNION ALL SELECT concat_ws(',', id, next_available_at) FROM practice_locations
           UNION ALL SELECT 'notifications:' || count(*) FROM notifications
           UNION ALL SELECT 'events:' || count(*) FROM appointment_events
           UNION ALL SELECT 'symptom-text:' || count(text) FROM symptom_checks
         ) s`)
      )[0].h;
    await all();
    const [{ status }] = await sql(
      `SELECT status FROM appointments WHERE code = $1`,
      [due.code],
    );
    expect(status).toBe('no_show');
    const once = await digest();
    await all();
    expect(await digest()).toBe(once);
  });
});
