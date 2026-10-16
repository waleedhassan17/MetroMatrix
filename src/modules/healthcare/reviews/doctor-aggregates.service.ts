import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { HealthJobsService } from '../jobs/health-jobs.service';
import { DOCTOR_FROM_SQL, LISTED_DOCTOR_SQL } from '../discovery/listing-sql';

/** Wait, consult and satisfaction are shown only with at least this many samples. */
export const MIN_SAMPLES = 5;
/** Wait and consult times are measured over completed visits this recent. */
export const TIMING_WINDOW_DAYS = 90;
/** Top-booked = the busiest 10% (by visits completed in 30 days) in a specialty and city. */
export const TOP_BOOKED_SHARE = 0.1;

/**
 * Derived numbers on the doctor row: rating and satisfaction (visible
 * reviews), measured wait and consult minutes, patients served, visits in
 * the last 30 days, top-booked. A full recompute from source rows — so it is
 * idempotent, and a second run changes nothing (only rows whose numbers
 * differ are written).
 */
@Injectable()
export class DoctorAggregatesService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: HealthJobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.nightly.push(async (m, now) => ({
      doctorAggregates: await this.refresh(m, null, now),
      topBooked: await this.refreshTopBooked(m),
    }));
  }

  /** Recompute for these doctors (null = all). Returns how many rows changed. */
  async refresh(
    m: EntityManager | null,
    doctorIds: string[] | null,
    now = new Date(),
  ): Promise<number> {
    const q = m ?? this.dataSource.manager;
    const [, changed] = await q.query(
      `WITH target AS (
         SELECT id FROM doctors WHERE $1::uuid[] IS NULL OR id = ANY($1::uuid[])
       ), r AS (
         SELECT doctor_id, count(*)::int AS n, round(avg(overall)::numeric, 2) AS avg,
                round(100.0 * avg(recommend::int))::int AS pct
           FROM doctor_reviews WHERE hidden_at IS NULL AND doctor_id IN (SELECT id FROM target)
          GROUP BY 1
       ), v AS (
         SELECT doctor_id,
                count(*) FILTER (WHERE started_at IS NOT NULL AND (kind = 'video' OR checked_in_at IS NOT NULL)) AS wait_n,
                -- clinic: from arrival or the booked time, whichever is later; video: from the booked time.
                avg(greatest(0, extract(epoch FROM started_at - CASE WHEN kind = 'clinic' THEN greatest(checked_in_at, starts_at) ELSE starts_at END) / 60))
                  FILTER (WHERE started_at IS NOT NULL AND (kind = 'video' OR checked_in_at IS NOT NULL)) AS wait,
                count(*) FILTER (WHERE started_at IS NOT NULL) AS consult_n,
                avg(greatest(0, extract(epoch FROM completed_at - started_at) / 60))
                  FILTER (WHERE started_at IS NOT NULL) AS consult
           FROM appointments
          WHERE status = 'completed' AND completed_at > $2::timestamptz - make_interval(days => $3)
            AND doctor_id IN (SELECT id FROM target)
          GROUP BY 1
       ), p AS (
         SELECT doctor_id, count(DISTINCT coalesce(family_member_id, patient_user_id))::int AS served,
                count(*) FILTER (WHERE completed_at > $2::timestamptz - interval '30 days')::int AS c30
           FROM appointments WHERE status = 'completed' AND doctor_id IN (SELECT id FROM target)
          GROUP BY 1
       ), n AS (
         SELECT t.id,
                coalesce(r.n, 0) AS rating_count,
                coalesce(r.avg, 0) AS rating_avg,
                CASE WHEN r.n >= $4 THEN r.pct END::smallint AS satisfaction_pct,
                CASE WHEN v.wait_n >= $4 THEN round(v.wait) END::smallint AS avg_wait_minutes,
                CASE WHEN v.consult_n >= $4 THEN round(v.consult) END::smallint AS avg_consult_minutes,
                coalesce(p.served, 0) AS patients_served,
                coalesce(p.c30, 0) AS completed_30d
           FROM target t
           LEFT JOIN r ON r.doctor_id = t.id
           LEFT JOIN v ON v.doctor_id = t.id
           LEFT JOIN p ON p.doctor_id = t.id
       )
       UPDATE doctors d SET
              rating_count = n.rating_count, rating_avg = n.rating_avg,
              satisfaction_pct = n.satisfaction_pct,
              avg_wait_minutes = n.avg_wait_minutes, avg_consult_minutes = n.avg_consult_minutes,
              patients_served = n.patients_served, completed_30d = n.completed_30d
         FROM n
        WHERE d.id = n.id
          AND (d.rating_count, d.rating_avg, d.satisfaction_pct, d.avg_wait_minutes,
               d.avg_consult_minutes, d.patients_served, d.completed_30d)
              IS DISTINCT FROM
              (n.rating_count, n.rating_avg, n.satisfaction_pct, n.avg_wait_minutes,
               n.avg_consult_minutes, n.patients_served, n.completed_30d)`,
      [doctorIds, now, TIMING_WINDOW_DAYS, MIN_SAMPLES],
    );
    return changed ?? 0;
  }

  /** Flags the busiest 10% (at least one) per specialty and clinic city. */
  async refreshTopBooked(m: EntityManager | null): Promise<number> {
    const q = m ?? this.dataSource.manager;
    const [, changed] = await q.query(
      `WITH g AS (
         SELECT DISTINCT d.id, d.primary_specialty_id AS sp, lower(l.city) AS city, d.completed_30d AS c
           ${DOCTOR_FROM_SQL}
           JOIN practice_locations l ON l.doctor_id = d.id AND l.is_active AND l.kind = 'clinic' AND l.city IS NOT NULL
          WHERE ${LISTED_DOCTOR_SQL} AND d.primary_specialty_id IS NOT NULL
       ), ranked AS (
         SELECT id, c, row_number() OVER (PARTITION BY sp, city ORDER BY c DESC, id) AS rn,
                count(*) OVER (PARTITION BY sp, city) AS n
           FROM g
       ), top AS (
         SELECT DISTINCT id FROM ranked WHERE c > 0 AND rn <= ceil(n * $1::numeric)
       )
       UPDATE doctors d SET is_top_booked = (d.id IN (SELECT id FROM top))
        WHERE d.is_top_booked IS DISTINCT FROM (d.id IN (SELECT id FROM top))`,
      [TOP_BOOKED_SHARE],
    );
    return changed ?? 0;
  }
}
