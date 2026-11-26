import { randomUUID } from 'crypto';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { SignedUp } from './utils/factories';
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
});
