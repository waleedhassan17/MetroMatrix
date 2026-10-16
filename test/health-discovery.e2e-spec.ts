import { ApiClient, createTestApp, TestApp } from './utils/test-app';
import { enrolledAdmin } from './utils/admin';
import { Admin } from './utils/shopping';
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
  availabilityLabel,
  localDayBounds,
  todayIn,
} from '../src/modules/healthcare/common/time.util';

const PKT = 'Asia/Karachi';
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * Four listed doctors chosen so that every filter and every sort picks out a
 * different subset or order:
 *   D1 derm  F  Lahore/Gulberg clinic 3000 + video 2000  since 2005  4.8 (40)  English, Urdu, Punjabi
 *   D2 derm  M  Karachi/Clifton clinic 1500              since 2018  4.2 (5)   off today
 *   D3 cardio F Lahore/DHA clinic 5000 + video 4000       since 2000  3.5 (100)
 *   D4 peds  M  Islamabad clinic 2500, lists acne         since 2012  0 (0)     Urdu, Pashto
 */
describe('Healthcare P2: availability + discovery (e2e)', () => {
  let t: TestApp;
  let admin: Admin;
  let anon: ApiClient;
  const D: Record<'D1' | 'D2' | 'D3' | 'D4', Doctor> = {} as any;
  const clinic: Record<string, string> = {};

  const ids = async (query: string) => {
    const res = await anon
      .get(`/health/doctors?pageSize=100&${query}`)
      .expect(200);
    const mine = new Set(Object.values(D).map((d) => d.doctorId));
    const names = Object.fromEntries(
      Object.entries(D).map(([k, d]) => [d.doctorId, k]),
    );
    return res.body.data.items
      .filter((c: any) => mine.has(c.id))
      .map((c: any) => names[c.id]);
  };

  async function make(
    key: keyof typeof D,
    spec: {
      specialty: string;
      name: string;
      gender: string;
      since: number;
      languages: string[];
      fee: number;
      city: string;
      area: string;
      videoFee?: number;
      rating: [number, number];
      notice?: number;
    },
  ) {
    const d = await approvedDoctor(t, admin);
    await expectOk(
      await d.api.patch(
        '/health/doctor/profile',
        fullProfile(d, await specialtyId(t, spec.specialty), {
          fullName: spec.name,
          gender: spec.gender,
          practicingSince: spec.since,
          languages: spec.languages,
          minNoticeMinutes: spec.notice ?? 0,
        }),
      ),
    );
    const c = await addClinic(d, {
      fee: spec.fee,
      city: spec.city,
      area: spec.area,
      name: `${spec.name} Clinic`,
    });
    clinic[key] = c.id;
    if (spec.videoFee) {
      const v = await expectOk(
        await d.api.post('/health/doctor/locations', {
          kind: 'video',
          fee: spec.videoFee,
        }),
        201,
      );
      await setSchedule(
        d,
        c.id,
        EVERY_DAY.map((w) => [w, '00:00', '12:00'] as [number, string, string]),
      );
      await setSchedule(
        d,
        v.id,
        EVERY_DAY.map((w) => [w, '12:00', '24:00'] as [number, string, string]),
      );
    } else if (key === 'D2') {
      await setSchedule(
        d,
        c.id,
        EVERY_DAY.flatMap(
          (w) =>
            [
              [w, '10:00', '14:00'],
              [w, '17:00', '21:00'],
            ] as Array<[number, string, string]>,
        ),
      );
    } else {
      await setSchedule(
        d,
        c.id,
        EVERY_DAY.map((w) => [w, '00:00', '24:00'] as [number, string, string]),
      );
    }
    await expectOk(await d.api.post('/health/doctor/listing/publish'));
    await t.ds.query(
      `UPDATE doctors SET rating_avg = $2, rating_count = $3 WHERE id = $1`,
      [d.doctorId, ...spec.rating],
    );
    D[key] = d;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await enrolledAdmin(t);
    anon = new ApiClient(t.http);
    await make('D1', {
      specialty: 'dermatologist',
      name: 'Ayesha Rehman',
      gender: 'female',
      since: 2005,
      languages: ['English', 'Urdu', 'Punjabi'],
      fee: 3000,
      city: 'Lahore',
      area: 'Gulberg III',
      videoFee: 2000,
      rating: [4.8, 40],
    });
    await make('D2', {
      specialty: 'dermatologist',
      name: 'Bilal Chaudhry',
      gender: 'male',
      since: 2018,
      languages: ['English', 'Urdu'],
      fee: 1500,
      city: 'Karachi',
      area: 'Clifton',
      rating: [4.2, 5],
    });
    await make('D3', {
      specialty: 'cardiologist',
      name: 'Farah Siddiqui',
      gender: 'female',
      since: 2000,
      languages: ['English'],
      fee: 5000,
      city: 'Lahore',
      area: 'DHA Phase 5',
      videoFee: 4000,
      rating: [3.5, 100],
      notice: 45,
    });
    await make('D4', {
      specialty: 'pediatrician',
      name: 'Hamza Qureshi',
      gender: 'male',
      since: 2012,
      languages: ['Urdu', 'Pashto'],
      fee: 2500,
      city: 'Islamabad',
      area: 'F-7',
      rating: [0, 0],
      notice: 30,
    });
    const acne = (
      await t.ds.query(`SELECT id FROM conditions WHERE slug = 'acne'`)
    )[0].id;
    await expectOk(
      await D.D4.api.patch('/health/doctor/profile', { conditionIds: [acne] }),
    );
    // D2 is away for the whole of today (local), so first free is tomorrow 10:00.
    const { start, end } = localDayBounds(todayIn(PKT), PKT);
    await expectOk(
      await D.D2.api.post('/health/doctor/time-off', {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        reason: 'Leave',
      }),
      201,
    );
  });
  afterAll(() => t.close());

  it('every filter changes the result set', async () => {
    const all = ['D1', 'D2', 'D3', 'D4'];
    expect((await ids('')).sort()).toEqual(all);
    const derm = await specialtyId(t, 'dermatologist');
    const acne = (
      await t.ds.query(`SELECT id FROM conditions WHERE slug = 'acne'`)
    )[0].id;
    const cases: Array<[string, string[]]> = [
      [`specialtyId=${derm}`, ['D1', 'D2']],
      [`conditionId=${acne}`, ['D1', 'D2', 'D4']], // derm treats acne; D4 lists it
      ['city=lahore', ['D1', 'D3']],
      ['area=clifton', ['D2']],
      ['kind=video', ['D1', 'D3']],
      ['availableToday=true', ['D1', 'D3', 'D4']],
      ['gender=female', ['D1', 'D3']],
      ['minFee=2500', ['D3', 'D4']], // D1's cheapest is its 2000 video fee
      ['maxFee=1800', ['D2']],
      ['kind=video&maxFee=2500', ['D1']],
      ['minExperience=15', ['D1', 'D3']],
      ['minRating=4', ['D1', 'D2']],
      ['language=punjabi', ['D1']],
      ['q=skin', ['D1', 'D2']],
      ['q=pimples', ['D1', 'D2', 'D4']],
      [`q=${encodeURIComponent('ماہر امراض جلد')}`, ['D1', 'D2']],
      ['q=farah%20sidiqui', ['D3']], // a typo in the name
    ];
    for (const [query, expected] of cases) {
      expect({ query, got: (await ids(query)).sort() }).toEqual({
        query,
        got: expected,
      });
    }
  });

  it('every sort changes the order', async () => {
    const reviews = await ids('sort=reviews');
    expect(reviews).toEqual(['D3', 'D1', 'D2', 'D4']);
    expect(await ids('sort=experience')).toEqual(['D3', 'D1', 'D4', 'D2']);
    const asc = await ids('sort=fee_asc');
    expect(asc).toEqual(['D2', 'D1', 'D4', 'D3']); // 1500, 2000 (video), 2500, 4000 (video)
    const desc = await ids('sort=fee_desc');
    expect(desc).toEqual(['D3', 'D4', 'D1', 'D2']);
    const earliest = await anon
      .get('/health/doctors?pageSize=100&sort=earliest')
      .expect(200);
    const mine = earliest.body.data.items.filter((c: any) =>
      Object.values(D).some((d) => d.doctorId === c.id),
    );
    const times = mine.map((c: any) => new Date(c.nextAvailable.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // Notice periods 0 / 30 / 45 min make the earliest order exact; D2 is off today.
    expect(await ids('sort=earliest')).toEqual(['D1', 'D4', 'D3', 'D2']);
    const recommended = await ids('sort=recommended');
    expect(recommended[0]).toBe('D1');
    expect(
      new Set(
        [
          reviews,
          await ids('sort=experience'),
          asc,
          desc,
          await ids('sort=earliest'),
          recommended,
        ].map((o) => o.join()),
      ).size,
    ).toBe(6);
  });

  it('cards carry server-made labels in Karachi time while the server runs in UTC', async () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
    const res = await anon.get('/health/doctors?pageSize=100').expect(200);
    const card = (k: keyof typeof D) =>
      res.body.data.items.find((c: any) => c.id === D[k].doctorId);
    const d2 = card('D2');
    expect(d2.nextAvailable.at).toMatch(/T10:00:00\.000\+05:00$/);
    expect(d2.nextAvailable).toMatchObject({
      locationKind: 'clinic',
      label: 'Available tomorrow from 10:00 AM',
    });
    for (const k of ['D1', 'D3', 'D4'] as const) {
      const n = card(k).nextAvailable;
      expect(n.at).toMatch(/\+05:00$/);
      expect(n.label).toBe(availabilityLabel(new Date(n.at), PKT));
      expect(n.label).toMatch(/^Available today, \d{1,2}:\d{2} (AM|PM)$/);
    }
    expect(card('D1')).toMatchObject({
      displayName: 'Dr. Ayesha Rehman',
      specialty: { slug: 'dermatologist', nameUr: 'ماہر امراض جلد' },
      qualifications: 'MBBS',
      yearsExperience: new Date().getUTCFullYear() - 2005,
      ratingAvg: 4.8,
      ratingCount: 40,
      pmdcVerified: true,
      minFee: 2000,
      offersVideo: true,
    });
  });

  it('slots for a location: days, periods, ISO with offset; bounds enforced', async () => {
    const res = await anon
      .get(
        `/health/doctors/${D.D2.doctorId}/locations/${clinic.D2}/slots?days=3`,
      )
      .expect(200);
    const [today, tomorrow] = res.body.data.days;
    expect(res.body.data.location).toMatchObject({
      kind: 'clinic',
      fee: 1500,
      timezone: PKT,
      slotMinutes: 15,
    });
    expect(today).toMatchObject({
      date: todayIn(PKT),
      isAvailable: false,
      slots: [],
    }); // time off
    expect(tomorrow.isAvailable).toBe(true);
    expect(tomorrow.slots[0]).toMatchObject({ period: 'morning' });
    expect(tomorrow.slots[0].startsAt).toMatch(/T10:00:00\.000\+05:00$/);
    expect(
      tomorrow.slots.filter((s: any) => s.period === 'evening').length,
    ).toBe(16); // 17:00–21:00 by 15 min
    expect(tomorrow.slots).toHaveLength(32);
    await anon
      .get(
        `/health/doctors/${D.D2.doctorId}/locations/${clinic.D2}/slots?days=20`,
      )
      .expect(400);
    await anon
      .get(`/health/doctors/${D.D2.doctorId}/locations/${clinic.D1}/slots`)
      .expect(404);
    const other = await approvedDoctor(t, admin);
    const unlisted = await addClinic(other);
    const r = await anon
      .get(`/health/doctors/${other.doctorId}/locations/${unlisted.id}/slots`)
      .expect(404);
    expect(r.body.error.code).toBe('DOCTOR_NOT_LISTED');
  });

  it('profile, similar, specialties, home and suggest', async () => {
    const p = (await anon.get(`/health/doctors/${D.D2.doctorId}`).expect(200))
      .body.data;
    expect(p).toMatchObject({
      displayName: 'Dr. Bilal Chaudhry',
      badges: { pmdcVerified: true, topBooked: false },
      stats: { ratingAvg: 4.2, ratingCount: 5 },
      reviewSummary: { count: 0 },
    });
    expect(p.locations[0].timings[0]).toEqual({
      weekday: 0,
      weekdayLabel: 'Sun',
      ranges: [
        { start: '10:00', end: '14:00', label: '10:00 AM – 2:00 PM' },
        { start: '17:00', end: '21:00', label: '5:00 PM – 9:00 PM' },
      ],
    });
    expect(p.locations[0].nextAvailable.label).toBe(
      'Available tomorrow from 10:00 AM',
    );

    // D2 is the only Karachi dermatologist, so its list is led by the most-reviewed
    // dermatologist elsewhere (D1) whatever other suites have left listed.
    const similar = (
      await anon.get(`/health/doctors/${D.D2.doctorId}/similar`).expect(200)
    ).body.data;
    expect(similar[0].id).toBe(D.D1.doctorId);
    expect(similar.map((c: any) => c.id)).not.toContain(D.D2.doctorId);

    const specialties = (
      await anon.get('/health/specialties?city=Karachi').expect(200)
    ).body.data;
    expect(
      specialties.find((s: any) => s.slug === 'dermatologist').doctorCount,
    ).toBeGreaterThanOrEqual(1);
    expect(
      specialties.find((s: any) => s.slug === 'cardiologist').doctorCount,
    ).toBe(0);

    const home = (await anon.get('/health/home?city=Lahore').expect(200)).body
      .data;
    expect(home.specialties).toHaveLength(12);
    expect(home.commonConditions.length).toBeGreaterThan(5);
    // "Available today nearby" is the first page of the earliest-first city list
    // (other suites' Lahore doctors may fill it, so pin it to the list contract).
    const nearby = home.availableTodayNearby.map((c: any) => c.id);
    const ids = async (q: string) =>
      (await anon.get(`/health/doctors?${q}`).expect(200)).body.data.items.map(
        (c: any) => c.id,
      );
    expect(nearby).toEqual(
      await ids('city=Lahore&availableToday=true&sort=earliest&pageSize=10'),
    );
    const lahoreToday = await ids(
      'city=Lahore&availableToday=true&minExperience=15&pageSize=100',
    );
    expect(lahoreToday).toEqual(
      expect.arrayContaining([D.D1.doctorId, D.D3.doctorId]),
    );
    expect(lahoreToday).not.toContain(D.D2.doctorId);
    expect(home.upcomingAppointment).toBeNull();
    expect(home.featuredDoctors.length).toBeGreaterThan(0);

    const suggest = (
      await anon.get('/health/search/suggest?q=farah').expect(200)
    ).body.data;
    expect(suggest.doctors.map((c: any) => c.id)).toContain(D.D3.doctorId);
    expect(suggest.doctors.length).toBeLessThanOrEqual(5);
  });
});
