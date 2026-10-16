import { randomUUID } from 'crypto';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
import { Admin, asset, shopper } from './utils/shopping';
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

const RX = {
  diagnosis: 'Acne vulgaris (moderate)',
  advice: 'Gentle cleanser twice a day.',
  followUpInDays: 30,
  medicines: [
    {
      name: 'Doxycycline',
      strength: '100 mg',
      form: 'capsule',
      dosePattern: '1+0+0',
      timing: 'after_meal',
      durationDays: 30,
    },
    {
      name: 'Adapalene',
      strength: '0.1%',
      form: 'cream',
      dosePattern: '0+0+1',
      timing: 'bedtime',
    },
  ],
  tests: [{ name: 'CBC' }],
};

describe('Healthcare P4: doctor workflow, notes, prescriptions, PHI, insights (e2e)', () => {
  let t: TestApp;
  let admin: Admin;

  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  async function openDoctor() {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'dermatologist')),
        minNoticeMinutes: 0,
        cancelCutoffMinutes: 60,
      }),
    );
    const clinic = await addClinic(d, { fee: 2000, slotMinutes: 15 });
    await setSchedule(d, clinic.id, ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    return { d, clinic };
  }

  async function slot(d: Doctor, locationId: string, index = 0) {
    const res = await new ApiClient(t.http)
      .get(`/health/doctors/${d.doctorId}/locations/${locationId}/slots?days=2`)
      .expect(200);
    return res.body.data.days[1].slots[index].startsAt as string;
  }

  async function book(
    p: SignedUp,
    d: Doctor,
    locationId: string,
    over: Record<string, unknown> = {},
    index = 0,
  ) {
    return expectOk(
      await p.api
        .post('/health/appointments', {
          doctorId: d.doctorId,
          locationId,
          startsAt: await slot(d, locationId, index),
          reason: 'Acne for six months',
          ...over,
        })
        .set('Idempotency-Key', randomUUID()),
      201,
    );
  }

  /** Move an appointment so it starts `minutesAgo` minutes ago (15-minute slot). */
  const startedAgo = (code: string, minutesAgo: number) =>
    sql(
      `UPDATE appointments SET starts_at = now() - make_interval(mins => $2),
              ends_at = now() - make_interval(mins => $2) + interval '15 minutes'
        WHERE code = $1`,
      [code, minutesAgo],
    );

  /**
   * n 15-minute starts, 20 minutes apart, all inside today's PKT date (UTC+5,
   * no DST) and as close to "10 minutes ago" as the day allows — so queue
   * tests don't flake around local midnight.
   */
  function todayPlacements(n: number): Date[] {
    const PKT = 5 * 3600e3;
    const DAY = 86400e3;
    const now = Date.now();
    const midnight = Math.floor((now + PKT) / DAY) * DAY - PKT;
    const span = (n - 1) * 20 * 60e3 + 15 * 60e3;
    let first = Math.max(midnight + 60e3, now - 10 * 60e3);
    if (first + span > midnight + DAY - 60e3)
      first = midnight + DAY - 60e3 - span;
    return Array.from({ length: n }, (_, i) => new Date(first + i * 20 * 60e3));
  }

  const placeAt = (code: string, at: Date) =>
    sql(
      `UPDATE appointments SET starts_at = $2, ends_at = $2::timestamptz + interval '15 minutes' WHERE code = $1`,
      [code, at],
    );

  const phiReads = async (userId: string) =>
    (
      await sql(
        `SELECT target_type, target_id, details FROM operational_audit_events
          WHERE action = 'phi.read' AND actor_user_id = $1 ORDER BY created_at`,
        [userId],
      )
    ).map((r: any) => `${r.target_type}:${r.details.what}`);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('today queue → check-in → start → complete with payment; clinic start needs check-in', async () => {
    const { d, clinic } = await openDoctor();
    const p1 = await shopper(t);
    const p2 = await shopper(t);
    const a1 = await book(p1, d, clinic.id, {}, 0);
    const a2 = await book(p2, d, clinic.id, {}, 2);
    const [at1, at2] = todayPlacements(2);
    await placeAt(a1.code, at1);
    await placeAt(a2.code, at2);

    let today = await expectOk(await d.api.get('/health/doctor/today'));
    expect(today.queue.map((q: any) => q.code)).toEqual([a1.code, a2.code]);
    expect(today.queue[0]).toMatchObject({
      status: 'booked',
      flags: { firstVisit: true, lateCancels: 0, noShows: 0 },
      can: { checkIn: true, start: false },
    });

    const early = await d.api.post(
      `/health/doctor/appointments/${a1.code}/start`,
    );
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_TRANSITION');

    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a2.code}/check-in`),
    );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a1.code}/check-in`),
    );
    await sql(
      `UPDATE appointments SET checked_in_at = now() - interval '7 minutes' WHERE code = $1`,
      [a1.code],
    );
    today = await expectOk(await d.api.get('/health/doctor/today'));
    // Both waiting, in arrival order: a1 was back-dated to arrive first.
    expect(today.queue.map((q: any) => [q.code, q.status])).toEqual([
      [a1.code, 'checked_in'],
      [a2.code, 'checked_in'],
    ]);
    // Waiting counts from arrival or the booked start, whichever is later.
    const [{ waited }] = await sql(
      `SELECT greatest(0, floor(extract(epoch FROM now() - greatest(checked_in_at, starts_at)) / 60))::int AS waited
         FROM appointments WHERE code = $1`,
      [a1.code],
    );
    expect(
      Math.abs(today.queue[0].waitingMinutes - waited),
    ).toBeLessThanOrEqual(1);
    expect(today.counts).toMatchObject({ total: 2, waiting: 2 });

    const started = await expectOk(
      await d.api.post(`/health/doctor/appointments/${a1.code}/start`),
    );
    expect(started.status).toBe('in_consultation');
    today = await expectOk(await d.api.get('/health/doctor/today'));
    expect(today.queue[0].code).toBe(a1.code);

    const done = await expectOk(
      await d.api.post(`/health/doctor/appointments/${a1.code}/complete`, {
        paymentCollected: true,
      }),
    );
    expect(done).toMatchObject({
      status: 'completed',
      payment: { method: 'pay_at_clinic', status: 'paid' },
    });
    // Completing twice is a state error, not a silent success.
    const again = await d.api.post(
      `/health/doctor/appointments/${a1.code}/complete`,
    );
    expect(again.status).toBe(409);

    // The patient's timeline shows the visit.
    const mine = await expectOk(
      await p1.api.get(`/health/appointments/${a1.code}`),
    );
    expect(mine.events.map((e: any) => e.to).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'checked_in',
        'in_consultation',
        'completed',
        'paid',
      ]),
    );

    // Doctor list filters by status.
    const list = await expectOk(
      await d.api.get('/health/doctor/appointments?status=completed'),
    );
    expect(list.items.map((i: any) => i.code)).toEqual([a1.code]);
  });

  it('no-show only from 15 minutes after the start; outstanding payment is voided', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const a = await book(p, d, clinic.id);
    await startedAgo(a.code, 5);
    const tooEarly = await d.api.post(
      `/health/doctor/appointments/${a.code}/no-show`,
    );
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('INVALID_TRANSITION');

    await startedAgo(a.code, 20);
    const ns = await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/no-show`),
    );
    expect(ns).toMatchObject({
      status: 'no_show',
      payment: { status: 'void' },
    });

    // The next booking by the same patient carries the flag.
    const b = await book(p, d, clinic.id, {}, 3);
    const detail = await expectOk(
      await d.api.get(`/health/doctor/appointments/${b.code}`),
    );
    expect(detail.flags).toMatchObject({ firstVisit: true, noShows: 1 });
    expect(detail.history.previousAppointments.map((x: any) => x.code)).toEqual(
      [a.code],
    );
  });

  it('A5: an unrelated doctor gets 404 for the appointment, notes, prescription and patient; reads are audited', async () => {
    const { d, clinic } = await openDoctor();
    const { d: other } = await openDoctor();
    const p = await shopper(t);
    const a = await book(p, d, clinic.id);

    for (const path of [
      `/health/doctor/appointments/${a.code}`,
      `/health/doctor/appointments/${a.code}/notes`,
      `/health/doctor/appointments/${a.code}/prescription`,
      `/health/doctor/patients/${p.userId}`,
    ]) {
      const res = await other.api.get(path);
      expect([path, res.status, res.body.error?.code]).toEqual([
        path,
        404,
        'NOT_FOUND',
      ]);
    }
    for (const path of ['check-in', 'start', 'complete', 'no-show']) {
      const res = await other.api.post(
        `/health/doctor/appointments/${a.code}/${path}`,
      );
      expect(res.status).toBe(404);
    }
    const put = await other.api.put(
      `/health/doctor/appointments/${a.code}/notes`,
      { text: 'nope' },
    );
    expect(put.status).toBe(404);
    expect(await phiReads(other.userId)).toEqual([]);
    const otherPatients = await expectOk(
      await other.api.get('/health/doctor/patients'),
    );
    expect(otherPatients.total).toBe(0);

    // The treating doctor sees the patient and every read leaves a trail.
    await expectOk(await d.api.get(`/health/doctor/appointments/${a.code}`));
    const person = await expectOk(
      await d.api.get(`/health/doctor/patients/${p.userId}`),
    );
    expect(person).toMatchObject({ patientKey: p.userId, visits: 1 });
    await expectOk(
      await d.api.get(`/health/doctor/appointments/${a.code}/notes`),
    );
    expect(await phiReads(d.userId)).toEqual([
      'appointment:appointment',
      'patient:patient_history',
      'appointment:notes',
    ]);
    const patients = await expectOk(
      await d.api.get(
        `/health/doctor/patients?q=${encodeURIComponent(person.name.slice(0, 4))}`,
      ),
    );
    expect(patients.items.map((x: any) => x.patientKey)).toEqual([p.userId]);
  });

  it('family members are their own patients: separate keys and histories', async () => {
    const { d, clinic } = await openDoctor();
    const parent = await shopper(t);
    const child = await expectOk(
      await parent.api.post('/health/family-members', {
        fullName: 'Zara Khan',
        relation: 'child',
        gender: 'female',
        dateOfBirth: '2019-04-12',
      }),
      201,
    );
    await book(parent, d, clinic.id, {}, 0);
    await book(parent, d, clinic.id, { familyMemberId: child.id }, 2);
    const list = await expectOk(await d.api.get('/health/doctor/patients'));
    expect(list.items.map((x: any) => x.patientKey).sort()).toEqual(
      [parent.userId, child.id].sort(),
    );
    const kid = await expectOk(
      await d.api.get(`/health/doctor/patients/${child.id}`),
    );
    expect(kid).toMatchObject({
      name: 'Zara Khan',
      relation: 'child',
      visits: 1,
    });
  });

  it('notes persist with files signed for medical_note; foreign files are refused; patients never see notes', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const a = await book(p, d, clinic.id);
    const file = asset(d.userId, 'medical_note');
    const saved = await expectOk(
      await d.api.put(`/health/doctor/appointments/${a.code}/notes`, {
        text: 'Comedonal acne. Start adapalene.',
        files: [{ ...file, mime: 'application/pdf' }],
      }),
    );
    expect(saved).toMatchObject({
      text: 'Comedonal acne. Start adapalene.',
      files: [
        { url: file.url, publicId: file.publicId, mime: 'application/pdf' },
      ],
    });
    const updated = await expectOk(
      await d.api.put(`/health/doctor/appointments/${a.code}/notes`, {
        text: 'Updated.',
        files: [],
      }),
    );
    expect(updated).toMatchObject({ text: 'Updated.', files: [] });

    const foreign = await d.api.put(
      `/health/doctor/appointments/${a.code}/notes`,
      { text: 'x', files: [asset(p.userId, 'medical_note')] },
    );
    expect(foreign.status).toBe(400);
    const wrongPurpose = await d.api.put(
      `/health/doctor/appointments/${a.code}/notes`,
      { text: 'x', files: [asset(d.userId, 'doctor_photo')] },
    );
    expect(wrongPurpose.status).toBe(400);

    const mine = await expectOk(
      await p.api.get(`/health/appointments/${a.code}`),
    );
    expect(JSON.stringify(mine)).not.toContain('adapalene');
    expect(JSON.stringify(mine)).not.toContain('Updated.');
  });

  it('A4 + lock: prescriptions from in_consultation, visible to the patient and prescribing doctor only, locked 24 h after completion', async () => {
    const { d, clinic } = await openDoctor();
    const { d: other } = await openDoctor();
    const p = await shopper(t);
    const stranger = await shopper(t);
    const a = await book(p, d, clinic.id);
    const rxPath = `/health/doctor/appointments/${a.code}/prescription`;

    const notStarted = await d.api.post(rxPath, RX);
    expect(notStarted.status).toBe(409);
    expect(notStarted.body.error).toMatchObject({
      code: 'PRESCRIPTION_LOCKED',
      details: { reason: 'not_in_consultation' },
    });

    await startedAgo(a.code, 2);
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/check-in`),
    );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/start`),
    );
    const rx = await expectOk(await d.api.post(rxPath, RX), 201);
    expect(rx).toMatchObject({
      appointmentCode: a.code,
      diagnosis: RX.diagnosis,
      locked: false,
      doctor: { qualifications: 'MBBS', specialty: 'Dermatologist' },
      medicines: [
        { name: 'Doxycycline', dosePattern: '1+0+0', timing: 'after_meal' },
        { name: 'Adapalene', form: 'cream' },
      ],
      tests: [{ name: 'CBC' }],
    });
    expect(rx.doctor.pmdcNumber).toMatch(/^[A-Z0-9-]+$/);
    expect(rx.followUpOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The patient reads it; nobody else does.
    const patientView = await expectOk(
      await p.api.get(`/health/prescriptions/${rx.id}`),
    );
    expect(patientView.id).toBe(rx.id);
    const mine = await expectOk(await p.api.get('/health/prescriptions'));
    expect(mine).toMatchObject({ total: 1, page: 1 });
    expect(
      (await stranger.api.get(`/health/prescriptions/${rx.id}`)).status,
    ).toBe(404);
    expect(
      (await other.api.get(`/health/doctor/prescriptions/${rx.id}`)).status,
    ).toBe(404);
    expect((await other.api.post(rxPath, RX)).status).toBe(404);
    // The prescribing doctor can read it (the FYP's A4 blocked exactly this).
    await expectOk(await d.api.get(`/health/doctor/prescriptions/${rx.id}`));
    expect(await phiReads(d.userId)).toContain('prescription:prescription');

    // Replace within the window keeps the id; favourites count each medicine once.
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/complete`),
    );
    const replaced = await expectOk(
      await d.api.post(rxPath, {
        ...RX,
        medicines: [
          { ...RX.medicines[0], dosePattern: '1+0+1' },
          {
            name: 'Paracetamol',
            strength: '500 mg',
            form: 'tablet',
            dosePattern: '1+1+1',
            timing: 'as_needed',
          },
        ],
      }),
      201,
    );
    expect(replaced.id).toBe(rx.id);
    expect(replaced.medicines.map((m: any) => m.name)).toEqual([
      'Doxycycline',
      'Paracetamol',
    ]);
    const favs = await sql(
      `SELECT name, dose_pattern, use_count FROM doctor_medicine_favourites WHERE doctor_id = $1 ORDER BY name`,
      [d.doctorId],
    );
    expect(favs).toEqual([
      { name: 'Adapalene', dose_pattern: '0+0+1', use_count: 1 },
      { name: 'Doxycycline', dose_pattern: '1+0+1', use_count: 1 },
      { name: 'Paracetamol', dose_pattern: '1+1+1', use_count: 1 },
    ]);

    // 24 h after completion it is immutable.
    await sql(
      `UPDATE appointments SET completed_at = now() - interval '24 hours 1 minute' WHERE code = $1`,
      [a.code],
    );
    const locked = await d.api.post(rxPath, RX);
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatchObject({
      code: 'PRESCRIPTION_LOCKED',
      details: { reason: 'window_closed' },
    });
    const current = await expectOk(await d.api.get(rxPath));
    expect(current.locked).toBe(true);
    expect(current.prescription.medicines).toHaveLength(2);
  });

  it('medicine suggest: the doctor’s favourites first, then the reference list (typo tolerant)', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const a = await book(p, d, clinic.id);
    await startedAgo(a.code, 1);
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/check-in`),
    );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/start`),
    );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${a.code}/prescription`, {
        diagnosis: 'Fever',
        medicines: [
          {
            name: 'Paracetamol',
            strength: '500 mg',
            form: 'tablet',
            dosePattern: '1+1+1',
            timing: 'after_meal',
            durationDays: 3,
          },
        ],
      }),
      201,
    );
    const s = await expectOk(
      await d.api.get('/health/doctor/medicines/suggest?q=parac'),
    );
    expect(s.medicines[0]).toMatchObject({
      source: 'favourite',
      name: 'Paracetamol',
      strength: '500 mg',
      dosePattern: '1+1+1',
    });
    // The favourite isn't repeated from the reference list.
    expect(
      s.medicines.filter(
        (m: any) =>
          m.name === 'Paracetamol' &&
          m.strength === '500 mg' &&
          m.form === 'tablet',
      ),
    ).toHaveLength(1);
    expect(s.medicines.some((m: any) => m.source === 'reference')).toBe(true);
    const typo = await expectOk(
      await d.api.get('/health/doctor/medicines/suggest?q=amoxcillin'),
    );
    expect(typo.medicines[0].name).toBe('Amoxicillin');
    expect((await d.api.get('/health/doctor/medicines/suggest')).status).toBe(
      400,
    );
  });

  it('insights: per-day volume, rates, wait/consult times, new vs returning, recorded fees', async () => {
    const { d, clinic } = await openDoctor();
    const p1 = await shopper(t);
    const p2 = await shopper(t);
    const a = await book(p1, d, clinic.id, {}, 0);
    const b = await book(p2, d, clinic.id, {}, 2);
    const c = await book(p1, d, clinic.id, {}, 4);
    // a: completed yesterday (12 min wait, 20 min consult, paid); b: no-show; c: cancelled.
    await sql(
      `UPDATE appointments SET status = 'completed', payment_status = 'paid', paid_at = now(),
              starts_at = now() - interval '1 day', ends_at = now() - interval '1 day' + interval '15 minutes',
              checked_in_at = now() - interval '1 day' - interval '5 minutes',
              started_at = now() - interval '1 day' + interval '12 minutes',
              completed_at = now() - interval '1 day' + interval '32 minutes'
        WHERE code = $1`,
      [a.code],
    );
    await startedAgo(b.code, 60);
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${b.code}/no-show`),
    );
    await expectOk(
      await p1.api.post(`/health/appointments/${c.code}/cancel`, {
        reason: 'Travelling',
      }),
    );
    // Cancelled tomorrow's booking; count it in the range by dating it earlier today.
    await startedAgo(c.code, 180);

    const ins = await expectOk(
      await d.api.get('/health/doctor/insights?range=7d'),
    );
    expect(ins.perDay).toHaveLength(7);
    expect(ins.totals).toMatchObject({
      appointments: 3,
      completed: 1,
      cancelled: 1,
      noShow: 1,
    });
    expect(ins.rates).toEqual({
      completion: 0.333,
      cancellation: 0.333,
      noShow: 0.333,
    });
    expect(ins.times).toEqual({
      avgWaitMinutes: 12,
      waitSamples: 1,
      avgConsultMinutes: 20,
      consultSamples: 1,
    });
    expect(ins.patients).toEqual({ new: 1, returning: 0 });
    expect(ins.fees).toMatchObject({
      recorded: 2000,
      atClinic: 2000,
      byTransfer: 0,
    });
    expect((await d.api.get('/health/doctor/insights?range=1y')).status).toBe(
      400,
    );
  });

  it('patients cannot reach doctor routes and doctors cannot reach patient prescription routes', async () => {
    const { d } = await openDoctor();
    const p = await shopper(t);
    expect((await p.api.get('/health/doctor/today')).status).toBe(403);
    expect((await d.api.get('/health/prescriptions')).status).toBe(403);
  });
});
