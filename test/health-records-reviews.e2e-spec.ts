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
import { HealthJobsService } from '../src/modules/healthcare/jobs/health-jobs.service';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map(
  (w) => [w, '00:00', '24:00'] as [number, string, string],
);

describe('Healthcare P5: records, attachments, reviews, aggregates (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let jobs: HealthJobsService;

  const sql = (q: string, p: unknown[] = []) => t.ds.query(q, p);
  const anon = () => new ApiClient(t.http);

  async function openDoctor(kind: 'clinic' | 'video' = 'clinic') {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'dermatologist')),
        minNoticeMinutes: 0,
        cancelCutoffMinutes: 60,
      }),
    );
    const location = await addClinic(
      d,
      kind === 'video'
        ? {
            kind: 'video',
            name: 'Video consultation',
            addressLine: undefined,
            area: undefined,
            city: undefined,
            fee: 1500,
          }
        : { fee: 2000, slotMinutes: 15 },
    );
    await setSchedule(d, location.id, ALL_DAY);
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    return { d, location };
  }

  async function slot(d: Doctor, locationId: string, index = 0) {
    const res = await anon()
      .get(`/health/doctors/${d.doctorId}/locations/${locationId}/slots?days=2`)
      .expect(200);
    return res.body.data.days[1].slots[index].startsAt as string;
  }

  const bookRaw = async (
    p: SignedUp,
    d: Doctor,
    locationId: string,
    over: Record<string, unknown> = {},
    index = 0,
  ) =>
    p.api
      .post('/health/appointments', {
        doctorId: d.doctorId,
        locationId,
        startsAt: await slot(d, locationId, index),
        ...over,
      })
      .set('Idempotency-Key', randomUUID());

  const book = async (...args: Parameters<typeof bookRaw>) =>
    expectOk(await bookRaw(...args), 201);

  const newRecord = async (p: SignedUp, over: Record<string, unknown> = {}) => {
    const file = asset(p.userId, 'health_record', 'pdf');
    return expectOk(
      await p.api.post('/health/records', {
        title: 'CBC — March',
        type: 'lab_report',
        recordDate: '2026-03-14',
        files: [{ ...file, mime: 'application/pdf' }],
        ...over,
      }),
      201,
    );
  };

  /** Run a visit to completion through the API (clinic: check-in first). */
  async function completeVisit(d: Doctor, code: string, kind = 'clinic') {
    if (kind === 'clinic')
      await expectOk(
        await d.api.post(`/health/doctor/appointments/${code}/check-in`),
      );
    await expectOk(
      await d.api.post(`/health/doctor/appointments/${code}/start`),
    );
    return expectOk(
      await d.api.post(`/health/doctor/appointments/${code}/complete`, {
        paymentCollected: true,
      }),
    );
  }

  const phiReads = async (userId: string) =>
    (
      await sql(
        `SELECT target_type, details FROM operational_audit_events
          WHERE action = 'phi.read' AND actor_user_id = $1 ORDER BY created_at`,
        [userId],
      )
    ).map((r: any) => `${r.target_type}:${r.details.what}`);

  beforeAll(async () => {
    t = await createTestApp();
    jobs = t.app.get(HealthJobsService);
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('records: private uploads only, owner-scoped, per person, with expiring download links', async () => {
    const p = await shopper(t);
    const other = await shopper(t);
    const child = await expectOk(
      await p.api.post('/health/family-members', {
        fullName: 'Ali Raza',
        relation: 'child',
      }),
      201,
    );
    const mine = await newRecord(p);
    expect(mine).toMatchObject({
      title: 'CBC — March',
      type: 'lab_report',
      recordDate: '2026-03-14',
      familyMemberId: null,
      sharedWith: [],
      files: [{ mime: 'application/pdf' }],
    });
    expect(mine.files[0].downloadUrl).toMatch(
      /^https:\/\/api\.cloudinary\.com\/v1_1\/metromatrix-test\/image\/download\?/,
    );
    expect(mine.files[0].downloadUrl).toContain('type=authenticated');
    expect(mine.files[0].downloadUrl).toContain('expires_at=');
    expect(new Date(mine.files[0].expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    const kid = await newRecord(p, {
      title: 'Vaccination card',
      type: 'other',
      familyMemberId: child.id,
    });

    // A public (CDN) upload of PHI, someone else's file, or another account's family member: refused.
    const pub = asset(p.userId, 'avatar');
    expect(
      (
        await p.api.post('/health/records', {
          title: 'x1',
          type: 'other',
          files: [
            {
              url: pub.url.replace('/avatar/', '/health_record/'),
              publicId: pub.publicId.replace('/avatar/', '/health_record/'),
            },
          ],
        })
      ).status,
    ).toBe(400);
    const theirs = asset(other.userId, 'health_record');
    expect(
      (
        await p.api.post('/health/records', {
          title: 'x2',
          type: 'other',
          files: [theirs],
        })
      ).status,
    ).toBe(400);
    const mineFile = asset(other.userId, 'health_record');
    expect(
      (
        await other.api.post('/health/records', {
          title: 'x3',
          type: 'other',
          files: [mineFile],
          familyMemberId: child.id,
        })
      ).status,
    ).toBe(404);

    const self = await expectOk(await p.api.get('/health/records?person=self'));
    expect(self.items.map((r: any) => r.id)).toEqual([mine.id]);
    const kids = await expectOk(
      await p.api.get(`/health/records?person=${child.id}`),
    );
    expect(kids.items.map((r: any) => r.id)).toEqual([kid.id]);
    expect((await other.api.get(`/health/records/${mine.id}`)).status).toBe(
      404,
    );
    expect(
      (await other.api.patch(`/health/records/${mine.id}`, { title: 'hack' }))
        .status,
    ).toBe(404);
    const edited = await expectOk(
      await p.api.patch(`/health/records/${mine.id}`, {
        title: 'CBC — 14 March',
        notes: 'Fasting',
      }),
    );
    expect(edited).toMatchObject({ title: 'CBC — 14 March', notes: 'Fasting' });
  });

  it('sharing: only while attached, only the visit’s person, only until completion; doctor reads are audited', async () => {
    const { d, location } = await openDoctor();
    const { d: other } = await openDoctor();
    const p = await shopper(t);
    const child = await expectOk(
      await p.api.post('/health/family-members', {
        fullName: 'Hira Raza',
        relation: 'child',
      }),
      201,
    );
    const cbc = await newRecord(p);
    const xray = await newRecord(p, { title: 'Chest X-ray', type: 'scan' });
    const kidRecord = await newRecord(p, { familyMemberId: child.id });

    // Booking with someone else's record id fails and books nothing.
    const stranger = await shopper(t);
    const theirs = await newRecord(stranger);
    const bad = await bookRaw(p, d, location.id, {
      attachmentRecordIds: [theirs.id],
    });
    expect(bad.status).toBe(404);
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1`,
      [d.doctorId],
    );
    expect(n).toBe(0);

    const a = await book(p, d, location.id, {
      attachmentRecordIds: [cbc.id],
    });
    const detail = await expectOk(
      await p.api.get(`/health/appointments/${a.code}`),
    );
    expect(detail.sharedRecords.map((r: any) => r.id)).toEqual([cbc.id]);
    expect(detail.can.shareRecords).toBe(true);

    // A child's record can't go to the parent's own visit.
    const wrongPerson = await p.api.post(
      `/health/appointments/${a.code}/attachments`,
      { recordIds: [kidRecord.id] },
    );
    expect(wrongPerson.status).toBe(400);
    const shared = await expectOk(
      await p.api.post(`/health/appointments/${a.code}/attachments`, {
        recordIds: [xray.id, cbc.id],
      }),
      201,
    );
    expect(shared.records.map((r: any) => r.id)).toEqual([cbc.id, xray.id]);

    // The doctor sees metadata in the appointment and opens a file through a short-lived link.
    const docView = await expectOk(
      await d.api.get(`/health/doctor/appointments/${a.code}`),
    );
    expect(docView.sharedRecords.map((r: any) => r.title)).toEqual([
      'CBC — March',
      'Chest X-ray',
    ]);
    expect(JSON.stringify(docView.sharedRecords)).not.toContain(
      'res.cloudinary.com',
    );
    const opened = await expectOk(
      await d.api.get(
        `/health/doctor/appointments/${a.code}/records/${cbc.id}`,
      ),
    );
    expect(opened.files[0].downloadUrl).toContain('api.cloudinary.com');
    expect(JSON.stringify(opened)).not.toContain(cbc.files[0].url);
    expect(await phiReads(d.userId)).toEqual([
      'appointment:appointment',
      'health_record:record',
    ]);

    // Another doctor, or a record that isn't attached: 404.
    expect(
      (
        await other.api.get(
          `/health/doctor/appointments/${a.code}/records/${cbc.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await d.api.get(
          `/health/doctor/appointments/${a.code}/records/${kidRecord.id}`,
        )
      ).status,
    ).toBe(404);

    // Detaching revokes access at once.
    await expectOk(
      await p.api.delete(
        `/health/appointments/${a.code}/attachments/${xray.id}`,
      ),
    );
    expect(
      (
        await d.api.get(
          `/health/doctor/appointments/${a.code}/records/${xray.id}`,
        )
      ).status,
    ).toBe(404);

    // After completion: no new sharing; revoking still works.
    await completeVisit(d, a.code);
    const closed = await p.api.post(
      `/health/appointments/${a.code}/attachments`,
      {
        recordIds: [xray.id],
      },
    );
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('ATTACHMENTS_CLOSED');
    await expectOk(
      await p.api.delete(
        `/health/appointments/${a.code}/attachments/${cbc.id}`,
      ),
    );
    expect(
      (
        await d.api.get(
          `/health/doctor/appointments/${a.code}/records/${cbc.id}`,
        )
      ).status,
    ).toBe(404);

    // Deleting a record un-shares it everywhere.
    const b = await book(
      p,
      d,
      location.id,
      { attachmentRecordIds: [xray.id] },
      2,
    );
    await expectOk(await p.api.delete(`/health/records/${xray.id}`));
    const after = await expectOk(
      await p.api.get(`/health/appointments/${b.code}`),
    );
    expect(after.sharedRecords).toEqual([]);
  });

  it('a rescheduled visit keeps what was shared', async () => {
    const { d, location } = await openDoctor();
    const p = await shopper(t);
    const r = await newRecord(p);
    const a = await book(p, d, location.id, { attachmentRecordIds: [r.id] });
    const moved = await expectOk(
      await p.api
        .post(`/health/appointments/${a.code}/reschedule`, {
          startsAt: await slot(d, location.id, 4),
        })
        .set('Idempotency-Key', randomUUID()),
    );
    expect(moved.code).not.toBe(a.code);
    expect(moved.sharedRecords.map((x: any) => x.id)).toEqual([r.id]);
    await expectOk(
      await d.api.get(
        `/health/doctor/appointments/${moved.code}/records/${r.id}`,
      ),
    );
  });

  it('reviews: once, only after completion, within 30 days, by the booking account; rating updates at once', async () => {
    const { d, location } = await openDoctor();
    const p = await shopper(t);
    const someoneElse = await shopper(t);
    const a = await book(p, d, location.id);
    const body = {
      overall: 5,
      diagnosis: 5,
      staff: 4,
      environment: 4,
      recommend: true,
      tags: ['explained_well', 'on_time'],
      text: 'Listened carefully and explained the treatment.',
    };
    const early = await p.api.post(
      `/health/appointments/${a.code}/review`,
      body,
    );
    expect(early.status).toBe(403);
    expect(early.body.error).toMatchObject({
      code: 'REVIEW_NOT_ALLOWED',
      details: { reason: 'not_completed' },
    });

    await completeVisit(d, a.code);
    let mine = await expectOk(
      await p.api.get(`/health/appointments/${a.code}`),
    );
    expect(mine.can.review).toBe(true);
    expect(
      (
        await someoneElse.api.post(
          `/health/appointments/${a.code}/review`,
          body,
        )
      ).status,
    ).toBe(404);
    const review = await expectOk(
      await p.api.post(`/health/appointments/${a.code}/review`, body),
      201,
    );
    expect(review).toMatchObject({
      overall: 5,
      kind: 'clinic',
      environment: 4,
      verifiedVisit: true,
      tags: ['explained_well', 'on_time'],
      reply: null,
    });
    expect(review.author).toMatch(/^\S+( [A-Z]\.)?$/);
    const twice = await p.api.post(
      `/health/appointments/${a.code}/review`,
      body,
    );
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('REVIEW_EXISTS');
    mine = await expectOk(await p.api.get(`/health/appointments/${a.code}`));
    expect(mine.can.review).toBe(false);

    const profile = await expectOk(
      await anon().get(`/health/doctors/${d.doctorId}`),
    );
    expect(profile.stats).toMatchObject({ ratingAvg: 5, ratingCount: 1 });
    expect(profile.reviewSummary).toMatchObject({
      count: 1,
      averages: { overall: 5, diagnosis: 5, staff: 4, environment: 4 },
      satisfactionPct: null, // fewer than 5 reviews
      topTags: [
        { tag: 'explained_well', count: 1 },
        { tag: 'on_time', count: 1 },
      ],
    });
    expect(profile.reviewSummary.latest[0].id).toBe(review.id);

    // 30 days after completion it's too late.
    const b = await book(p, d, location.id, {}, 2);
    await completeVisit(d, b.code);
    await sql(
      `UPDATE appointments SET completed_at = now() - interval '30 days 1 minute' WHERE code = $1`,
      [b.code],
    );
    const late = await p.api.post(
      `/health/appointments/${b.code}/review`,
      body,
    );
    expect(late.status).toBe(403);
    expect(late.body.error.details.reason).toBe('window_closed');
  });

  it('video reviews have no environment score; anonymous reviews show initials only', async () => {
    const { d, location } = await openDoctor('video');
    const p = await shopper(t);
    const a = await book(p, d, location.id);
    await completeVisit(d, a.code, 'video');
    const r = await expectOk(
      await p.api.post(`/health/appointments/${a.code}/review`, {
        overall: 3,
        diagnosis: 3,
        environment: 5,
        recommend: false,
        isAnonymous: true,
      }),
      201,
    );
    expect(r).toMatchObject({
      kind: 'video',
      environment: null,
      isAnonymous: true,
    });
    // Initials only, e.g. "A. K.".
    expect(r.author).toMatch(/^[A-Z]\.( [A-Z]\.)?$/);
    const list = await expectOk(
      await anon().get(`/health/doctors/${d.doctorId}/reviews?kind=video`),
    );
    expect(list).toMatchObject({ total: 1, page: 1 });
    expect(list.items[0].author).toBe(r.author);
  });

  it('public list sorts and filters; doctor replies; admin hide/unhide is audited and moves the rating', async () => {
    const { d, location } = await openDoctor();
    const scores = [5, 2, 4];
    const codes: string[] = [];
    for (const [i, overall] of scores.entries()) {
      const p = await shopper(t);
      const a = await book(p, d, location.id, {}, i * 2);
      await completeVisit(d, a.code);
      await expectOk(
        await p.api.post(`/health/appointments/${a.code}/review`, {
          overall,
          diagnosis: overall,
          recommend: overall >= 4,
          text: `score ${overall}`,
        }),
        201,
      );
      codes.push(a.code);
    }
    const ids = async (q: string) =>
      (
        await expectOk(
          await anon().get(`/health/doctors/${d.doctorId}/reviews?${q}`),
        )
      ).items.map((r: any) => r.overall);
    expect(await ids('sort=highest')).toEqual([5, 4, 2]);
    expect(await ids('sort=lowest')).toEqual([2, 4, 5]);
    expect(await ids('sort=latest')).toEqual([4, 2, 5]);

    const doctorList = await expectOk(
      await d.api.get('/health/doctor/reviews'),
    );
    const low = doctorList.items.find((r: any) => r.overall === 2);
    expect(low.appointmentCode).toBe(codes[1]);
    const replied = await expectOk(
      await d.api.post(`/health/doctor/reviews/${low.id}/reply`, {
        text: 'Sorry about the wait — we have added a second receptionist.',
      }),
    );
    expect(replied.reply.text).toMatch(/second receptionist/);
    const unreplied = await expectOk(
      await d.api.get('/health/doctor/reviews?unreplied=true'),
    );
    expect(unreplied.items.map((r: any) => r.overall).sort()).toEqual([4, 5]);
    const { d: otherDoctor } = await openDoctor();
    expect(
      (
        await otherDoctor.api.post(`/health/doctor/reviews/${low.id}/reply`, {
          text: 'Not mine',
        })
      ).status,
    ).toBe(404);

    const before = await expectOk(
      await anon().get(`/health/doctors/${d.doctorId}`),
    );
    expect(before.stats).toMatchObject({ ratingAvg: 3.67, ratingCount: 3 });

    await expectOk(
      await admin.api.post(`/admin/health/reviews/${low.id}/hide`, {
        reason: 'Contains a phone number.',
      }),
    );
    expect(await ids('sort=highest')).toEqual([5, 4]);
    const hiddenStats = await expectOk(
      await anon().get(`/health/doctors/${d.doctorId}`),
    );
    expect(hiddenStats.stats).toMatchObject({ ratingAvg: 4.5, ratingCount: 2 });
    const flagged = await expectOk(await d.api.get('/health/doctor/reviews'));
    expect(flagged.items.find((r: any) => r.id === low.id)).toMatchObject({
      hidden: true,
      hiddenReason: 'Contains a phone number.',
    });
    const queue = await expectOk(
      await admin.api.get(
        `/admin/health/reviews?doctorId=${d.doctorId}&hidden=true`,
      ),
    );
    expect(queue.items.map((r: any) => r.id)).toEqual([low.id]);

    await expectOk(
      await admin.api.post(`/admin/health/reviews/${low.id}/unhide`),
    );
    expect(await ids('sort=highest')).toEqual([5, 4, 2]);
    const audit = await sql(
      `SELECT action FROM operational_audit_events WHERE target_id = $1 ORDER BY created_at`,
      [low.id],
    );
    expect(audit.map((r: any) => r.action)).toEqual([
      'health.review.hide',
      'health.review.unhide',
    ]);
    // Patients can't moderate.
    const p = await shopper(t);
    expect(
      (
        await p.api.post(`/admin/health/reviews/${low.id}/hide`, {
          reason: 'nope',
        })
      ).status,
    ).toBe(403);
  });

  it('aggregates: wait/consult shown from 5 samples (hand-built scenario), served, 30-day count, top-booked; job is idempotent', async () => {
    const { d, location } = await openDoctor();
    const { d: quiet } = await openDoctor();
    // Five finished visits on five past days: waits 10..50 min, consults 15 min.
    const visits: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await shopper(t);
      const a = await book(p, d, location.id, {}, i * 2);
      visits.push(a.code);
    }
    const finish = (code: string, daysAgo: number, wait: number) =>
      sql(
        `UPDATE appointments SET status = 'completed', payment_status = 'paid', paid_at = now(),
                starts_at = now() - make_interval(days => $2),
                ends_at = now() - make_interval(days => $2) + interval '15 minutes',
                checked_in_at = now() - make_interval(days => $2) - interval '5 minutes',
                started_at = now() - make_interval(days => $2) + make_interval(mins => $3),
                completed_at = now() - make_interval(days => $2) + make_interval(mins => $3 + 15)
          WHERE code = $1`,
        [code, daysAgo, wait],
      );
    for (let i = 0; i < 4; i++) await finish(visits[i], i + 1, (i + 1) * 10);

    await jobs.nightlyRun();
    const stats = async (id: string) =>
      (
        await sql(
          `SELECT avg_wait_minutes, avg_consult_minutes, patients_served, completed_30d, is_top_booked
             FROM doctors WHERE id = $1`,
          [id],
        )
      )[0];
    // Four samples: not shown yet.
    expect(await stats(d.doctorId)).toMatchObject({
      avg_wait_minutes: null,
      avg_consult_minutes: null,
      patients_served: 4,
      completed_30d: 4,
    });

    await finish(visits[4], 5, 50);
    const first = await jobs.nightlyRun();
    expect(first.doctorAggregates).toBeGreaterThanOrEqual(1);
    expect(await stats(d.doctorId)).toEqual({
      avg_wait_minutes: 30,
      avg_consult_minutes: 15,
      patients_served: 5,
      completed_30d: 5,
      is_top_booked: true,
    });
    expect((await stats(quiet.doctorId)).is_top_booked).toBe(false);
    const profile = await expectOk(
      await anon().get(`/health/doctors/${d.doctorId}`),
    );
    expect(profile.stats).toMatchObject({
      avgWaitMinutes: 30,
      avgConsultMinutes: 15,
      patientsServed: 5,
    });
    expect(profile.badges.topBooked).toBe(true);

    // Running again changes nothing.
    const second = await jobs.nightlyRun();
    expect(second).toMatchObject({ doctorAggregates: 0, topBooked: 0 });
    expect((await stats(d.doctorId)).avg_wait_minutes).toBe(30);
  });
});
