import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
import { Admin, shopper, testIban } from './utils/shopping';
import {
  Doctor,
  addClinic,
  approvedDoctor,
  expectOk,
  fullProfile,
  setSchedule,
  specialtyId,
} from './utils/health';
import {
  APPOINTMENT_FAULT_INJECTOR,
  AppointmentFaultInjector,
} from '../src/modules/healthcare/appointments/appointments.service';
import { HealthJobsService } from '../src/modules/healthcare/jobs/health-jobs.service';

const fault: AppointmentFaultInjector & { armed: boolean } = {
  armed: false,
  afterOldCancelled(_m: EntityManager) {
    if (fault.armed)
      throw new Error(
        'injected failure after the old appointment was cancelled',
      );
  },
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map(
  (w) => [w, '00:00', '24:00'] as [number, string, string],
);

describe('Healthcare P3: booking, family, reschedule, cancel, payments, jobs (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: HealthJobsService;

  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const book = (p: SignedUp, body: object, key: string = randomUUID()) =>
    p.api.post('/health/appointments', body).set('Idempotency-Key', key);

  /** A listed doctor: one clinic open all day, every day; no notice; 120-min cutoff. */
  async function openDoctor(over: Record<string, unknown> = {}) {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'general-physician')),
        minNoticeMinutes: 0,
        cancelCutoffMinutes: 120,
        ...over,
      }),
    );
    const clinic = await addClinic(d, { fee: 2000, slotMinutes: 15 });
    await setSchedule(d, clinic.id, ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    return { d, clinic };
  }

  /**
   * Free slot instants for a location, from tomorrow 09:00 — well outside any
   * cutoff whatever the time of day (tomorrow 00:15 is inside one at 23:30).
   */
  async function slots(d: Doctor, locationId: string, day = 1) {
    const res = await new ApiClient(t.http)
      .get(
        `/health/doctors/${d.doctorId}/locations/${locationId}/slots?days=${day + 1}`,
      )
      .expect(200);
    return res.body.data.days[day].slots
      .filter((s: any) => day === 0 || Number(s.startsAt.slice(11, 13)) >= 9)
      .map((s: any) => s.startsAt as string);
  }

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) =>
        b.overrideProvider(APPOINTMENT_FAULT_INJECTOR).useValue(fault),
    });
    jobs = t.app.get(HealthJobsService);
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('ten patients race for one slot: exactly one wins, nine get SLOT_TAKEN with alternatives', async () => {
    const { d, clinic } = await openDoctor();
    const [slot] = await slots(d, clinic.id);
    const patients = await Promise.all(
      Array.from({ length: 10 }, () => shopper(t)),
    );
    const results = await Promise.all(
      patients.map((p) =>
        book(p, {
          doctorId: d.doctorId,
          locationId: clinic.id,
          startsAt: slot,
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([
      201, 409, 409, 409, 409, 409, 409, 409, 409, 409,
    ]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('SLOT_TAKEN');
      expect(r.body.error.details.alternatives).toHaveLength(3);
      expect(
        r.body.error.details.alternatives.map((a: any) => a.startsAt),
      ).not.toContain(slot);
    }
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1`,
      [d.doctorId],
    );
    expect(n).toBe(1);
    // The slot is gone from availability.
    expect(await slots(d, clinic.id)).not.toContain(slot);
  });

  it('a doctor cannot be booked at two clinics at once — by the service and by the database', async () => {
    const { d, clinic: a } = await openDoctor();
    const patient = await shopper(t);
    const [slot] = await slots(d, a.id);
    const first = await book(patient, {
      doctorId: d.doctorId,
      locationId: a.id,
      startsAt: slot,
    }).expect(201);
    // Move the doctor's hours to clinic B; the booking at A still holds the time.
    await setSchedule(d, a.id, []);
    const b = await addClinic(d, { name: 'Second clinic', area: 'Model Town' });
    await setSchedule(d, b.id, ALL_DAY);
    // Clearing A's hours briefly left no hours at all, which unlists a doctor; publish again.
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    const other = await shopper(t);
    const res = await book(other, {
      doctorId: d.doctorId,
      locationId: b.id,
      startsAt: slot,
    }).expect(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
    // Even a write that skips the service is refused by the exclusion constraint.
    await expect(
      sql(
        `INSERT INTO appointments (code, patient_user_id, patient_snapshot, doctor_id, location_id, kind, starts_at, ends_at,
                                   status, symptoms, fee, payment_method, payment_status)
         SELECT 'HC-RAW001', $1, '{}'::jsonb, doctor_id, $2, kind, starts_at, ends_at, 'booked', '{}', 0, payment_method, payment_status
           FROM appointments WHERE code = $3`,
        [other.userId, b.id, first.body.data.code],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('only real slots, server-priced; idempotent; overlap and per-doctor limits', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const [s1, s2, s3, s4, s5] = await slots(d, clinic.id);
    // 7 minutes off the 15-minute grid, and one second off it.
    const offGrid = new Date(new Date(s1).getTime() + 7 * 60_000).toISOString();
    const offBySecond = new Date(new Date(s1).getTime() + 1000).toISOString();
    for (const startsAt of [offGrid, offBySecond]) {
      const r = await book(p, {
        doctorId: d.doctorId,
        locationId: clinic.id,
        startsAt,
      }).expect(400);
      expect(r.body.error.code).toBe('SLOT_INVALID');
    }
    const missing = await p.api
      .post('/health/appointments', {
        doctorId: d.doctorId,
        locationId: clinic.id,
        startsAt: s1,
      })
      .expect(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = randomUUID();
    const made = await book(
      p,
      { doctorId: d.doctorId, locationId: clinic.id, startsAt: s1, fee: 1 },
      key,
    ).expect(201);
    expect(made.body.data).toMatchObject({
      status: 'booked',
      kind: 'clinic',
      fee: 2000, // from the location, not the client
      code: expect.stringMatching(/^HC-[A-HJKMNP-Z2-9]{6}$/),
      startsAt: s1,
      payment: {
        method: 'pay_at_clinic',
        status: 'unpaid',
        payBy: null,
        accounts: null,
      },
      can: { cancel: true, reschedule: true, joinVideo: false },
    });
    expect(made.body.data.events).toEqual([
      expect.objectContaining({
        kind: 'status',
        to: 'booked',
        actorRole: 'patient',
      }),
    ]);
    const replay = await book(
      p,
      { doctorId: d.doctorId, locationId: clinic.id, startsAt: s1 },
      key,
    ).expect(201);
    expect(replay.body).toEqual(made.body);

    // The same person can't be in two places; another doctor at the same time → PATIENT_OVERLAP.
    const { d: d2, clinic: c2 } = await openDoctor();
    const clash = await book(p, {
      doctorId: d2.doctorId,
      locationId: c2.id,
      startsAt: s1,
    }).expect(409);
    expect(clash.body.error).toMatchObject({
      code: 'PATIENT_OVERLAP',
      details: { appointmentCode: made.body.data.code },
    });

    await book(p, {
      doctorId: d.doctorId,
      locationId: clinic.id,
      startsAt: s2,
    }).expect(201);
    await book(p, {
      doctorId: d.doctorId,
      locationId: clinic.id,
      startsAt: s3,
    }).expect(201);
    const fourth = await book(p, {
      doctorId: d.doctorId,
      locationId: clinic.id,
      startsAt: s4,
    }).expect(409);
    expect(fourth.body.error).toMatchObject({
      code: 'BOOKING_LIMIT',
      details: { limit: 3 },
    });
    void s5;

    const mine = await p.api
      .get('/health/appointments?scope=upcoming')
      .expect(200);
    expect(mine.body.data.total).toBe(3);
    const stranger = await shopper(t);
    await stranger.api
      .get(`/health/appointments/${made.body.data.code}`)
      .expect(404);
    await stranger.api
      .post(`/health/appointments/${made.body.data.code}/cancel`, {
        reason: 'not mine',
      })
      .expect(404);
  });

  it('booking for a family member snapshots their name and age', async () => {
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
    const [slot] = await slots(d, clinic.id);
    const r = await book(parent, {
      doctorId: d.doctorId,
      locationId: clinic.id,
      startsAt: slot,
      familyMemberId: child.id,
      reason: 'Fever',
    }).expect(201);
    expect(r.body.data.patient).toEqual({
      name: 'Zara Khan',
      gender: 'female',
      age: child.age,
      phone: null,
      relation: 'child',
    });
    // Parent and child may be booked at the same time (different people).
    const { d: d2, clinic: c2 } = await openDoctor();
    await book(parent, {
      doctorId: d2.doctorId,
      locationId: c2.id,
      startsAt: slot,
    }).expect(201);
    const other = await shopper(t);
    await book(other, {
      doctorId: d.doctorId,
      locationId: clinic.id,
      startsAt: (await slots(d, clinic.id))[0],
      familyMemberId: child.id,
    }).expect(404);
    for (let i = 0; i < 7; i++)
      await expectOk(
        await parent.api.post('/health/family-members', {
          fullName: `Member ${i}`,
          relation: 'other',
        }),
        201,
      );
    await parent.api
      .post('/health/family-members', { fullName: 'Ninth', relation: 'other' })
      .expect(400);
  });

  it('reschedule is atomic, once only; cancel inside the cutoff is late; after the start it is refused', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const [a, b, c] = await slots(d, clinic.id);
    const made = (
      await book(p, {
        doctorId: d.doctorId,
        locationId: clinic.id,
        startsAt: a,
      }).expect(201)
    ).body.data;

    fault.armed = true;
    try {
      await p.api
        .post(`/health/appointments/${made.code}/reschedule`, { startsAt: b })
        .set('Idempotency-Key', randomUUID())
        .expect(500);
    } finally {
      fault.armed = false;
    }
    const still = (
      await p.api.get(`/health/appointments/${made.code}`).expect(200)
    ).body.data;
    expect(still.status).toBe('booked');
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM appointments WHERE patient_user_id = $1`,
      [p.userId],
    );
    expect(n).toBe(1);

    const moved = (
      await p.api
        .post(`/health/appointments/${made.code}/reschedule`, { startsAt: b })
        .set('Idempotency-Key', randomUUID())
        .expect(200)
    ).body.data;
    expect(moved).toMatchObject({
      status: 'booked',
      startsAt: b,
      rescheduledFromId: made.id,
    });
    const old = (
      await p.api.get(`/health/appointments/${made.code}`).expect(200)
    ).body.data;
    expect(old).toMatchObject({
      status: 'cancelled',
      cancelReason: 'rescheduled',
      payment: { status: 'void' },
    });
    expect(await slots(d, clinic.id)).toContain(a); // the old time is free again
    const twice = await p.api
      .post(`/health/appointments/${moved.code}/reschedule`, { startsAt: c })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    expect(twice.body.error.code).toBe('RESCHEDULE_NOT_ALLOWED');

    // Starting within the 120-min cutoff: allowed, but late.
    const soon = new Date(Date.now() + 60 * 60_000);
    await sql(
      `UPDATE appointments SET starts_at = $2, ends_at = $3 WHERE code = $1`,
      [moved.code, soon, new Date(soon.getTime() + 15 * 60_000)],
    );
    const late = (
      await p.api
        .post(`/health/appointments/${moved.code}/cancel`, {
          reason: 'Stuck in traffic',
        })
        .expect(200)
    ).body.data;
    expect(late).toMatchObject({
      status: 'cancelled',
      lateCancel: true,
      cancelledBy: 'patient',
      payment: { status: 'void' },
    });

    const another = (
      await book(p, {
        doctorId: d.doctorId,
        locationId: clinic.id,
        startsAt: c,
      }).expect(201)
    ).body.data;
    const past = new Date(Date.now() - 5 * 60_000);
    await sql(
      `UPDATE appointments SET starts_at = $2, ends_at = $3 WHERE code = $1`,
      [another.code, past, new Date(past.getTime() + 15 * 60_000)],
    );
    const tooLate = await p.api
      .post(`/health/appointments/${another.code}/cancel`, { reason: 'Forgot' })
      .expect(409);
    expect(tooLate.body.error.code).toBe('CANCEL_CUTOFF_PASSED');
  });

  it('prepaid video: proof → rejected → proof → confirmed; unpaid at pay_by is cancelled and the slot freed', async () => {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'psychologist')),
        minNoticeMinutes: 0,
      }),
    );
    await d.api
      .patch('/health/doctor/profile', { videoPrepayRequired: true })
      .expect(400); // no account yet
    const iban = testIban();
    await expectOk(
      await d.api.post('/health/doctor/payment-accounts', {
        kind: 'bank',
        accountTitle: 'Dr Psych',
        accountNumber: iban,
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
    const [s1, s2] = await slots(d, video.id);
    await book(p, {
      doctorId: d.doctorId,
      locationId: video.id,
      startsAt: s1,
      paymentMethod: 'pay_at_clinic',
    }).expect(400);
    const a = (
      await book(p, {
        doctorId: d.doctorId,
        locationId: video.id,
        startsAt: s1,
      }).expect(201)
    ).body.data;
    expect(a.payment).toMatchObject({
      method: 'transfer',
      status: 'awaiting_transfer',
      accounts: [{ kind: 'bank', accountNumber: iban }],
    });
    const payBy = new Date(a.payment.payBy).getTime();
    expect(payBy).toBeGreaterThan(Date.now() + 100 * 60_000); // ≈ booked + 2 h (start is ≥ 1 day out)
    expect(payBy).toBeLessThanOrEqual(Date.now() + 121 * 60_000);

    const P = (s: string) => `/health/appointments/${a.code}/${s}`;
    const D = (s: string) => `/health/doctor/appointments/${a.code}/${s}`;
    await p.api.post(P('payment-proof'), { paymentRef: 'IBFT 1' }).expect(200);
    const rejected = (
      await d.api
        .post(D('payment/reject'), { reason: 'Nothing arrived' })
        .expect(200)
    ).body.data;
    expect(rejected.payment).toMatchObject({
      status: 'awaiting_transfer',
      rejectedReason: 'Nothing arrived',
    });
    await p.api.post(P('payment-proof'), { paymentRef: 'IBFT 2' }).expect(200);
    const paid = (await d.api.post(D('payment/confirm')).expect(200)).body.data;
    expect(paid.payment).toMatchObject({
      status: 'paid',
      paymentRef: 'IBFT 2',
    });

    // A second booking left unpaid past its deadline is cancelled by the job.
    const b = (
      await book(p, {
        doctorId: d.doctorId,
        locationId: video.id,
        startsAt: s2,
      }).expect(201)
    ).body.data;
    await sql(
      `UPDATE appointments SET pay_by = now() - interval '1 minute' WHERE code = $1`,
      [b.code],
    );
    expect((await jobs.cancelUnpaidPrepay()).cancelled).toBeGreaterThanOrEqual(
      1,
    );
    const after = (
      await p.api.get(`/health/appointments/${b.code}`).expect(200)
    ).body.data;
    expect(after).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      payment: { status: 'void' },
    });
    expect(await slots(d, video.id)).toContain(s2);
    for (const userId of [p.userId, d.userId]) {
      const n = await sql(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'health.appointment.cancelled' AND data->>'appointmentCode' = $2`,
        [userId, b.code],
      );
      expect(n).toHaveLength(1);
    }
    expect(await jobs.cancelUnpaidPrepay()).toEqual({ cancelled: 0 });

    // Doctor cancels the paid one: a reason is required, and the fee becomes refund_due.
    await d.api.post(D('cancel'), {}).expect(400);
    const cancelled = (
      await d.api
        .post(D('cancel'), { reason: 'Emergency at hospital' })
        .expect(200)
    ).body.data;
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'doctor',
      payment: { status: 'refund_due' },
    });
    const refunded = (
      await d.api.post(D('refund'), { refundRef: 'IBFT 9001' }).expect(200)
    ).body.data;
    expect(refunded.payment).toMatchObject({
      status: 'refunded',
      refundRef: 'IBFT 9001',
    });
    const other = await approvedDoctor(t, admin);
    await other.api.post(D('payment/confirm')).expect(404);
  });

  it('time off and closing a location respect booked patients; no-shows are marked by the job', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const [s1] = await slots(d, clinic.id);
    const a = (
      await book(p, {
        doctorId: d.doctorId,
        locationId: clinic.id,
        startsAt: s1,
      }).expect(201)
    ).body.data;

    const closing = await d.api
      .patch(`/health/doctor/locations/${clinic.id}`, { isActive: false })
      .expect(409);
    expect(closing.body.error).toMatchObject({
      code: 'LOCATION_HAS_BOOKINGS',
      details: { appointments: [{ code: a.code }] },
    });

    const start = new Date(new Date(s1).getTime() - 60 * 60_000).toISOString();
    const end = new Date(new Date(s1).getTime() + 60 * 60_000).toISOString();
    const conflict = await d.api
      .post('/health/doctor/time-off', { startsAt: start, endsAt: end })
      .expect(409);
    expect(conflict.body.error).toMatchObject({
      code: 'TIME_OFF_CONFLICTS',
      details: { appointments: [{ code: a.code }] },
    });
    await d.api
      .post('/health/doctor/time-off', {
        startsAt: start,
        endsAt: end,
        reason: 'Family emergency',
        cancelAffected: true,
      })
      .expect(201);
    const gone = (await p.api.get(`/health/appointments/${a.code}`).expect(200))
      .body.data;
    expect(gone).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      cancelReason: 'Family emergency',
    });
    expect(await slots(d, clinic.id)).not.toContain(s1);

    // A booked visit 2 h past its end with no check-in becomes a no-show.
    const [s2] = await slots(d, clinic.id, 2);
    const b = (
      await book(p, {
        doctorId: d.doctorId,
        locationId: clinic.id,
        startsAt: s2,
      }).expect(201)
    ).body.data;
    await sql(
      `UPDATE appointments SET starts_at = now() - interval '3 hours', ends_at = now() - interval '165 minutes' WHERE code = $1`,
      [b.code],
    );
    expect((await jobs.autoNoShow()).noShows).toBeGreaterThanOrEqual(1);
    expect(
      (await p.api.get(`/health/appointments/${b.code}`).expect(200)).body.data,
    ).toMatchObject({ status: 'no_show', payment: { status: 'void' } });
    expect(await jobs.autoNoShow()).toEqual({ noShows: 0 });
  });
});
