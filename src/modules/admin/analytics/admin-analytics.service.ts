import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { NotificationsService } from '../../notifications/notifications.service';
import { AiSettings } from '../../ai/ai-settings';
import { ErrorCode } from '../../../common/errors/codes';
import {
  Interval,
  OverviewPeriod,
  OverviewView,
  TimeseriesMetric,
  TimeseriesView,
} from './admin-analytics.dto';

const DAYS: Record<OverviewPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };
/** The longest range per granularity: a year of days, ~3 of weeks, 10 of months. */
const MAX_BUCKETS: Record<Interval, number> = {
  day: 366,
  week: 160,
  month: 120,
};
const STEP: Record<Interval, number> = { day: 1, week: 7, month: 31 };

/**
 * One SQL source per metric: the table, its timestamp, the value (count or a
 * rupee sum) and the rows that count. Only real tables — no invented numbers.
 */
const METRICS: Record<
  TimeseriesMetric,
  { table: string; at: string; value: string; where: string }
> = {
  signups: {
    table: 'users',
    at: 'created_at',
    value: 'count(*)',
    where: `role IN ('customer', 'partner')`,
  },
  businesses_submitted: {
    table: 'businesses',
    at: 'submitted_at',
    value: 'count(*)',
    where: 'submitted_at IS NOT NULL',
  },
  shopping_orders: {
    table: 'store_orders',
    at: 'created_at',
    value: 'count(*)',
    where: 'true',
  },
  shopping_value: {
    table: 'store_orders',
    at: 'created_at',
    value: 'coalesce(sum(total), 0)',
    where: `status <> 'cancelled'`,
  },
  health_appointments: {
    table: 'appointments',
    at: 'created_at',
    value: 'count(*)',
    where: 'true',
  },
  food_orders: {
    table: 'food_orders',
    at: 'created_at',
    value: 'count(*)',
    where: 'true',
  },
  food_value: {
    table: 'food_orders',
    at: 'created_at',
    value: 'coalesce(sum(total), 0)',
    where: `status NOT IN ('rejected', 'auto_rejected', 'cancelled')`,
  },
};

@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly ai: AiSettings,
    private readonly config: ConfigService,
  ) {}

  async overview(period: OverviewPeriod): Promise<OverviewView> {
    const since = new Date(Date.now() - DAYS[period] * 86_400_000);
    const q = <T>(sql: string, params: unknown[] = []) =>
      this.dataSource.query(sql, params) as Promise<T[]>;

    // Sequential, not Promise.all: one pooled connection, no overlap.
    const usersByRole = await q<{ key: string; count: number }>(
      `SELECT role::text AS key, count(*)::int AS count FROM users
        WHERE status <> 'deleted' GROUP BY role ORDER BY role`,
    );
    const [signups] = await q<{
      last7d: number;
      last30d: number;
      last90d: number;
    }>(
      `SELECT count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int  AS "last7d",
              count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS "last30d",
              count(*)::int AS "last90d"
         FROM users
        WHERE role IN ('customer', 'partner') AND created_at >= now() - interval '90 days'`,
    );
    const businesses = await q<{
      serviceType: string;
      status: string;
      count: number;
    }>(
      `SELECT service_type::text AS "serviceType", status::text AS status, count(*)::int AS count
         FROM businesses GROUP BY service_type, status ORDER BY service_type, status`,
    );
    const pendingApprovals = businesses
      .filter((b) => b.status === 'pending_approval')
      .reduce((n, b) => n + b.count, 0);
    const activity = async (sql: string) =>
      (
        await q<{ count: number; cancelled: number; value: string | number }>(
          sql,
          [since],
        )
      ).map((r) => ({
        count: r.count,
        cancelled: r.cancelled,
        value: Number(r.value),
      }))[0];
    const shopping = await activity(
      `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              coalesce(sum(total) FILTER (WHERE status <> 'cancelled'), 0) AS value
         FROM store_orders WHERE created_at >= $1`,
    );
    const healthcare = await activity(
      `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE status IN ('cancelled', 'no_show'))::int AS cancelled,
              coalesce(sum(fee) FILTER (WHERE status = 'completed'), 0) AS value
         FROM appointments WHERE created_at >= $1`,
    );
    const food = await activity(
      `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE status IN ('rejected', 'auto_rejected', 'cancelled'))::int AS cancelled,
              coalesce(sum(total) FILTER (WHERE status NOT IN ('rejected', 'auto_rejected', 'cancelled')), 0) AS value
         FROM food_orders WHERE created_at >= $1`,
    );

    return {
      period,
      since,
      usersByRole,
      signups,
      businesses,
      pendingApprovals,
      activity: { shopping, healthcare, food },
      integrations: {
        mailConfigured: !!this.config.get<string>('mail.host'),
        pushEnabled: this.notifications.pushEnabled,
        aiEnabled: this.ai.enabled && this.ai.platformAllows(),
      },
    };
  }

  async timeseries(
    metric: TimeseriesMetric,
    fromIso: string,
    toIso: string,
    interval: Interval,
  ): Promise<TimeseriesView> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (!(days > 0) || days / STEP[interval] > MAX_BUCKETS[interval]) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Pick a range after 'from' of at most ${MAX_BUCKETS[interval]} ${interval}s.`,
        details: { fields: { to: ['range out of bounds for this interval'] } },
      });
    }
    const m = METRICS[metric];
    // Buckets in UTC; every bucket appears, empty ones as 0. Identifiers come
    // from the fixed METRICS map, values are bound parameters.
    const rows = (await this.dataSource.query(
      `WITH buckets AS (
         SELECT generate_series(
                  date_trunc($3::text, $1::timestamptz AT TIME ZONE 'UTC'),
                  date_trunc($3::text, ($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC'),
                  ('1 ' || $3::text)::interval
                ) AS bucket
       ), agg AS (
         SELECT date_trunc($3::text, ${m.at} AT TIME ZONE 'UTC') AS bucket, ${m.value} AS value
           FROM ${m.table}
          WHERE ${m.where} AND ${m.at} >= $1 AND ${m.at} < $2
          GROUP BY 1
       )
       SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
              coalesce(a.value, 0)::bigint AS value
         FROM buckets b LEFT JOIN agg a ON a.bucket = b.bucket
        ORDER BY b.bucket`,
      [from, to, interval],
    )) as Array<{ bucket: string; value: string }>;
    return {
      metric,
      interval,
      from: from.toISOString(),
      to: to.toISOString(),
      points: rows.map((r) => ({ bucket: r.bucket, value: Number(r.value) })),
    };
  }
}
