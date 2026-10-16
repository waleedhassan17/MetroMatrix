import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  addDays,
  DEFAULT_TZ,
  localDayBounds,
  todayIn,
} from '../common/time.util';

export const INSIGHT_RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type InsightRange = keyof typeof INSIGHT_RANGES;

export interface RatingPoint {
  date: string;
  reviews: number;
  average: number;
}

const rate = (n: number, of: number) =>
  of > 0 ? Math.round((n / of) * 1000) / 1000 : null;

/**
 * The doctor's practice at a glance, over the last 7/30/90 local days
 * (Asia/Karachi). Fees are what the doctor recorded as received — MetroMatrix
 * never holds the money.
 */
@Injectable()
export class DoctorInsightsService {
  /** Filled in by reviews (P5): daily rating points in the range. */
  ratingTrend: (
    doctorId: string,
    from: Date,
    to: Date,
    tz: string,
  ) => Promise<RatingPoint[]> = async () => [];

  constructor(private readonly dataSource: DataSource) {}

  async insights(
    doctorId: string,
    range: InsightRange = '30d',
    now = new Date(),
  ) {
    const days = INSIGHT_RANGES[range];
    const tz = DEFAULT_TZ;
    const lastDay = todayIn(tz, now);
    const firstDay = addDays(lastDay, -(days - 1));
    const from = localDayBounds(firstDay, tz).start;
    const to = localDayBounds(lastDay, tz).end;
    const args = [doctorId, from, to, tz];
    const inRange = `a.doctor_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3`;

    const [perDay, [t], [times], [people], fees, ratingTrend] =
      await Promise.all([
        this.dataSource.query(
          `SELECT to_char((a.starts_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day, a.kind, count(*)::int AS n
           FROM appointments a WHERE ${inRange} AND a.status <> 'cancelled' GROUP BY 1, 2`,
          args,
        ),
        this.dataSource.query(
          `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
                count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
                count(*) FILTER (WHERE a.status = 'cancelled' AND a.late_cancel)::int AS late_cancelled,
                count(*) FILTER (WHERE a.status = 'cancelled' AND a.cancelled_by = 'doctor')::int AS cancelled_by_doctor,
                count(*) FILTER (WHERE a.status = 'no_show')::int AS no_show,
                count(*) FILTER (WHERE a.status IN ('booked', 'checked_in', 'in_consultation'))::int AS upcoming
           FROM appointments a WHERE ${inRange}`,
          args.slice(0, 3),
        ),
        this.dataSource.query(
          `SELECT round(avg(extract(epoch FROM a.started_at - greatest(a.checked_in_at, a.starts_at)) / 60)
                  FILTER (WHERE a.kind = 'clinic' AND a.checked_in_at IS NOT NULL AND a.started_at IS NOT NULL))::int AS wait,
                count(*) FILTER (WHERE a.kind = 'clinic' AND a.checked_in_at IS NOT NULL AND a.started_at IS NOT NULL)::int AS wait_n,
                round(avg(extract(epoch FROM a.completed_at - a.started_at) / 60)
                  FILTER (WHERE a.started_at IS NOT NULL AND a.completed_at IS NOT NULL))::int AS consult,
                count(*) FILTER (WHERE a.started_at IS NOT NULL AND a.completed_at IS NOT NULL)::int AS consult_n
           FROM appointments a WHERE ${inRange} AND a.status = 'completed'`,
          args.slice(0, 3),
        ),
        this.dataSource.query(
          `WITH seen AS (
           SELECT DISTINCT coalesce(a.family_member_id, a.patient_user_id) AS person
             FROM appointments a WHERE ${inRange} AND a.status = 'completed'
         ), first_visit AS (
           SELECT coalesce(a.family_member_id, a.patient_user_id) AS person, min(a.starts_at) AS first_at
             FROM appointments a WHERE a.doctor_id = $1 AND a.status = 'completed' GROUP BY 1
         )
         SELECT count(*) FILTER (WHERE f.first_at >= $2)::int AS new_patients,
                count(*) FILTER (WHERE f.first_at < $2)::int AS returning_patients
           FROM seen s JOIN first_visit f ON f.person = s.person`,
          args.slice(0, 3),
        ),
        this.dataSource.query(
          `SELECT a.payment_method AS method, a.payment_status AS status, count(*)::int AS n, coalesce(sum(a.fee), 0)::int AS amount
           FROM appointments a WHERE ${inRange} GROUP BY 1, 2`,
          args.slice(0, 3),
        ),
        this.ratingTrend(doctorId, from, to, tz),
      ]);

    const byDay = new Map<string, { clinic: number; video: number }>();
    for (let i = 0; i < days; i++)
      byDay.set(addDays(firstDay, i), { clinic: 0, video: 0 });
    perDay.forEach(
      (r: { day: string; kind: 'clinic' | 'video'; n: number }) => {
        const d = byDay.get(r.day);
        if (d) d[r.kind] = r.n;
      },
    );
    const finished = t.completed + t.cancelled + t.no_show;
    const sum = (pred: (f: any) => boolean) =>
      fees.filter(pred).reduce((s: number, f: any) => s + f.amount, 0);

    return {
      range,
      from: firstDay,
      to: lastDay,
      timezone: tz,
      perDay: [...byDay].map(([date, n]) => ({
        date,
        clinic: n.clinic,
        video: n.video,
        total: n.clinic + n.video,
      })),
      totals: {
        appointments: t.total,
        completed: t.completed,
        cancelled: t.cancelled,
        lateCancelled: t.late_cancelled,
        cancelledByDoctor: t.cancelled_by_doctor,
        noShow: t.no_show,
        upcoming: t.upcoming,
      },
      rates: {
        completion: rate(t.completed, finished),
        cancellation: rate(t.cancelled, finished),
        noShow: rate(t.no_show, finished),
      },
      times: {
        avgWaitMinutes: times.wait,
        waitSamples: times.wait_n,
        avgConsultMinutes: times.consult,
        consultSamples: times.consult_n,
      },
      patients: {
        new: people.new_patients,
        returning: people.returning_patients,
      },
      fees: {
        recorded: sum((f) => f.status === 'paid'),
        atClinic: sum(
          (f) => f.status === 'paid' && f.method === 'pay_at_clinic',
        ),
        byTransfer: sum((f) => f.status === 'paid' && f.method === 'transfer'),
        refundDue: sum((f) => f.status === 'refund_due'),
        refunded: sum((f) => f.status === 'refunded'),
      },
      ratingTrend,
    };
  }
}
