import { randomUUID } from 'crypto';
import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin, shopper } from './utils/shopping';
import {
  addClinic,
  approvedDoctor,
  expectOk,
  fullProfile,
  listedDoctor,
  setSchedule,
  specialtyId,
} from './utils/health';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map(
  (w) => [w, '00:00', '24:00'] as [number, string, string],
);

describe('Healthcare P7: admin reference data, appointment support, overview (e2e)', () => {
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

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
  });
  afterAll(() => t.close());

  it('specialties: create, slug conflicts, keyword edits reach doctor search at once, deactivate; audited', async () => {
    const created = await expectOk(
      await admin.api.post('/admin/health/specialties', {
        name: 'Sleep Specialist',
        nameUr: 'ماہر نیند',
        slug: 'sleep-specialist',
        keywords: ['Insomnia', 'neend', 'neend'],
        sort: 90,
      }),
      201,
    );
    expect(created).toMatchObject({
      slug: 'sleep-specialist',
      keywords: ['insomnia', 'neend'],
      isActive: true,
    });
    expect(await audited('health.specialty.create', created.id)).toBe(1);
    const dup = await admin.api.post('/admin/health/specialties', {
      name: 'Sleep 2',
      nameUr: 'نیند',
      slug: 'sleep-specialist',
      keywords: [],
    });
    expect(dup.status).toBe(409);
    const suggest = await expectOk(
      await anon().get('/health/search/suggest?q=neend'),
    );
    expect(suggest.specialties.map((s: any) => s.slug)).toContain(
      'sleep-specialist',
    );

    // A new lay keyword on Dermatologist finds listed dermatologists straight away.
    const { doctor } = await listedDoctor(t, admin);
    const derm = await specialtyId(t, 'dermatologist');
    const before = await expectOk(
      await anon().get('/health/doctors?q=zitwort'),
    );
    expect(before.items.map((c: any) => c.id)).not.toContain(doctor.doctorId);
    const [{ keywords }] = await sql(
      `SELECT keywords FROM specialties WHERE id = $1`,
      [derm],
    );
    await expectOk(
      await admin.api.patch(`/admin/health/specialties/${derm}`, {
        keywords: [...keywords, 'zitwort'],
      }),
    );
    const after = await expectOk(await anon().get('/health/doctors?q=zitwort'));
    expect(after.items.map((c: any) => c.id)).toContain(doctor.doctorId);
    expect(await audited('health.specialty.update', derm)).toBe(1);

    await expectOk(
      await admin.api.patch(`/admin/health/specialties/${created.id}`, {
        isActive: false,
      }),
    );
    const publicList = await expectOk(await anon().get('/health/specialties'));
    expect(publicList.map((s: any) => s.slug)).not.toContain(
      'sleep-specialist',
    );
    const adminList = await expectOk(
      await admin.api.get('/admin/health/specialties'),
    );
    expect(
      adminList.find((s: any) => s.slug === 'sleep-specialist'),
    ).toMatchObject({
      isActive: false,
      doctors: 0,
    });
  });

  it('conditions: create with aliases, map ranked specialties (search follows), validation; audited', async () => {
    const gp = await specialtyId(t, 'general-physician');
    const psych = await specialtyId(t, 'psychiatrist');
    const c = await expectOk(
      await admin.api.post('/admin/health/conditions', {
        name: 'Night terrors',
        slug: 'night-terrors',
        aliases: ['raat ko darr', 'sleep terror'],
        isCommon: false,
      }),
      201,
    );
    expect(c).toMatchObject({ slug: 'night-terrors', specialties: [] });
    const mapped = await expectOk(
      await admin.api.put(`/admin/health/conditions/${c.id}/specialties`, [
        { specialtyId: psych, rank: 1 },
        { specialtyId: gp, rank: 2 },
      ] as unknown as object),
    );
    expect(mapped.specialties.map((s: any) => [s.slug, s.rank])).toEqual([
      ['psychiatrist', 1],
      ['general-physician', 2],
    ]);
    const found = await expectOk(
      await anon().get('/health/conditions?q=raat ko darr'),
    );
    expect(
      found.find((x: any) => x.slug === 'night-terrors').specialties[0].slug,
    ).toBe('psychiatrist');
    // Suggest goes via the condition's first-choice specialty.
    const suggest = await expectOk(
      await anon().get('/health/search/suggest?q=raat ko darr'),
    );
    expect(suggest.specialties[0].slug).toBe('psychiatrist');

    expect(
      (
        await admin.api.put(`/admin/health/conditions/${c.id}/specialties`, [
          { specialtyId: randomUUID(), rank: 1 },
        ] as unknown as object)
      ).status,
    ).toBe(404);
    expect(
      (
        await admin.api.post('/admin/health/conditions', {
          name: 'Bad',
          slug: 'Not A Slug',
          aliases: [],
        })
      ).status,
    ).toBe(400);
    const edited = await expectOk(
      await admin.api.patch(`/admin/health/conditions/${c.id}`, {
        isCommon: true,
      }),
    );
    expect(edited.isCommon).toBe(true);
    const page = await expectOk(
      await admin.api.get('/admin/health/conditions?q=terror'),
    );
    expect(page.items.map((x: any) => x.id)).toContain(c.id);
    // The refused mapping (unknown specialty) wrote nothing.
    expect(await audited('health.condition.map', c.id)).toBe(1);
  });

  it('appointments: lookup and timeline without clinical content, admin cancel tells both sides; audited', async () => {
    const { doctor: d, clinic } = await listedDoctor(t, admin);
    const p = await shopper(t);
    const slots = await expectOk(
      await anon().get(
        `/health/doctors/${d.doctorId}/locations/${clinic.id}/slots?days=2`,
      ),
    );
    const a = await expectOk(
      await p.api
        .post('/health/appointments', {
          doctorId: d.doctorId,
          locationId: clinic.id,
          startsAt: slots.days[1].slots[0].startsAt,
        })
        .set('Idempotency-Key', randomUUID()),
      201,
    );
    const list = await expectOk(
      await admin.api.get(`/admin/health/appointments?code=${a.code}`),
    );
    expect(list).toMatchObject({ total: 1 });
    expect(list.items[0]).toMatchObject({
      code: a.code,
      patientUserId: p.userId,
      doctor: { id: d.doctorId },
    });
    const byDoctor = await expectOk(
      await admin.api.get(
        `/admin/health/appointments?doctorId=${d.doctorId}&status=booked`,
      ),
    );
    expect(byDoctor.items.map((x: any) => x.code)).toEqual([a.code]);

    const detail = await expectOk(
      await admin.api.get(`/admin/health/appointments/${a.code}`),
    );
    expect(detail.events.map((e: any) => e.to)).toEqual(['booked']);
    for (const key of ['notes', 'prescription', 'sharedRecords'])
      expect(detail).not.toHaveProperty(key);
    expect(await audited('health.appointment.read', a.id)).toBe(1);

    const cancelled = await expectOk(
      await admin.api.post(`/admin/health/appointments/${a.code}/cancel`, {
        reason: 'Clinic closed for a public holiday.',
      }),
    );
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'admin',
      payment: { status: 'void' },
    });
    expect(await audited('health.appointment.cancel', a.id)).toBe(1);
    const told = await sql(
      `SELECT user_id FROM notifications WHERE type = 'health.appointment.cancelled' AND data->>'appointmentCode' = $1`,
      [a.code],
    );
    expect(told.map((r: any) => r.user_id).sort()).toEqual(
      [p.userId, d.userId].sort(),
    );
    const again = await admin.api.post(
      `/admin/health/appointments/${a.code}/cancel`,
      {
        reason: 'Twice',
      },
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    // The slot is free again.
    const free = await expectOk(
      await anon().get(
        `/health/doctors/${d.doctorId}/locations/${clinic.id}/slots?days=2`,
      ),
    );
    expect(free.days[1].slots[0].startsAt).toBe(
      slots.days[1].slots[0].startsAt,
    );
  });

  it('overview and access: admins only', async () => {
    const o = await expectOk(await admin.api.get('/admin/health/overview'));
    expect(o).toMatchObject({
      doctors: expect.objectContaining({ listed: expect.any(Number) }),
      today: expect.objectContaining({
        newBookings: expect.any(Number),
        cancellations: expect.any(Number),
        noShows: expect.any(Number),
      }),
      last7Days: expect.any(Object),
      reviews: expect.any(Object),
      symptomChecks: expect.any(Object),
    });
    expect(
      o.listedBySpecialty.find((s: any) => s.slug === 'dermatologist').doctors,
    ).toBeGreaterThan(0);
    expect(o.today.cancellations).toBeGreaterThanOrEqual(1);

    const p = await shopper(t);
    const d = await approvedDoctor(t, admin);
    for (const who of [p, d]) {
      expect((await who.api.get('/admin/health/overview')).status).toBe(403);
      expect((await who.api.get('/admin/health/specialties')).status).toBe(403);
    }
  });

  it('doctor availability preview shows patient-facing slots before publishing', async () => {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch('/health/doctor/profile', {
        ...fullProfile(d, await specialtyId(t, 'dermatologist')),
        minNoticeMinutes: 0,
      }),
    );
    const clinic = await addClinic(d, { slotMinutes: 30 });
    await setSchedule(d, clinic.id, ALL_DAY);
    const preview = await expectOk(
      await d.api.get('/health/doctor/availability/preview?days=3'),
    );
    expect(preview.locations).toHaveLength(1);
    expect(preview.locations[0].location).toMatchObject({
      id: clinic.id,
      slotMinutes: 30,
    });
    expect(preview.locations[0].days).toHaveLength(3);
    expect(preview.locations[0].days[1].slots).toHaveLength(48);
    // Not listed yet: patients can't see it.
    expect(
      (
        await anon().get(
          `/health/doctors/${d.doctorId}/locations/${clinic.id}/slots`,
        )
      ).status,
    ).toBe(404);
  });
});
