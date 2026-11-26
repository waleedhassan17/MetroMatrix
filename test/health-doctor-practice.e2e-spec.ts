import { randomUUID } from 'crypto';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
import { HealthJobsService } from '../src/modules/healthcare/jobs/health-jobs.service';
import { Admin, shopper } from './utils/shopping';
import {
  Doctor,
  addClinic,
  approvedDoctor,
  expectOk,
  fullProfile,
  setSchedule,
  specialtyId,
} from './utils/health';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map(
  (w) => [w, '00:00', '24:00'] as [number, string, string],
);

/**
 * The doctor app's production rules (docs/API_HEALTH.md §4.3–4.4): clinic and
 * video sharing hours, a break after each patient, the schedule dry run, paused
 * bookings, day statuses and 30 days of slots, check-in from 2 hours before,
 * a clinic fee marked paid later, and an unlisting that is never silent.
 */
describe('Healthcare: doctor practice rules (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  const anon = () => new ApiClient(t.http);
  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);

  async function openDoctor(over: Record<string, unknown> = {}) {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'general-physician')),
        minNoticeMinutes: 0,
        cancelCutoffMinutes: 60,
        ...over,
      }),
    );
    const clinic = await addClinic(d, { fee: 2000, slotMinutes: 15 });
    await setSchedule(d, clinic.id, ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    return { d, clinic };
  }

  const slotsOf = async (d: Doctor, locationId: string, days = 2) =>
    expectOk(
      await anon().get(
        `/health/doctors/${d.doctorId}/locations/${locationId}/slots?days=${days}`,
      ),
    );

  const book = async (
    p: SignedUp,
    d: Doctor,
    locationId: string,
    startsAt: string,
    over: Record<string, unknown> = {},
  ) =>
    expectOk(
      await p.api
        .post('/health/appointments', {
          doctorId: d.doctorId,
          locationId,
          startsAt,
          ...over,
        })
        .set('Idempotency-Key', randomUUID()),
      201,
    );

  /** Tomorrow's slots from 09:00 (far from any notice or cut-off, whatever the hour now). */
  const tomorrowFrom9 = (data: any) =>
    data.days[1].slots
      .filter((s: any) => Number(s.startsAt.slice(11, 13)) >= 9)
      .map((s: any) => s.startsAt as string);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('a clinic and the video consultation share hours; booking one closes the other', async () => {
    const { d, clinic } = await openDoctor();
    const video = await expectOk(
      await d.api.post('/health/doctor/locations', {
        kind: 'video',
        fee: 1500,
        slotMinutes: 15,
      }),
      201,
    );
    // Same hours as the clinic: allowed, and reported.
    const saved = await expectOk(
      await d.api.put(
        `/health/doctor/locations/${video.id}/schedule`,
        EVERY_DAY.map((weekday) => ({ weekday, start: '09:00', end: '13:00' })),
      ),
    );
    expect(saved.dryRun).toBe(false);
    expect(saved.ranges).toHaveLength(7);
    expect(saved.sharedWith).toHaveLength(7);
    expect(saved.sharedWith[0]).toMatchObject({
      locationId: clinic.id,
      kind: 'clinic',
      start: '09:00',
      end: '13:00',
    });
    expect(saved.slotsPerWeek).toBe(7 * 16);

    // A clinic booking at 10:00 tomorrow takes the 10:00 video slot away too.
    const [clinicSlots, videoSlots] = await Promise.all([
      slotsOf(d, clinic.id),
      slotsOf(d, video.id),
    ]);
    const at = tomorrowFrom9(clinicSlots).find((s: string) =>
      s.includes('T10:00'),
    );
    expect(tomorrowFrom9(videoSlots)).toContain(at);
    const p = await shopper(t);
    await book(p, d, clinic.id, at);
    expect(tomorrowFrom9(await slotsOf(d, video.id))).not.toContain(at);
    const taken = await p.api
      .post('/health/appointments', {
        doctorId: d.doctorId,
        locationId: video.id,
        startsAt: at,
        paymentMethod: 'transfer',
      })
      .set('Idempotency-Key', randomUUID());
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLOT_TAKEN');

    // Two clinics still can't overlap; another zone can't share.
    const second = await addClinic(d, {
      name: 'DHA Medical Centre',
      area: 'DHA',
    });
    const clash = await d.api
      .put(`/health/doctor/locations/${second.id}/schedule`, [
        { weekday: 1, start: '10:00', end: '11:00' },
      ])
      .expect(409);
    expect(clash.body.error).toMatchObject({
      code: 'SCHEDULE_OVERLAP',
      details: { reason: 'same_kind', conflict: { locationId: clinic.id } },
    });
    const zone = await d.api.patch(`/health/doctor/locations/${video.id}`, {
      timezone: 'Asia/Dubai',
    });
    expect(zone.status).toBe(409);
    expect(zone.body.error.details.reason).toBe('timezone');
  });

  it('a break after each patient spaces the slots, and booking follows the grid', async () => {
    const { d, clinic } = await openDoctor();
    const loc = await expectOk(
      await d.api.patch(`/health/doctor/locations/${clinic.id}`, {
        bufferMinutes: 5,
      }),
    );
    expect(loc).toMatchObject({ slotMinutes: 15, bufferMinutes: 5 });
    await d.api
      .patch(`/health/doctor/locations/${clinic.id}`, { bufferMinutes: 61 })
      .expect(400);
    const data = await slotsOf(d, clinic.id);
    expect(data.location.bufferMinutes).toBe(5);
    const tomorrow = tomorrowFrom9(data);
    const minutes = tomorrow
      .slice(0, 4)
      .map(
        (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)),
      );
    expect(
      minutes.slice(1).map((m: number, i: number) => m - minutes[i]),
    ).toEqual([20, 20, 20]);
    // 09:15 is off the 20-minute grid now.
    const offGrid = tomorrow[0].replace(/T\d\d:\d\d/, 'T09:15');
    const p = await shopper(t);
    const res = await p.api
      .post('/health/appointments', {
        doctorId: d.doctorId,
        locationId: clinic.id,
        startsAt: offGrid,
      })
      .set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLOT_INVALID');
    await book(p, d, clinic.id, tomorrow[1]);
  });

  it('a dry run reports shared hours, visits left outside and the week, and saves nothing', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const [at] = tomorrowFrom9(await slotsOf(d, clinic.id));
    const visit = await book(p, d, clinic.id, at);
    const weekday = new Date(at).getUTCDay(); // 09:00+ PKT is the same UTC day
    const shorter = EVERY_DAY.map((w) => ({
      weekday: w,
      start: '14:00',
      end: '18:00',
    }));
    const dry = await expectOk(
      await d.api.put(
        `/health/doctor/locations/${clinic.id}/schedule?dryRun=true`,
        shorter,
      ),
    );
    expect(dry).toMatchObject({
      dryRun: true,
      slotsPerWeek: 7 * 16,
      outsideHours: [{ code: visit.code }],
    });
    expect(dry.ranges.find((r: any) => r.weekday === weekday)).toMatchObject({
      start: '14:00',
      end: '18:00',
    });
    // Nothing was saved.
    const week = await expectOk(
      await d.api.get(`/health/doctor/locations/${clinic.id}/schedule`),
    );
    expect(week.ranges[0]).toMatchObject({ start: '00:00', end: '24:00' });
    // Saved for real: the visit is listed, and stays booked.
    const saved = await expectOk(
      await d.api.put(
        `/health/doctor/locations/${clinic.id}/schedule`,
        shorter,
      ),
    );
    expect(saved.outsideHours.map((v: any) => v.code)).toEqual([visit.code]);
    const [row] = await sql(`SELECT status FROM appointments WHERE code = $1`, [
      visit.code,
    ]);
    expect(row.status).toBe('booked');
  });

  it('paused bookings: patients see no times, the doctor still sees theirs', async () => {
    const { d, clinic } = await openDoctor();
    await expectOk(
      await d.api.patch('/health/doctor/profile', { isAccepting: false }),
    );
    const data = await slotsOf(d, clinic.id, 3);
    expect(data.accepting).toBe(false);
    expect(
      data.days.every((x: any) => x.status === 'paused' && !x.slots.length),
    ).toBe(true);
    const preview = await expectOk(
      await d.api.get('/health/doctor/availability/preview?days=2'),
    );
    expect(preview.paused).toBe(true);
    expect(preview.locations[0].days[1].slots.length).toBeGreaterThan(0);
    const [doctor] = await sql(
      `SELECT next_available_at FROM doctors WHERE id = $1`,
      [d.doctorId],
    );
    expect(doctor.next_available_at).toBeNull();

    await expectOk(
      await d.api.patch('/health/doctor/profile', { isAccepting: true }),
    );
    const open = await slotsOf(d, clinic.id);
    expect(open.accepting).toBe(true);
    expect(open.days[1]).toMatchObject({ status: 'open' });
  });

  it('slots run 30 days and each day says why: open, closed, time off, past the window', async () => {
    const { d, clinic } = await openDoctor({ bookingWindowDays: 30 });
    // Only weekdays 1–5 (Mon–Fri).
    await setSchedule(
      d,
      clinic.id,
      [1, 2, 3, 4, 5].map(
        (w) => [w, '09:00', '17:00'] as [number, string, string],
      ),
    );
    const data = await slotsOf(d, clinic.id, 30);
    expect(data.days).toHaveLength(30);
    expect(data.bookingWindowDays).toBe(30);
    const sunday = data.days.find((x: any) => x.weekday === 0);
    expect(sunday).toMatchObject({ status: 'closed', totalSlots: 0 });
    await anon()
      .get(`/health/doctors/${d.doctorId}/locations/${clinic.id}/slots?days=31`)
      .expect(400);

    // A day of time off on the first weekday after tomorrow.
    const weekday = data.days.find(
      (x: any, i: number) => i >= 2 && x.weekday >= 1 && x.weekday <= 5,
    );
    await expectOk(
      await d.api.post('/health/doctor/time-off', {
        startsAt: `${weekday.date}T00:00:00+05:00`,
        endsAt: `${weekday.date}T23:59:00+05:00`,
        reason: 'Conference',
      }),
      201,
    );
    const after = await slotsOf(d, clinic.id, 30);
    expect(after.days.find((x: any) => x.date === weekday.date)).toMatchObject({
      status: 'time_off',
      totalSlots: 32,
      slots: [],
    });

    // A short window: the days after it say so.
    await expectOk(
      await d.api.patch('/health/doctor/profile', { bookingWindowDays: 3 }),
    );
    const short = await slotsOf(d, clinic.id, 5);
    expect(short.days[4].status).toBe('beyond_window');
  });

  it('check-in opens 2 hours before the visit; a clinic fee can be marked paid after it', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const [later] = tomorrowFrom9(await slotsOf(d, clinic.id));
    const tomorrow = await book(p, d, clinic.id, later);
    const early = await d.api.post(
      `/health/doctor/appointments/${tomorrow.code}/check-in`,
    );
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/2 hours before/);
    const shown = await expectOk(
      await d.api.get(`/health/doctor/appointments/${tomorrow.code}`),
    );
    expect(shown.can).toMatchObject({ checkIn: false, markPaid: false });

    // Moved to start in 30 minutes: it can be checked in now.
    await sql(
      `UPDATE appointments SET starts_at = now() + interval '30 minutes', ends_at = now() + interval '45 minutes' WHERE code = $1`,
      [tomorrow.code],
    );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${tomorrow.code}/check-in`),
    );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${tomorrow.code}/start`),
    );
    const done = await expectOk(
      await d.api.post(
        `/health/doctor/appointments/${tomorrow.code}/complete`,
        {
          paymentCollected: false,
        },
      ),
    );
    expect(done.payment.status).toBe('unpaid');
    const view = await expectOk(
      await d.api.get(`/health/doctor/appointments/${tomorrow.code}`),
    );
    expect(view.can.markPaid).toBe(true);
    const paid = await expectOk(
      await d.api.post(
        `/health/doctor/appointments/${tomorrow.code}/payment/mark-paid`,
      ),
    );
    expect(paid.payment.status).toBe('paid');
    await d.api
      .post(`/health/doctor/appointments/${tomorrow.code}/payment/mark-paid`)
      .expect(409);
  });

  it('an unlisting is never silent, and a doctor once listed keeps their practice', async () => {
    const { d, clinic } = await openDoctor();
    const profile = await expectOk(await d.api.get('/health/doctor/profile'));
    expect(profile.features).toEqual(
      expect.arrayContaining([
        'cross_kind_hours',
        'buffer',
        'pause',
        'mark_paid_later',
      ]),
    );
    expect(profile.wasListed).toBe(true);

    // Clearing the hours takes the doctor off the directory, and says so.
    await setSchedule(d, clinic.id, []);
    const c = await expectOk(
      await d.api.get('/health/doctor/profile/completeness'),
    );
    expect(c).toMatchObject({ isListed: false, missing: ['weekly_schedule'] });
    const [notice] = await sql(
      `SELECT n.title, n.body, n.data FROM notifications n
         JOIN businesses b ON b.owner_user_id = n.user_id
         JOIN doctors x ON x.business_id = b.id
        WHERE x.id = $1 AND n.type = 'health.listing.hidden'`,
      [d.doctorId],
    );
    expect(notice.body).toMatch(/weekly hours/);
    expect(notice.data).toEqual({ missing: ['weekly_schedule'] });
    const business = await expectOk(await d.api.get('/businesses/me'));
    expect(business).toMatchObject({ isListed: false, wasListed: true });
  });

  // ── Phase 3: day-specific hours, walk-ins, the doctor's own moves and follow-ups ──

  /** A visit that has happened: moved close to now, checked in, started, completed. */
  async function seen(d: Doctor, code: string) {
    await sql(
      `UPDATE appointments SET starts_at = now() + interval '5 minutes',
              ends_at = now() + interval '5 minutes' + (ends_at - starts_at) WHERE code = $1`,
      [code],
    );
    for (const step of ['check-in', 'start'])
      await expectOk(
        await d.api.post(`/health/doctor/appointments/${code}/${step}`),
      );
    return expectOk(
      await d.api.post(`/health/doctor/appointments/${code}/complete`, {
        paymentCollected: true,
      }),
    );
  }

  const notices = (userId: string, type: string) =>
    sql(
      `SELECT title, body, data FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at`,
      [userId, type],
    );

  it("a day's own hours replace its weekly hours: closed, extra, checked like the week", async () => {
    const { d, clinic } = await openDoctor();
    await setSchedule(
      d,
      clinic.id,
      EVERY_DAY.map((w) => [w, '09:00', '17:00'] as [number, string, string]),
    );
    const week = await slotsOf(d, clinic.id, 4);
    const [day2, day3] = [week.days[2].date, week.days[3].date];

    const closed = await expectOk(
      await d.api.put(
        `/health/doctor/locations/${clinic.id}/overrides/${day2}`,
        {
          closed: true,
          note: 'Family wedding',
        },
      ),
    );
    expect(closed).toMatchObject({
      date: day2,
      closed: true,
      ranges: [],
      slots: 0,
    });
    const extra = await expectOk(
      await d.api.put(
        `/health/doctor/locations/${clinic.id}/overrides/${day3}`,
        {
          ranges: [
            { start: '09:00', end: '12:00' },
            { start: '18:00', end: '21:00' },
          ],
        },
      ),
    );
    expect(extra).toMatchObject({
      slots: 24,
      sharedWith: [],
      outsideHours: [],
    });
    const after = await slotsOf(d, clinic.id, 4);
    expect(after.days[2]).toMatchObject({ status: 'closed', slots: [] });
    const evening = after.days[3].slots.map((x: any) =>
      x.startsAt.slice(11, 16),
    );
    expect(evening).toContain('20:45');
    expect(evening).not.toContain('13:00');
    const list = await expectOk(
      await d.api.get(`/health/doctor/locations/${clinic.id}/overrides`),
    );
    expect(list.items.map((o: any) => [o.date, o.closed, o.note])).toEqual([
      [day2, true, 'Family wedding'],
      [day3, false, null],
    ]);

    // Another clinic can't take those evening hours that day.
    const other = await addClinic(d, {
      name: 'DHA Medical Centre',
      area: 'DHA',
    });
    const clash = await d.api
      .put(`/health/doctor/locations/${other.id}/overrides/${day3}`, {
        ranges: [{ start: '19:00', end: '20:00' }],
      })
      .expect(409);
    expect(clash.body.error.details.reason).toBe('same_kind');
    // …nor make its weekly hours clash with that day.
    const weekly = await d.api
      .put(`/health/doctor/locations/${other.id}/schedule`, [
        { weekday: after.days[3].weekday, start: '18:30', end: '19:30' },
      ])
      .expect(409);
    expect(weekly.body.error.code).toBe('SCHEDULE_OVERLAP');

    // A booked visit the new hours leave out is reported (dry run), never cancelled.
    const p = await shopper(t);
    const visit = await book(p, d, clinic.id, after.days[3].slots[0].startsAt);
    const dry = await expectOk(
      await d.api.put(
        `/health/doctor/locations/${clinic.id}/overrides/${day3}?dryRun=true`,
        { ranges: [{ start: '18:00', end: '21:00' }] },
      ),
    );
    expect(dry).toMatchObject({
      dryRun: true,
      outsideHours: [{ code: visit.code }],
    });
    const yesterday = new Date(Date.parse(week.days[0].date) - 86400e3)
      .toISOString()
      .slice(0, 10);
    await d.api
      .put(`/health/doctor/locations/${clinic.id}/overrides/${yesterday}`, {
        closed: true,
      })
      .expect(400);
    await d.api
      .put(`/health/doctor/locations/${clinic.id}/overrides/2026-02-30`, {
        closed: true,
      })
      .expect(400);
    await d.api
      .put(`/health/doctor/locations/${clinic.id}/overrides/${day3}`, {})
      .expect(400);
    const removed = await expectOk(
      await d.api.delete(
        `/health/doctor/locations/${clinic.id}/overrides/${day2}`,
      ),
    );
    expect(removed).toMatchObject({ removed: true, outsideHours: [] });
    expect((await slotsOf(d, clinic.id, 4)).days[2].status).toBe('open');
  });

  it('a walk-in joins the queue checked in, and only the doctor ever sees them', async () => {
    const { d, clinic } = await openDoctor();
    const added = await expectOk(
      await d.api.post('/health/doctor/appointments/walk-in', {
        locationId: clinic.id,
        patient: {
          name: 'Bilal Ahmed',
          phone: '+923001234567',
          gender: 'male',
          age: 41,
        },
        reason: 'Fever since yesterday',
      }),
      201,
    );
    expect(added).toMatchObject({
      status: 'checked_in',
      source: 'walk_in',
      patient: { name: 'Bilal Ahmed', age: 41 },
      payment: { method: 'pay_at_clinic', status: 'unpaid' },
    });
    const today = await expectOk(await d.api.get('/health/doctor/today'));
    const row = today.queue.find((q: any) => q.code === added.code);
    expect(row).toMatchObject({ status: 'checked_in', source: 'walk_in' });
    const patients = await expectOk(
      await d.api.get('/health/doctor/patients?q=Bilal'),
    );
    expect(patients.items).toHaveLength(1);
    const history = await expectOk(
      await d.api.get(`/health/doctor/patients/${row.patientKey}`),
    );
    expect(history.name).toBe('Bilal Ahmed');

    // Seen and prescribed: no account, so nothing is sent anywhere.
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${added.code}/start`),
    );
    await expectOk(
      await d.api.post(
        `/health/doctor/appointments/${added.code}/prescription`,
        {
          diagnosis: 'Viral fever',
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
        },
      ),
      201,
    );
    const [rx] = await sql(
      `SELECT p.patient_user_id FROM prescriptions p JOIN appointments a ON a.id = p.appointment_id WHERE a.code = $1`,
      [added.code],
    );
    expect(rx.patient_user_id).toBeNull();
    // Video locations take no walk-ins; a full day says so.
    const video = await expectOk(
      await d.api.post('/health/doctor/locations', {
        kind: 'video',
        fee: 1000,
      }),
      201,
    );
    await d.api
      .post('/health/doctor/appointments/walk-in', {
        locationId: video.id,
        patient: { name: 'Sara' },
      })
      .expect(400);
    await setSchedule(d, clinic.id, []);
    const full = await d.api.post('/health/doctor/appointments/walk-in', {
      locationId: clinic.id,
      patient: { name: 'Sara' },
    });
    expect([full.status, full.body.error.code]).toEqual([409, 'NO_FREE_SLOT']);
  });

  it('the doctor moves a visit: payment, reports and notes go with it, the patient is told why', async () => {
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const own = await expectOk(
      await d.api.get(`/health/doctor/locations/${clinic.id}/slots?days=2`),
    );
    const [first, , third] = tomorrowFrom9(own);
    const visit = await book(p, d, clinic.id, first);
    await expectOk(
      await d.api.put(`/health/doctor/appointments/${visit.code}/notes`, {
        text: 'Bring the old reports.',
      }),
    );
    const moved = await expectOk(
      await d.api.post(`/health/doctor/appointments/${visit.code}/reschedule`, {
        startsAt: third,
        reason: 'I am in surgery that morning.',
      }),
    );
    expect(moved.code).not.toBe(visit.code);
    expect(moved.startsAt).toBe(third);
    expect(moved.rescheduledFromId).toBe(visit.id);
    const [old] = await sql(
      `SELECT status, cancelled_by, cancel_reason FROM appointments WHERE code = $1`,
      [visit.code],
    );
    expect(old).toMatchObject({
      status: 'cancelled',
      cancelled_by: 'doctor',
      cancel_reason: 'rescheduled',
    });
    const notes = await expectOk(
      await d.api.get(`/health/doctor/appointments/${moved.code}/notes`),
    );
    expect(notes.text).toBe('Bring the old reports.');
    const [told] = await notices(p.userId, 'health.appointment.moved');
    expect(told.body).toMatch(/surgery/);
    // The patient may still move it once themselves (and their app says so).
    const theirs = await expectOk(
      await p.api.get(`/health/appointments/${moved.code}`),
    );
    expect(theirs.can.reschedule).toBe(true);
    const later = tomorrowFrom9(await slotsOf(d, clinic.id))[5];
    await expectOk(
      await p.api
        .post(`/health/appointments/${moved.code}/reschedule`, {
          startsAt: later,
        })
        .set('Idempotency-Key', randomUUID()),
    );
    // Only booked visits move, and only to a free time.
    const [busy] = tomorrowFrom9(await slotsOf(d, clinic.id));
    const second = await book(await shopper(t), d, clinic.id, busy);
    const taken = await d.api.post(
      `/health/doctor/appointments/${second.code}/reschedule`,
      {
        startsAt: later,
        reason: 'Moving you',
      },
    );
    expect(taken.status).toBe(409);
  });

  it('a follow-up is booked for the same person, family member included, and linked', async () => {
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
    const [slot] = tomorrowFrom9(await slotsOf(d, clinic.id));
    const visit = await book(parent, d, clinic.id, slot, {
      familyMemberId: child.id,
    });
    const early = await d.api.post(
      `/health/doctor/appointments/${visit.code}/follow-up`,
      {
        locationId: clinic.id,
        startsAt: slot,
      },
    );
    expect(early.status).toBe(409); // not seen yet
    await seen(d, visit.code);
    const own = await expectOk(
      await d.api.get(
        `/health/doctor/locations/${clinic.id}/slots?from=${(await slotsOf(d, clinic.id, 8)).days[7].date}&days=1`,
      ),
    );
    const at = own.days[0].slots.find((x: any) =>
      x.startsAt.includes('T11:00'),
    ).startsAt;
    const follow = await expectOk(
      await d.api.post(`/health/doctor/appointments/${visit.code}/follow-up`, {
        locationId: clinic.id,
        startsAt: at,
      }),
      201,
    );
    expect(follow).toMatchObject({
      status: 'booked',
      followUpOfId: visit.id,
      familyMemberId: child.id,
      patient: { name: 'Zara Khan' },
      reason: 'Follow-up',
    });
    const booked = await notices(parent.userId, 'health.appointment.booked');
    expect(booked[booked.length - 1].title).toMatch(/Follow-up booked/);
  });

  it('the follow-up reminder comes once on the due day, and not when a visit is already booked', async () => {
    const jobs = t.app.get(HealthJobsService);
    const { d, clinic } = await openDoctor();
    const p = await shopper(t);
    const [slot] = tomorrowFrom9(await slotsOf(d, clinic.id));
    const visit = await book(p, d, clinic.id, slot);
    await seen(d, visit.code);
    await expectOk(
      await d.api.post(
        `/health/doctor/appointments/${visit.code}/prescription`,
        {
          diagnosis: 'Acne',
          followUpInDays: 7,
          medicines: [
            {
              name: 'Adapalene',
              strength: '0.1%',
              form: 'cream',
              dosePattern: '0+0+1',
              timing: 'bedtime',
            },
          ],
        },
      ),
      201,
    );
    // Written 7 days ago (and the visit with it), so the follow-up is due today.
    await sql(
      `UPDATE appointments SET starts_at = starts_at - interval '7 days', ends_at = ends_at - interval '7 days' WHERE code = $1`,
      [visit.code],
    );
    await sql(
      `UPDATE prescriptions SET issued_at = issued_at - interval '7 days'
        WHERE appointment_id = (SELECT id FROM appointments WHERE code = $1)`,
      [visit.code],
    );
    // Noon in Karachi, today.
    const noon = new Date(
      `${new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)}T07:00:00Z`,
    );
    expect(await jobs.followUpReminders(noon)).toMatchObject({ reminded: 1 });
    expect(await jobs.followUpReminders(noon)).toMatchObject({ reminded: 0 });
    const [told] = await notices(p.userId, 'health.followup.due');
    expect(told).toMatchObject({ title: 'Time for your follow-up' });
    expect(told.data).toMatchObject({
      doctorId: d.doctorId,
      appointmentCode: visit.code,
    });

    // Another patient who already booked again hears nothing.
    const q = await shopper(t);
    const [s1, s2] = tomorrowFrom9(await slotsOf(d, clinic.id)).slice(2);
    const v1 = await book(q, d, clinic.id, s1);
    await seen(d, v1.code);
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${v1.code}/prescription`, {
        diagnosis: 'Acne',
        followUpInDays: 7,
        medicines: [
          {
            name: 'Adapalene',
            strength: '0.1%',
            form: 'cream',
            dosePattern: '0+0+1',
            timing: 'bedtime',
          },
        ],
      }),
      201,
    );
    await sql(
      `UPDATE appointments SET starts_at = starts_at - interval '7 days', ends_at = ends_at - interval '7 days' WHERE code = $1`,
      [v1.code],
    );
    await sql(
      `UPDATE prescriptions SET issued_at = issued_at - interval '7 days'
        WHERE appointment_id = (SELECT id FROM appointments WHERE code = $1)`,
      [v1.code],
    );
    await book(q, d, clinic.id, s2);
    expect(await jobs.followUpReminders(noon)).toMatchObject({ reminded: 0 });
    expect(await notices(q.userId, 'health.followup.due')).toHaveLength(0);
  });
});
