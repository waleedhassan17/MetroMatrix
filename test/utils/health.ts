import { TestApp } from './test-app';
import { Admin, Partner, approvedPartner, asset } from './shopping';

export type Doctor = Partner & { doctorId: string };

const specialtyIds = new Map<string, string>();
export async function specialtyId(t: TestApp, slug: string): Promise<string> {
  if (!specialtyIds.size) {
    const rows = await t.ds.query(`SELECT id, slug FROM specialties`);
    rows.forEach((r: { id: string; slug: string }) =>
      specialtyIds.set(r.slug, r.id),
    );
  }
  const id = specialtyIds.get(slug);
  if (!id) throw new Error(`no specialty ${slug}`);
  return id;
}

/** An approved doctor partner (PMDC verified), not yet set up or listed. */
export async function approvedDoctor(
  t: TestApp,
  admin: Admin,
  name?: string,
): Promise<Doctor> {
  const p = await approvedPartner(t, admin, 'doctor', name);
  const res = await p.api.get('/health/doctor/profile');
  if (res.status !== 200)
    throw new Error(
      `profile failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  return { ...p, doctorId: res.body.data.id };
}

export const fullProfile = (
  d: Doctor,
  specialty: string,
  over: Record<string, unknown> = {},
) => ({
  title: 'dr',
  fullName: 'Sana Iqbal',
  gender: 'female',
  photoUrl: asset(d.userId, 'doctor_photo').url,
  primarySpecialtyId: specialty,
  practicingSince: 2012,
  about:
    'Consultant dermatologist treating acne, eczema and hair loss in adults and children.',
  languages: ['English', 'Urdu'],
  qualifications: [
    { degree: 'MBBS', institute: 'King Edward Medical University', year: 2010 },
  ],
  ...over,
});

export async function expectOk(
  res: { status: number; body: any },
  status = 200,
) {
  if (res.status !== status)
    throw new Error(
      `expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`,
    );
  return res.body.data;
}

export async function addClinic(d: Doctor, over: Record<string, unknown> = {}) {
  return expectOk(
    await d.api.post('/health/doctor/locations', {
      kind: 'clinic',
      name: 'Gulberg Skin Clinic',
      addressLine: '12-B Main Boulevard',
      area: 'Gulberg III',
      city: 'Lahore',
      fee: 2500,
      slotMinutes: 15,
      ...over,
    }),
    201,
  );
}

export async function setSchedule(
  d: Doctor,
  locationId: string,
  ranges: Array<[number, string, string]>,
) {
  return expectOk(
    await d.api.put(
      `/health/doctor/locations/${locationId}/schedule`,
      ranges.map(([weekday, start, end]) => ({
        weekday,
        start,
        end,
      })) as unknown as object,
    ),
  );
}

/** A complete, published doctor with one clinic open every day 09:00–21:00 (PKT). */
export async function listedDoctor(
  t: TestApp,
  admin: Admin,
  opts: {
    specialty?: string;
    profile?: Record<string, unknown>;
    clinic?: Record<string, unknown>;
    hours?: [string, string];
  } = {},
) {
  const d = await approvedDoctor(t, admin);
  await expectOk(
    await d.api.patch(
      '/health/doctor/profile',
      fullProfile(
        d,
        await specialtyId(t, opts.specialty ?? 'dermatologist'),
        opts.profile,
      ),
    ),
  );
  const clinic = await addClinic(d, opts.clinic);
  const [from, to] = opts.hours ?? ['09:00', '21:00'];
  await setSchedule(
    d,
    clinic.id,
    [0, 1, 2, 3, 4, 5, 6].map(
      (wd) => [wd, from, to] as [number, string, string],
    ),
  );
  await expectOk(await d.api.post('/health/doctor/listing/publish'));
  return { doctor: d, clinic };
}
