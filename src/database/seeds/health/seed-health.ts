import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, Not } from 'typeorm';
import { User } from '../../../modules/users/entities/user.entity';
import { Business } from '../../../modules/businesses/entities/business.entity';
import { slugify } from '../../../modules/businesses/businesses.service';
import { Doctor } from '../../../modules/healthcare/doctors/entities/doctor.entity';
import {
  DoctorCondition,
  DoctorExperience,
  DoctorQualification,
  DoctorServiceItem,
} from '../../../modules/healthcare/doctors/entities/doctor-children.entity';
import { DoctorPaymentAccount } from '../../../modules/healthcare/doctors/entities/doctor-payment-account.entity';
import { PracticeLocation } from '../../../modules/healthcare/practice/entities/practice-location.entity';
import { WeeklySchedule } from '../../../modules/healthcare/practice/entities/weekly-schedule.entity';
import { FamilyMember } from '../../../modules/healthcare/family/entities/family-member.entity';
import { AppointmentEvent } from '../../../modules/healthcare/appointments/entities/appointment-event.entity';
import { DoctorReview } from '../../../modules/healthcare/reviews/entities/doctor-review.entity';
import { shortName } from '../../../modules/healthcare/reviews/reviews.service';
import { DoctorAggregatesService } from '../../../modules/healthcare/reviews/doctor-aggregates.service';
import { AvailabilityService } from '../../../modules/healthcare/availability/availability.service';
import { HealthEvents } from '../../../modules/healthcare/common/health-events';
import { HealthJobsService } from '../../../modules/healthcare/jobs/health-jobs.service';
import {
  DEFAULT_TZ,
  addDays,
  parseTime,
  todayIn,
  wallTimeToInstant,
  weekdayOf,
} from '../../../modules/healthcare/common/time.util';
import { newCode } from '../../../common/utils/codes';
import {
  buildPkIban,
  normalizeAccountNumber,
} from '../../../common/payments/payment-account.validation';
import { normalizePkPhone } from '../../../common/validation/phone';
import { PASSWORD_REGEX } from '../../../common/validation/password';
import {
  CITY_AREAS,
  CLINIC_HOURS,
  DEMO_DOCTORS,
  DEMO_HEALTH_BANNERS,
  DEMO_PATIENTS,
  DEMO_PORTRAITS,
  DemoDoctor,
  MBBS_COLLEGES,
  REVIEW_TEXTS,
  SPECIALTY_PROFILE,
  VIDEO_HOURS,
  bannerUrl,
  portraitUrl,
} from './doctors-data';
import { SeedImages } from '../shopping/tiles';
import { HealthBanner } from '../../../modules/healthcare/discovery/entities/health-banner.entity';

export const DEMO_DOCTOR_EMAIL = (key: string) =>
  `demo.${key}@metromatrix.test`;
export const DEMO_PATIENT_EMAIL = (key: string) =>
  `demo.${key}@metromatrix.test`;

export interface SeedHealthOptions {
  /** Password for every demo doctor and patient (from SEED_DEMO_PASSWORD). */
  password: string;
  bcryptRounds?: number;
  images: SeedImages;
  log?: (line: string) => void;
  now?: Date;
}

export interface SeedHealthResult {
  doctors: Array<{
    key: string;
    email: string;
    doctorId: string;
    reviews: number;
  }>;
  patients: string[];
  created: Record<
    | 'doctors'
    | 'patients'
    | 'locations'
    | 'appointments'
    | 'reviews'
    | 'banners'
    | 'portraitsRefreshed',
    number
  >;
}

/** Stable small numbers from a name, so reruns and machines agree. */
const hashInt = (s: string, mod: number) =>
  parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16) % mod;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');

/** An initials avatar an earlier run made (a placeholder or our own upload). */
const isGeneratedAvatar = (url: string | null, key: string) =>
  !url || url.includes('placehold.co') || url.includes(`seed-${key}-avatar`);

