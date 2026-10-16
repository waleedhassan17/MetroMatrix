import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DOCTOR_FROM_SQL, LISTED_DOCTOR_SQL } from './listing-sql';
import { DoctorQueryDto } from './dto/discovery.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { SqlParams } from '../../../common/utils/sql-params';
import { likeEscape } from '../../../common/pagination/pagination';
import {
  ReferenceService,
  TRIGRAM_MIN,
  specialtyView,
} from '../reference/reference.service';
import { SearchSuggestService } from '../reference/search-suggest.service';
import { AvailabilityService } from '../availability/availability.service';
import {
  availabilityLabel,
  formatMinutes,
  parseTime,
  toZonedIso,
  weekdayLabel,
  yearsSince,
} from '../common/time.util';

export const notListed = () =>
  new NotFoundException({
    code: ErrorCode.DOCTOR_NOT_LISTED,
    message: 'This doctor is not taking bookings on MetroMatrix.',
  });

export const TITLE_PREFIX: Record<string, string> = {
  dr: 'Dr.',
  prof: 'Prof. Dr.',
  assoc_prof: 'Assoc. Prof. Dr.',
  asst_prof: 'Asst. Prof. Dr.',
};

/** Minutes since midnight → "2:00 PM" (24:00 → "12:00 AM"). */
const to12h = (mins: number) => {
  const h24 = Math.floor(mins / 60) % 24;
  return `${h24 % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
};

export interface ReviewSummary {
  count: number;
  averages: Record<
    'overall' | 'diagnosis' | 'staff' | 'environment',
    number | null
  >;
  satisfactionPct: number | null;
  topTags: Array<{ tag: string; count: number }>;
  latest: unknown[];
}

const EMPTY_SUMMARY: ReviewSummary = {
  count: 0,
  averages: { overall: null, diagnosis: null, staff: null, environment: null },
  satisfactionPct: null,
  topTags: [],
  latest: [],
};

/**
 * Public doctor discovery — every read here uses the one visibility rule
 * (listing-sql.ts). Next-available labels are made server-side in each
 * location's own zone, whatever zone the server runs in.
 */
@Injectable()
export class DiscoveryService implements OnModuleInit {
  /** Filled in by reviews (P5). */
  reviewSummary: (doctorId: string) => Promise<ReviewSummary> = async () =>
    EMPTY_SUMMARY;
  /** Filled in by appointments (P3): the signed-in patient's next appointment. */
  upcomingFor: (userId: string) => Promise<unknown | null> = async () => null;
  /** Filled in by appointments (P3): specialty ids by bookings; until then by listed doctors. */
  specialtyRanking: (limit: number) => Promise<string[]> = async (limit) =>
    (
      await this.dataSource.query(
        `SELECT d.primary_specialty_id AS id, count(*) AS n ${DOCTOR_FROM_SQL}
          WHERE ${LISTED_DOCTOR_SQL} AND d.primary_specialty_id IS NOT NULL
          GROUP BY 1 ORDER BY n DESC LIMIT $1`,
        [limit],
      )
    ).map((r: { id: string }) => r.id);

  constructor(
    private readonly dataSource: DataSource,
    private readonly reference: ReferenceService,
    private readonly suggest: SearchSuggestService,
    private readonly availability: AvailabilityService,
  ) {}

  onModuleInit(): void {
    this.suggest.doctors = async (q, limit) =>
      (await this.list({ q, page: 1, pageSize: limit } as DoctorQueryDto))
        .items;
  }

  async assertListed(doctorId: string): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT 1 ${DOCTOR_FROM_SQL} WHERE d.id = $1 AND ${LISTED_DOCTOR_SQL}`,
      [doctorId],
    );
    if (!row) throw notListed();
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(q: DoctorQueryDto, now = new Date()) {
    const params = new SqlParams();
    const where = [LISTED_DOCTOR_SQL];
    const kind = q.kind ? params.add(q.kind) : null;
    const kindOnLoc = kind
      ? `AND l.kind = ${kind}::practice_location_kind`
      : '';

    if (q.q) {
      const [specialties, conditions] = await Promise.all([
        this.reference.matchSpecialties(q.q, 5),
        this.reference.matchConditions(q.q, 5),
      ]);
      const text = params.add(q.q);
      const sids = params.add(specialties.map((s: { id: string }) => s.id));
      const cids = params.add(conditions.map((c: { id: string }) => c.id));
      where.push(`(
        d.search @@ (websearch_to_tsquery('english', ${text}) || websearch_to_tsquery('simple', ${text}))
        OR d.primary_specialty_id = ANY(${sids}::uuid[])
        OR EXISTS (SELECT 1 FROM doctor_specialties x WHERE x.doctor_id = d.id AND x.specialty_id = ANY(${sids}::uuid[]))
        OR EXISTS (SELECT 1 FROM doctor_conditions x WHERE x.doctor_id = d.id AND x.condition_id = ANY(${cids}::uuid[]))
        OR word_similarity(${text}, d.full_name) >= ${TRIGRAM_MIN}
      )`);
    }
    if (q.specialtyId) {
      const s = params.add(q.specialtyId);
      where.push(
        `(d.primary_specialty_id = ${s} OR EXISTS (SELECT 1 FROM doctor_specialties x WHERE x.doctor_id = d.id AND x.specialty_id = ${s}))`,
      );
    }
    if (q.conditionId) {
      const c = params.add(q.conditionId);
      where.push(`(EXISTS (SELECT 1 FROM doctor_conditions x WHERE x.doctor_id = d.id AND x.condition_id = ${c})
        OR d.primary_specialty_id IN (SELECT specialty_id FROM condition_specialties WHERE condition_id = ${c}))`);
    }
    if (kind)
      where.push(
        `EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active ${kindOnLoc})`,
      );
    if (q.city && q.kind !== 'video') {
      where.push(
        `EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND l.kind = 'clinic' AND lower(l.city) = lower(${params.add(q.city)}))`,
      );
    }
    if (q.area) {
      where.push(
        `EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND l.area ILIKE ${params.add(`%${likeEscape(q.area)}%`)})`,
      );
    }
    if (q.availableToday === 'true') {
      where.push(
        `(na.next_at AT TIME ZONE na.timezone)::date = (now() AT TIME ZONE na.timezone)::date`,
      );
    }
    if (q.gender) where.push(`d.gender = ${params.add(q.gender)}`);
    if (q.minFee !== undefined)
      where.push(`fee.min_fee >= ${params.add(q.minFee)}`);
    if (q.maxFee !== undefined)
      where.push(`fee.min_fee <= ${params.add(q.maxFee)}`);
    if (q.minExperience !== undefined) {
      where.push(
        `d.practicing_since <= ${params.add(now.getUTCFullYear() - q.minExperience)}`,
      );
    }
    if (q.minRating !== undefined)
      where.push(`d.rating_avg >= ${params.add(q.minRating)}`);
    if (q.language) {
      where.push(
        `EXISTS (SELECT 1 FROM unnest(d.languages) lang WHERE lower(lang) = lower(${params.add(q.language)}))`,
      );
    }

    const geo = q.lat !== undefined && q.lng !== undefined;
    const distanceSql = geo
      ? `(SELECT min(6371 * 2 * asin(sqrt(
            power(sin(radians(l.lat - ${params.add(q.lat)}) / 2), 2)
            + cos(radians(${params.add(q.lat)})) * cos(radians(l.lat)) * power(sin(radians(l.lng - ${params.add(q.lng)}) / 2), 2))))
           FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND l.kind = 'clinic' AND l.lat IS NOT NULL)`
      : 'NULL::float';

    const from = `
      ${DOCTOR_FROM_SQL}
      LEFT JOIN specialties sp ON sp.id = d.primary_specialty_id
      LEFT JOIN LATERAL (
        SELECT l.next_available_at AS next_at, l.kind AS next_kind, l.timezone
          FROM practice_locations l
         WHERE l.doctor_id = d.id AND l.is_active AND l.next_available_at IS NOT NULL ${kindOnLoc}
         ORDER BY l.next_available_at LIMIT 1
      ) na ON true
      LEFT JOIN LATERAL (
        SELECT min(l.fee) AS min_fee FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active ${kindOnLoc}
      ) fee ON true
      WHERE ${where.join(' AND ')}`;

    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total ${from}`,
      params.values,
    );

    const sort = q.sort ?? 'recommended';
    // Ordering runs on the derived columns of the inner select (alias x).
    const recommended = `(
        (rating_avg / 5.0) * 0.40
      + least(ln(1 + rating_count) / ln(51), 1) * 0.25
      + CASE WHEN next_at IS NULL THEN 0
             WHEN next_at < now() + interval '24 hours' THEN 0.25
             WHEN next_at < now() + interval '72 hours' THEN 0.15 ELSE 0.05 END
      + CASE WHEN is_top_booked THEN 0.10 ELSE 0 END
      ${geo ? '- least(coalesce(distance, 50) / 25.0, 1) * 0.30' : ''}
    )`;
    const ORDER: Record<string, string> = {
      recommended: `${recommended} DESC`,
      earliest: 'next_at ASC NULLS LAST',
      fee_asc: 'min_fee ASC NULLS LAST',
      fee_desc: 'min_fee DESC NULLS LAST',
      reviews: 'rating_count DESC, rating_avg DESC',
      experience: 'practicing_since ASC NULLS LAST',
    };
    const rows = await this.dataSource.query(
      `SELECT * FROM (
         SELECT d.id, d.title, d.full_name, d.photo_url, d.gender, d.practicing_since, d.rating_avg, d.rating_count,
                d.satisfaction_pct, d.avg_wait_minutes, d.pmdc_verified_at, d.is_top_booked,
                sp.id AS sp_id, sp.name AS sp_name, sp.name_ur AS sp_name_ur, sp.slug AS sp_slug,
                (SELECT string_agg(q.degree, ', ' ORDER BY q.sort) FROM doctor_qualifications q WHERE q.doctor_id = d.id) AS qualifications,
                EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND l.kind = 'video') AS offers_video,
                fee.min_fee, na.next_at, na.next_kind, na.timezone AS next_tz,
                ${distanceSql} AS distance
           ${from}
       ) x
       ORDER BY ${ORDER[sort]}, id
       LIMIT ${params.add(q.pageSize)} OFFSET ${params.add((q.page - 1) * q.pageSize)}`,
      params.values,
    );
    return paged(
      rows.map((r: any) => this.card(r, now)),
      total,
      q,
    );
  }

  card(r: any, now = new Date()) {
    return {
      id: r.id,
      title: r.title,
      fullName: r.full_name,
      displayName: `${TITLE_PREFIX[r.title] ?? 'Dr.'} ${r.full_name}`,
      photoUrl: r.photo_url,
      gender: r.gender,
      specialty: r.sp_id
        ? {
            id: r.sp_id,
            name: r.sp_name,
            nameUr: r.sp_name_ur,
            slug: r.sp_slug,
          }
        : null,
      qualifications: r.qualifications ?? '',
      yearsExperience: r.practicing_since
        ? yearsSince(r.practicing_since, now)
        : null,
      ratingAvg: parseFloat(r.rating_avg),
      ratingCount: r.rating_count,
      satisfactionPct: r.satisfaction_pct,
      avgWaitMinutes: r.avg_wait_minutes,
      pmdcVerified: !!r.pmdc_verified_at,
      isTopBooked: r.is_top_booked,
      minFee: r.min_fee,
      offersVideo: r.offers_video,
      nextAvailable: r.next_at
        ? {
            at: toZonedIso(r.next_at, r.next_tz),
            locationKind: r.next_kind,
            label: availabilityLabel(r.next_at, r.next_tz, now),
          }
        : null,
      ...(r.distance !== null && r.distance !== undefined
        ? { distanceKm: Math.round(r.distance * 10) / 10 }
        : {}),
    };
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  async profile(doctorId: string, now = new Date()) {
    const page = await this.cardById(doctorId, now);
    const [d] = await this.dataSource.query(
      `SELECT d.about, d.languages, d.avg_consult_minutes, d.patients_served, d.booking_window_days, d.cancel_cutoff_minutes,
              d.video_prepay_required, d.is_accepting, d.pmdc_number
         FROM doctors d WHERE d.id = $1`,
      [doctorId],
    );
    const [
      secondary,
      conditions,
      services,
      qualifications,
      experiences,
      locations,
      schedules,
      summary,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT s.id, s.name, s.name_ur, s.slug, s.icon, s.description FROM doctor_specialties x JOIN specialties s ON s.id = x.specialty_id
          WHERE x.doctor_id = $1 ORDER BY s.name`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT c.id, c.name, c.name_ur, c.slug FROM doctor_conditions x JOIN conditions c ON c.id = x.condition_id
          WHERE x.doctor_id = $1 ORDER BY c.name`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT name FROM doctor_services WHERE doctor_id = $1 ORDER BY sort`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT degree, institute, year FROM doctor_qualifications WHERE doctor_id = $1 ORDER BY sort`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT designation, institute, from_year, to_year FROM doctor_experiences WHERE doctor_id = $1 ORDER BY sort`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT id, kind, name, address_line, area, city, lat, lng, phone, timezone, fee, slot_minutes, instructions, next_available_at
           FROM practice_locations WHERE doctor_id = $1 AND is_active ORDER BY kind, fee, created_at`,
        [doctorId],
      ),
      this.dataSource.query(
        `SELECT w.location_id, w.weekday, w.start_time::text, w.end_time::text FROM weekly_schedules w
           JOIN practice_locations l ON l.id = w.location_id WHERE l.doctor_id = $1 AND l.is_active
          ORDER BY w.weekday, w.start_time`,
        [doctorId],
      ),
      this.reviewSummary(doctorId),
    ]);
    return {
      ...page,
      about: d.about,
      languages: d.languages,
      pmdcNumber: d.pmdc_number,
      badges: { pmdcVerified: page.pmdcVerified, topBooked: page.isTopBooked },
      stats: {
        ratingAvg: page.ratingAvg,
        ratingCount: page.ratingCount,
        satisfactionPct: page.satisfactionPct,
        avgWaitMinutes: page.avgWaitMinutes,
        avgConsultMinutes: d.avg_consult_minutes,
        patientsServed: d.patients_served,
        yearsExperience: page.yearsExperience,
      },
      booking: {
        isAccepting: d.is_accepting,
        bookingWindowDays: d.booking_window_days,
        cancelCutoffMinutes: d.cancel_cutoff_minutes,
        videoPrepayRequired: d.video_prepay_required,
      },
      secondarySpecialties: secondary.map(specialtyView),
      conditions: conditions.map((c: any) => ({
        id: c.id,
        name: c.name,
        nameUr: c.name_ur,
        slug: c.slug,
      })),
      services: services.map((s: any) => s.name),
      qualificationList: qualifications.map((q: any) => ({
        degree: q.degree,
        institute: q.institute,
        year: q.year,
      })),
      experiences: experiences.map((e: any) => ({
        designation: e.designation,
        institute: e.institute,
        fromYear: e.from_year,
        toYear: e.to_year,
      })),
      locations: locations.map((l: any) => {
        const mine = schedules.filter((s: any) => s.location_id === l.id);
        const byDay = [0, 1, 2, 3, 4, 5, 6]
          .map((wd) => ({
            weekday: wd,
            weekdayLabel: weekdayLabel(wd),
            ranges: mine
              .filter((s: any) => s.weekday === wd)
              .map((s: any) => {
                const a = parseTime(s.start_time);
                const b = parseTime(s.end_time);
                return {
                  start: formatMinutes(a),
                  end: formatMinutes(b),
                  label: `${to12h(a)} – ${to12h(b)}`,
                };
              }),
          }))
          .filter((x) => x.ranges.length);
        return {
          id: l.id,
          kind: l.kind,
          name: l.name,
          addressLine: l.address_line,
          area: l.area,
          city: l.city,
          lat: l.lat === null ? null : parseFloat(l.lat),
          lng: l.lng === null ? null : parseFloat(l.lng),
          phone: l.phone,
          timezone: l.timezone,
          fee: l.fee,
          slotMinutes: l.slot_minutes,
          instructions: l.instructions,
          nextAvailable: l.next_available_at
            ? {
                at: toZonedIso(l.next_available_at, l.timezone),
                label: availabilityLabel(l.next_available_at, l.timezone, now),
              }
            : null,
          timings: byDay,
        };
      }),
      reviewSummary: summary,
    };
  }

  private async cardById(doctorId: string, now: Date) {
    const params = new SqlParams();
    const rows = await this.dataSource.query(
      `SELECT d.id, d.title, d.full_name, d.photo_url, d.gender, d.practicing_since, d.rating_avg, d.rating_count,
              d.satisfaction_pct, d.avg_wait_minutes, d.pmdc_verified_at, d.is_top_booked,
              sp.id AS sp_id, sp.name AS sp_name, sp.name_ur AS sp_name_ur, sp.slug AS sp_slug,
              (SELECT string_agg(q.degree, ', ' ORDER BY q.sort) FROM doctor_qualifications q WHERE q.doctor_id = d.id) AS qualifications,
              EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND l.kind = 'video') AS offers_video,
              (SELECT min(l.fee) FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active) AS min_fee,
              na.next_at, na.next_kind, na.timezone AS next_tz, NULL AS distance
         ${DOCTOR_FROM_SQL}
         LEFT JOIN specialties sp ON sp.id = d.primary_specialty_id
         LEFT JOIN LATERAL (
           SELECT l.next_available_at AS next_at, l.kind AS next_kind, l.timezone FROM practice_locations l
            WHERE l.doctor_id = d.id AND l.is_active AND l.next_available_at IS NOT NULL
            ORDER BY l.next_available_at LIMIT 1
         ) na ON true
        WHERE d.id = ${params.add(doctorId)} AND ${LISTED_DOCTOR_SQL}`,
      params.values,
    );
    if (!rows.length) throw notListed();
    return this.card(rows[0], now);
  }

  /** Same specialty, sharing a clinic city when possible; best-reviewed first. */
  async similar(doctorId: string, now = new Date()) {
    const me = await this.cardById(doctorId, now);
    if (!me.specialty) return [];
    const cities: Array<{ city: string }> = await this.dataSource.query(
      `SELECT DISTINCT lower(city) AS city FROM practice_locations WHERE doctor_id = $1 AND is_active AND city IS NOT NULL`,
      [doctorId],
    );
    const params = new SqlParams();
    const rows = await this.dataSource.query(
      `SELECT d.id, d.title, d.full_name, d.photo_url, d.gender, d.practicing_since, d.rating_avg, d.rating_count,
              d.satisfaction_pct, d.avg_wait_minutes, d.pmdc_verified_at, d.is_top_booked,
              sp.id AS sp_id, sp.name AS sp_name, sp.name_ur AS sp_name_ur, sp.slug AS sp_slug,
              (SELECT string_agg(q.degree, ', ' ORDER BY q.sort) FROM doctor_qualifications q WHERE q.doctor_id = d.id) AS qualifications,
              EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND l.kind = 'video') AS offers_video,
              (SELECT min(l.fee) FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active) AS min_fee,
              na.next_at, na.next_kind, na.timezone AS next_tz, NULL AS distance,
              EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND lower(l.city) = ANY(${params.add(cities.map((c) => c.city))})) AS same_city
         ${DOCTOR_FROM_SQL}
         JOIN specialties sp ON sp.id = d.primary_specialty_id
         LEFT JOIN LATERAL (
           SELECT l.next_available_at AS next_at, l.kind AS next_kind, l.timezone FROM practice_locations l
            WHERE l.doctor_id = d.id AND l.is_active AND l.next_available_at IS NOT NULL ORDER BY l.next_available_at LIMIT 1
         ) na ON true
        WHERE ${LISTED_DOCTOR_SQL} AND d.primary_specialty_id = ${params.add(me.specialty.id)} AND d.id <> ${params.add(doctorId)}
        ORDER BY same_city DESC, d.rating_count DESC, d.rating_avg DESC, d.id
        LIMIT 10`,
      params.values,
    );
    return rows.map((r: any) => this.card(r, now));
  }

  async slots(
    doctorId: string,
    locationId: string,
    from: string | undefined,
    days: number,
  ) {
    await this.assertListed(doctorId);
    return this.availability.slots(doctorId, locationId, from, days);
  }

  // ── Home and specialties ─────────────────────────────────────────────────

  async specialties(city?: string) {
    const params = new SqlParams();
    const cityFilter = city
      ? `AND EXISTS (SELECT 1 FROM practice_locations l WHERE l.doctor_id = d.id AND l.is_active AND l.kind = 'clinic' AND lower(l.city) = lower(${params.add(city)}))`
      : '';
    const rows = await this.dataSource.query(
      `SELECT s.id, s.name, s.name_ur, s.slug, s.icon, s.description,
              (SELECT count(*)::int ${DOCTOR_FROM_SQL}
                WHERE ${LISTED_DOCTOR_SQL} ${cityFilter}
                  AND (d.primary_specialty_id = s.id OR EXISTS (SELECT 1 FROM doctor_specialties x WHERE x.doctor_id = d.id AND x.specialty_id = s.id))
              ) AS doctor_count
         FROM specialties s WHERE s.is_active ORDER BY s.sort, s.name`,
      params.values,
    );
    return rows.map((r: any) => ({
      ...specialtyView(r),
      doctorCount: r.doctor_count,
    }));
  }

  async home(
    city: string | undefined,
    userId: string | undefined,
    now = new Date(),
  ) {
    const [ranking, all, common, featured, nearby, upcoming] =
      await Promise.all([
        this.specialtyRanking(12),
        this.reference.specialties(),
        this.reference.conditions({ common: 'true' }),
        this.list(
          { page: 1, pageSize: 10, sort: 'recommended' } as DoctorQueryDto,
          now,
        ),
        city
          ? this.list(
              {
                page: 1,
                pageSize: 10,
                city,
                availableToday: 'true',
                sort: 'earliest',
              } as DoctorQueryDto,
              now,
            )
          : null,
        userId ? this.upcomingFor(userId) : null,
      ]);
    const rank = new Map(ranking.map((id, i) => [id, i]));
    const specialties = [...all]
      .sort((a: any, b: any) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))
      .slice(0, 12);
    return {
      specialties,
      commonConditions: common,
      availableTodayNearby: nearby ? nearby.items : [],
      upcomingAppointment: upcoming,
      featuredDoctors: featured.items,
    };
  }
}