/** A round initials avatar — a generated image, for a doctor without a portrait. */
export function avatarSvg(text: string, bg: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="${bg}"/>
<circle cx="200" cy="200" r="150" fill="#FFFFFF" opacity="0.12"/>
<text x="200" y="208" fill="#FFFFFF" font-family="Helvetica, Arial, sans-serif" font-size="150" font-weight="700" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`;
}

/**
 * The demo Healthcare directory: 30 approved, PMDC-verified (demo numbers),
 * listed doctors with licensed stock portraits, clinics, hours, video for
 * half, qualifications, services, conditions, payment accounts; eight demo
 * patients; a history of completed visits (with check-in/start/complete
 * times, so wait and consult stats are real) and 0–40 reviews per doctor;
 * and the Health home's five banners.
 *
 * Idempotent: a doctor or patient found by email is left as it is (an
 * initials avatar from an earlier run becomes the doctor's portrait); a
 * banner found by title is re-pointed; derived numbers (ratings, wait times,
 * next available) are recomputed every run.
 */
export async function seedHealth(
  ds: DataSource,
  opts: SeedHealthOptions,
): Promise<SeedHealthResult> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  if (
    opts.password.length < 8 ||
    opts.password.length > 72 ||
    !PASSWORD_REGEX.test(opts.password)
  ) {
    throw new Error(
      'SEED_DEMO_PASSWORD must be 8–72 characters with a lower-case letter, an upper-case letter and a digit',
    );
  }
  const specialties = new Map<string, string>(
    (await ds.query(`SELECT id, slug FROM specialties`)).map(
      (r: { id: string; slug: string }) => [r.slug, r.id],
    ),
  );
  const conditions = new Map<string, string>(
    (await ds.query(`SELECT id, slug FROM conditions`)).map(
      (r: { id: string; slug: string }) => [r.slug, r.id],
    ),
  );
  if (!specialties.size)
    throw new Error('No specialties — run the migrations first.');

  const hash = await bcrypt.hash(opts.password, opts.bcryptRounds ?? 12);
  const created: SeedHealthResult['created'] = {
    doctors: 0,
    patients: 0,
    locations: 0,
    appointments: 0,
    reviews: 0,
    banners: 0,
    portraitsRefreshed: 0,
  };

  // ── Patients ──
  const patients: Array<{
    id: string;
    name: string;
    gender: string;
    phone: string;
    age: number;
  }> = [];
  for (const p of DEMO_PATIENTS) {
    const email = DEMO_PATIENT_EMAIL(p.key);
    let u = await ds.manager.findOne(User, {
      where: { email, status: Not('deleted') },
    });
    if (!u) {
      u = await ds.manager.save(
        ds.manager.create(User, {
          email,
          passwordHash: hash,
          displayName: p.name,
          role: 'customer',
          isEmailVerified: true,
          phone: normalizePkPhone(p.phone) ?? null,
          // Demo patients go straight to the app; Complete Profile may be skipped.
          profileSkippable: true,
        }),
      );
      created.patients += 1;
      if (p.key === 'patient1') {
        await ds.manager.insert(FamilyMember, [
          {
            userId: u.id,
            fullName: 'Zara Raza',
            relation: 'child',
            gender: 'female',
            dateOfBirth: '2019-04-12',
            phone: null,
          },
          {
            userId: u.id,
            fullName: 'Shahida Raza',
            relation: 'parent',
            gender: 'female',
            dateOfBirth: '1958-09-02',
            phone: null,
          },
        ]);
      }
    } else if (u.role !== 'customer') {
      throw new Error(`${email} exists but is not a customer account`);
    }
    patients.push({
      id: u.id,
      name: p.name,
      gender: p.gender,
      phone: normalizePkPhone(p.phone)!,
      age: p.age,
    });
  }

  // ── Doctors ──
  const result: SeedHealthResult['doctors'] = [];
  for (const [i, demo] of DEMO_DOCTORS.entries()) {
    const out = await ds.transaction(async (m) => {
      const email = DEMO_DOCTOR_EMAIL(demo.key);
      const existing = await m.findOne(User, {
        where: { email, status: Not('deleted') },
      });
      if (existing) {
        const [d] = await m.query(
          `SELECT d.id, d.rating_count, d.photo_url FROM doctors d JOIN businesses b ON b.id = d.business_id WHERE b.owner_user_id = $1`,
          [existing.id],
        );
        if (!d) throw new Error(`${email} exists but has no doctor profile`);
        // Earlier runs gave initials avatars: swap in the doctor's portrait.
        const portrait = DEMO_PORTRAITS[demo.key];
        if (portrait && isGeneratedAvatar(d.photo_url, demo.key)) {
          const photo = await opts.images.remote({
            ownerUserId: existing.id,
            purpose: 'doctor_photo',
            storeKey: demo.key,
            name: 'portrait',
            url: portraitUrl(portrait),
          });
          await m.query(
            `UPDATE doctors SET photo_url = $2, updated_at = now() WHERE id = $1`,
            [d.id, photo.url],
          );
          created.portraitsRefreshed += 1;
        }
        return {
          key: demo.key,
          email,
          doctorId: d.id as string,
          reviews: d.rating_count as number,
        };
      }
      const doctorId = await createDoctor(
        m,
        demo,
        i,
        hash,
        specialties,
        conditions,
        opts.images,
        now,
        created,
      );
      const reviews = await createHistory(
        m,
        demo,
        doctorId,
        patients,
        now,
        created,
      );
      return { key: demo.key, email, doctorId, reviews };
    });
    result.push(out);
    log(
      `[seed] ${demo.key} ${demo.name} (${demo.specialty}, ${demo.city}): ${out.reviews} reviews`,
    );
  }

  // ── Home banners (idempotent by title; re-pointed on every run) ──
  const bannerOwner: string = (
    await ds.query(
      `SELECT b.owner_user_id FROM doctors d JOIN businesses b ON b.id = d.business_id WHERE d.id = $1`,
      [result[0].doctorId],
    )
  )[0].owner_user_id;
  for (const [i, b] of DEMO_HEALTH_BANNERS.entries()) {
    const t = b.target;
    const targetId =
      t.type === 'specialty'
        ? specialties.get(t.slug)
        : t.type === 'condition'
          ? conditions.get(t.slug)
          : null;
    if (t.type !== 'screen' && !targetId)
      throw new Error(`Banner "${b.title}": no ${t.type} ${t.slug}`);
    const columns = {
      targetType: t.type,
      targetId: targetId ?? null,
      targetScreen: t.type === 'screen' ? t.screen : null,
      city: b.city ?? null,
    };
    const existing = await ds.manager.findOne(HealthBanner, {
      where: { title: b.title },
    });
    if (existing) {
      await ds.manager.update(HealthBanner, { id: existing.id }, columns);
      continue;
    }
    const image = await opts.images.remote({
      ownerUserId: bannerOwner,
      purpose: 'banner',
      storeKey: 'health',
      name: `banner-${i + 1}`,
      url: bannerUrl(b.photo),
    });
    await ds.manager.insert(HealthBanner, {
      imageUrl: image.url,
      title: b.title,
      subtitle: b.subtitle,
      ...columns,
      sort: i,
      isActive: true,
    });
    created.banners += 1;
  }

  // ── Derived numbers, exactly as the app computes them ──
  const aggregates = new DoctorAggregatesService(ds, {
    nightly: [],
  } as unknown as HealthJobsService);
  await aggregates.refresh(null, null, now);
  await aggregates.refreshTopBooked(null);
  await new AvailabilityService(ds, new HealthEvents()).refreshAllListed(now);

  return {
    doctors: result,
    patients: DEMO_PATIENTS.map((p) => DEMO_PATIENT_EMAIL(p.key)),
    created,
  };
}

async function createDoctor(
  m: EntityManager,
  demo: DemoDoctor,
  index: number,
  hash: string,
  specialties: Map<string, string>,
  conditions: Map<string, string>,
  images: SeedImages,
  now: Date,
  created: SeedHealthResult['created'],
): Promise<string> {
  const profile = SPECIALTY_PROFILE[demo.specialty];
  const specialtyId = specialties.get(demo.specialty);
  if (!profile || !specialtyId)
    throw new Error(`${demo.key}: unknown specialty ${demo.specialty}`);
  const phone = normalizePkPhone(
    `0300${String(7000000 + index).padStart(7, '0')}`,
  )!;
  const owner = await m.save(
    m.create(User, {
      email: DEMO_DOCTOR_EMAIL(demo.key),
      passwordHash: hash,
      displayName: demo.name,
      role: 'partner',
      isEmailVerified: true,
      phone,
    }),
  );
  const pmdc = `DEMO-${String(index + 1).padStart(5, '0')}-P`;
  const prefix =
    demo.title === 'dr'
      ? 'Dr.'
      : demo.title === 'prof'
        ? 'Prof. Dr.'
        : demo.title === 'assoc_prof'
          ? 'Assoc. Prof. Dr.'
          : 'Asst. Prof. Dr.';
  const business = await m.save(
    m.create(Business, {
      ownerUserId: owner.id,
      serviceType: 'healthcare',
      subType: 'doctor',
      name: `${prefix} ${demo.name}`,
      slug: slugify(`dr ${demo.name} ${demo.key}`),
      phone,
      city: demo.city,
      addressLine: CITY_AREAS[demo.city][0].area,
      pmdcNumber: pmdc,
      // Demo doctors are approved and verified directly; real ones go through review.
      status: 'approved',
      submittedAt: now,
      reviewedAt: now,
    }),
  );
  const portrait = DEMO_PORTRAITS[demo.key];
  const photo = portrait
    ? await images.remote({
        ownerUserId: owner.id,
        purpose: 'doctor_photo',
        storeKey: demo.key,
        name: 'portrait',
        url: portraitUrl(portrait),
      })
    : await images.image({
        ownerUserId: owner.id,
        purpose: 'doctor_photo',
        storeKey: demo.key,
        name: 'avatar',
        title: initials(demo.name),
        bg: profile.colour,
        fg: '#FFFFFF',
        motif: 'dots',
        width: 400,
        height: 400,
        svg: avatarSvg(initials(demo.name), profile.colour),
      });
  const years = new Date(now).getUTCFullYear() - demo.since;
  const doctor = await m.save(
    m.create(Doctor, {
      businessId: business.id,
      title: demo.title,
      fullName: demo.name,
      gender: demo.gender,
      photoUrl: photo.url,
      pmdcNumber: pmdc,
      pmdcVerifiedAt: now,
      pmdcVerifiedBy: null,
      primarySpecialtyId: specialtyId,
      practicingSince: demo.since,
      about:
        `${prefix} ${demo.name} is a ${demo.specialty.replace(/-/g, ' ')} in ${demo.city} with ${years} years of practice, ` +
        `seeing patients for ${profile.services.slice(0, 2).join(' and ').toLowerCase()}. (Demo profile: this doctor is fictional.)`,
      languages: ['English', 'Urdu', ...(demo.languages ?? [])],
      bookingWindowDays: 14,
      minNoticeMinutes: 60,
      cancelCutoffMinutes: 120,
      videoPrepayRequired: demo.video && hashInt(demo.key, 2) === 0,
      isListed: true,
      isAccepting: true,
    }),
  );
  created.doctors += 1;
  const colleges = MBBS_COLLEGES[demo.city];
  await m.insert(
    DoctorQualification,
    demo.specialty === 'dentist'
      ? [
          {
            doctorId: doctor.id,
            degree: profile.degree,
            institute:
              profile.institutes[hashInt(demo.key, profile.institutes.length)],
            year: demo.since - 1,
            sort: 0,
          },
        ]
      : [
          {
            doctorId: doctor.id,
            degree: 'MBBS',
            institute: colleges[hashInt(demo.key, colleges.length)],
            year: demo.since - 1,
            sort: 0,
          },
          {
            doctorId: doctor.id,
            degree: profile.degree,
            institute: profile.institutes[0],
            year: Math.min(demo.since + 4, now.getUTCFullYear()),
            sort: 1,
          },
        ],
  );
  await m.insert(DoctorExperience, [
    {
      doctorId: doctor.id,
      designation: demo.title === 'dr' ? 'Consultant' : 'Associate Professor',
      institute: `${demo.city} Teaching Hospital (demo)`,
      fromYear: Math.min(demo.since + 5, now.getUTCFullYear()),
      toYear: null,
      sort: 0,
    },
    {
      doctorId: doctor.id,
      designation: 'Medical Officer',
      institute: `${demo.city} General Hospital (demo)`,
      fromYear: demo.since,
      toYear: Math.min(demo.since + 5, now.getUTCFullYear()),
      sort: 1,
    },
  ]);
  await m.insert(
    DoctorServiceItem,
    profile.services.map((name, sort) => ({ doctorId: doctor.id, name, sort })),
  );
  const conditionIds = profile.conditions
    .map((c) => conditions.get(c))
    .filter((x): x is string => !!x);
  if (conditionIds.length)
    await m.insert(
      DoctorCondition,
      conditionIds.map((conditionId) => ({ doctorId: doctor.id, conditionId })),
    );

  // Locations: 1–3 clinics in different areas, never overlapping; video for half.
  const areas = CITY_AREAS[demo.city];
  for (let c = 0; c < demo.clinics; c++) {
    const where = areas[(hashInt(demo.key, areas.length) + c) % areas.length];
    const fee =
      profile.baseFee + (c === 0 ? 0 : 500) + (demo.title === 'dr' ? 0 : 1000);
    const loc = await m.save(
      m.create(PracticeLocation, {
        doctorId: doctor.id,
        kind: 'clinic',
        name: `${where.area} ${c === 1 ? 'Medical Centre' : c === 2 ? 'Family Clinic' : 'Clinic'} (demo)`,
        addressLine: `${10 + hashInt(demo.key + c, 80)}-${String.fromCharCode(65 + c)} Main Boulevard`,
        area: where.area,
        city: demo.city,
        lat: where.lat + (hashInt(demo.key + 'lat' + c, 100) - 50) / 10000,
        lng: where.lng + (hashInt(demo.key + 'lng' + c, 100) - 50) / 10000,
        phone,
        timezone: DEFAULT_TZ,
        fee,
        slotMinutes: profile.slotMinutes,
        instructions:
          'Please arrive 10 minutes early and ask for your token at reception.',
        isActive: true,
      }),
    );
    created.locations += 1;
    await m.insert(
      WeeklySchedule,
      CLINIC_HOURS[c].map(([weekday, start, end]) => ({
        locationId: loc.id,
        weekday,
        startTime: start,
        endTime: end,
      })),
    );
  }
  if (demo.video) {
    const loc = await m.save(
      m.create(PracticeLocation, {
        doctorId: doctor.id,
        kind: 'video',
        name: 'Video consultation',
        addressLine: null,
        area: null,
        city: null,
        lat: null,
        lng: null,
        phone: null,
        timezone: DEFAULT_TZ,
        fee: Math.max(1000, profile.baseFee - 500),
        slotMinutes: 30,
        instructions: 'Join from the app 10 minutes before your time.',
        isActive: true,
      }),
    );
    created.locations += 1;
    await m.insert(
      WeeklySchedule,
      VIDEO_HOURS.map(([weekday, start, end]) => ({
        locationId: loc.id,
        weekday,
        startTime: start,
        endTime: end,
      })),
    );
    const iban = buildPkIban(
      'MEZN',
      String(1000000000000000 + index * 7919).slice(0, 16),
    );
    const norm = normalizeAccountNumber('bank', iban);
    if (!norm.ok) throw new Error(`${demo.key}: bad demo IBAN: ${norm.reason}`);
    await m.insert(DoctorPaymentAccount, {
      doctorId: doctor.id,
      kind: 'bank',
      accountTitle: `${prefix} ${demo.name}`,
      accountNumber: norm.value,
      bankName: 'Meezan Bank (demo)',
      isActive: true,
    });
  }
  await m.query(`SELECT doctor_search_refresh($1)`, [doctor.id]);
  return doctor.id;
}

/** Past completed visits (measured wait/consult) and 0–40 reviews. Returns the review count. */
async function createHistory(
  m: EntityManager,
  demo: DemoDoctor,
  doctorId: string,
  patients: Array<{
    id: string;
    name: string;
    gender: string;
    phone: string;
    age: number;
  }>,
  now: Date,
  created: SeedHealthResult['created'],
): Promise<number> {
  const locations = await m.find(PracticeLocation, {
    where: { doctorId },
    order: { kind: 'ASC', createdAt: 'ASC' },
  });
  const schedules = await m.query(
    `SELECT location_id, weekday, start_time FROM weekly_schedules WHERE location_id = ANY($1::uuid[]) ORDER BY weekday, start_time`,
    [locations.map((l) => l.id)],
  );
  const reviewCount = hashInt(`${demo.key}:reviews`, 41);
  const visits = reviewCount + 6 + hashInt(`${demo.key}:visits`, 8);
  const today = todayIn(DEFAULT_TZ, now);
  let made = 0;
  let reviews = 0;
  for (let v = 0; v < visits; v++) {
    // A past day (1–80 days ago) on which one of the doctor's locations is open.
    const loc = locations[v % locations.length];
    const open = schedules.filter((s: any) => s.location_id === loc.id);
    let date = addDays(today, -(1 + ((v * 3 + hashInt(demo.key, 5)) % 80)));
    let tries = 0;
    while (!open.some((s: any) => s.weekday === weekdayOf(date)) && tries++ < 7)
      date = addDays(date, -1);
    const slotOfDay = open.find((s: any) => s.weekday === weekdayOf(date));
    if (!slotOfDay) continue;
    const startMin =
      parseTime(String(slotOfDay.start_time).slice(0, 5)) +
      (v % 6) * loc.slotMinutes;
    const startsAt = wallTimeToInstant(date, startMin, loc.timezone);
    if (!startsAt) continue;
    const endsAt = new Date(startsAt.getTime() + loc.slotMinutes * 60_000);
    const wait = 3 + hashInt(`${demo.key}:${v}:wait`, 30);
    const consult = 8 + hashInt(`${demo.key}:${v}:consult`, 13);
    const checkedInAt =
      loc.kind === 'clinic'
        ? new Date(startsAt.getTime() - (2 + (v % 9)) * 60_000)
        : null;
    const startedAt = new Date(startsAt.getTime() + wait * 60_000);
    const completedAt = new Date(startedAt.getTime() + consult * 60_000);
    const bookedAt = new Date(startsAt.getTime() - (1 + (v % 5)) * 86_400_000);
    const p =
      patients[(v + hashInt(demo.key, patients.length)) % patients.length];
    const code = newCode('HC');
    const [{ id }] = await m.query(
      `INSERT INTO appointments (code, patient_user_id, patient_snapshot, doctor_id, location_id, kind, starts_at, ends_at,
                                 status, reason, symptoms, fee, payment_method, payment_status, paid_at,
                                 checked_in_at, started_at, completed_at, video_room, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, '{}', $10, $11, 'paid', $12, $13, $14, $15, $16, $17, $15)
       ON CONFLICT ("code") DO NOTHING RETURNING id`,
      [
        code,
        p.id,
        JSON.stringify({
          name: p.name,
          gender: p.gender,
          age: p.age,
          phone: p.phone,
          relation: null,
        }),
        doctorId,
        loc.id,
        loc.kind,
        startsAt,
        endsAt,
        'Follow-up visit',
        loc.fee,
        loc.kind === 'video' ? 'transfer' : 'pay_at_clinic',
        completedAt,
        checkedInAt,
        startedAt,
        completedAt,
        loc.kind === 'video' ? randomUUID() : null,
        bookedAt,
      ],
    );
    if (!id) continue;
    made += 1;
    const patientActor = { actorRole: 'patient' as const, actorUserId: p.id };
    const doctorActor = { actorRole: 'doctor' as const, actorUserId: null };
    await m.insert(AppointmentEvent, [
      {
        appointmentId: id,
        kind: 'status',
        from: null,
        to: 'booked',
        note: null,
        at: bookedAt,
        ...patientActor,
      },
      ...(checkedInAt
        ? [
            {
              appointmentId: id,
              kind: 'status' as const,
              from: 'booked',
              to: 'checked_in',
              note: null,
              at: checkedInAt,
              ...doctorActor,
            },
          ]
        : []),
      {
        appointmentId: id,
        kind: 'status',
        from: checkedInAt ? 'checked_in' : 'booked',
        to: 'in_consultation',
        note: null,
        at: startedAt,
        ...doctorActor,
      },
      {
        appointmentId: id,
        kind: 'status',
        from: 'in_consultation',
        to: 'completed',
        note: null,
        at: completedAt,
        ...doctorActor,
      },
      {
        appointmentId: id,
        kind: 'payment',
        from: loc.kind === 'video' ? 'awaiting_transfer' : 'unpaid',
        to: 'paid',
        note: 'Collected at the visit',
        at: completedAt,
        ...doctorActor,
      },
    ]);
    if (reviews < reviewCount) {
      const overall = [5, 5, 4, 5, 4, 3, 5, 4, 2, 5][
        hashInt(`${demo.key}:${v}:stars`, 10)
      ];
      const tone = overall >= 4 ? 'good' : overall === 3 ? 'ok' : 'bad';
      const texts = REVIEW_TEXTS[tone];
      const tags =
        overall >= 4
          ? (
              [
                'explained_well',
                'friendly',
                'great_experience',
                'on_time',
                'no_wait',
                'clean_clinic',
                'value_for_money',
              ] as const
            )
              .filter((_, k) => hashInt(`${demo.key}:${v}:tag${k}`, 3) === 0)
              .filter(
                (t) =>
                  loc.kind === 'clinic' ||
                  (t !== 'clean_clinic' && t !== 'no_wait'),
              )
              .slice(0, 3)
          : [];
      const anonymous = hashInt(`${demo.key}:${v}:anon`, 5) === 0;
      const reviewedAt = new Date(
        completedAt.getTime() + (2 + (v % 30)) * 3600_000,
      );
      const replied =
        overall <= 3 && hashInt(`${demo.key}:${v}:reply`, 2) === 0;
      await m.insert(DoctorReview, {
        appointmentId: id,
        doctorId,
        patientUserId: p.id,
        kind: loc.kind,
        overall,
        diagnosis: Math.max(
          1,
          Math.min(5, overall + hashInt(`${demo.key}:${v}:dx`, 3) - 1),
        ),
        staff:
          loc.kind === 'clinic'
            ? Math.max(
                1,
                Math.min(5, overall - hashInt(`${demo.key}:${v}:st`, 2)),
              )
            : null,
        environment:
          loc.kind === 'clinic'
            ? Math.max(
                1,
                Math.min(5, overall - hashInt(`${demo.key}:${v}:env`, 2)),
              )
            : null,
        recommend: overall >= 4,
        tags: [...tags],
        text:
          hashInt(`${demo.key}:${v}:txt`, 4) === 0
            ? null
            : texts[hashInt(`${demo.key}:${v}:t`, texts.length)],
        isAnonymous: anonymous,
        authorName: shortName(p.name, anonymous),
        doctorReply: replied
          ? 'Thank you for the feedback — we are working on waiting times.'
          : null,
        repliedAt: replied ? new Date(reviewedAt.getTime() + 86_400_000) : null,
        createdAt: reviewedAt,
      });
      reviews += 1;
    }
  }
  created.appointments += made;
  created.reviews += reviews;
  return reviews;
}
