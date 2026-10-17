import { BadRequestException, Injectable } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { PlanService } from '../../plans/plans.service';
import { ErrorCode } from '../../../common/errors/codes';
import { addDays, todayIn } from '../../../common/time/time.util';
import type { VendorRef } from '../vendor/food-vendor.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class InsightsQueryDto {
  @ApiPropertyOptional({ enum: ['today', '7d', '30d'], default: '7d' })
  @IsOptional()
  @IsIn(['today', '7d', '30d'])
  range?: 'today' | '7d' | '30d';

  @ApiPropertyOptional({
    description: 'Local date YYYY-MM-DD (with `to`, instead of range).',
  })
  @IsOptional()
  @Matches(DATE, { message: 'from is YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ description: 'Local date YYYY-MM-DD, inclusive.' })
  @IsOptional()
  @Matches(DATE, { message: 'to is YYYY-MM-DD' })
  to?: string;
}

const DONE = `o.status IN ('delivered', 'picked_up')`;
const ANSWERED = `o.status IN ('accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'picked_up', 'rejected', 'auto_rejected') OR o.accepted_at IS NOT NULL`;

/**
 * The vendor's numbers for a range of local days. "Recorded sales" are the
 * totals of orders the vendor marked delivered or collected — money the
 * vendor received directly; MetroMatrix holds none of it.
 */
@Injectable()
export class FoodInsightsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
  ) {}

  async insights(v: VendorRef, q: InsightsQueryDto, now = new Date()) {
    await this.plans.assertEntitled(
      this.dataSource.manager,
      v.businessId,
      'insights',
    );
    const [b] = await this.dataSource.query(
      `SELECT timezone FROM branches WHERE id = $1`,
      [v.branchId],
    );
    const tz: string = b.timezone;
    const today = todayIn(tz, now);
    let from: string;
    let to: string;
    if (q.from || q.to) {
      if (!q.from || !q.to || q.from > q.to)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Give both from and to (from ≤ to).',
          details: { fields: { from: ['from ≤ to, both required'] } },
        });
      from = q.from;
      to = q.to;
      if (addDays(from, 92) < to)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'At most 92 days at a time.',
          details: { fields: { to: ['at most 92 days after from'] } },
        });
    } else {
      to = today;
      from =
        q.range === 'today'
          ? today
          : addDays(today, q.range === '30d' ? -29 : -6);
    }
    const p = [v.branchId, tz, from, to];
    const inRange = `o.branch_id = $1 AND (o.created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date`;

    const daily = await this.dataSource.query(
      `SELECT to_char((o.created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS date,
              count(*)::int AS orders,
              count(*) FILTER (WHERE ${DONE})::int AS completed,
              count(*) FILTER (WHERE o.status IN ('rejected', 'auto_rejected', 'cancelled'))::int AS cancelled,
              coalesce(sum(o.total) FILTER (WHERE ${DONE}), 0)::int AS recorded_sales
         FROM food_orders o WHERE ${inRange}
        GROUP BY 1 ORDER BY 1`,
      p,
    );
    const [k] = await this.dataSource.query(
      `SELECT count(*)::int AS orders,
              count(*) FILTER (WHERE ${DONE})::int AS completed,
              coalesce(sum(o.total) FILTER (WHERE ${DONE}), 0)::int AS recorded_sales,
              count(*) FILTER (WHERE ${ANSWERED})::int AS answered,
              count(*) FILTER (WHERE o.accepted_at IS NOT NULL)::int AS accepted,
              count(*) FILTER (WHERE o.status = 'auto_rejected')::int AS auto_rejected,
              round(avg(extract(epoch FROM o.accepted_at - o.created_at)))::int AS avg_accept_seconds,
              round(avg(extract(epoch FROM o.ready_at - o.accepted_at)) / 60.0, 1)::float AS avg_prep_minutes,
              count(*) FILTER (WHERE ${DONE} AND o.promised_at IS NOT NULL)::int AS promised,
              count(*) FILTER (WHERE ${DONE} AND o.promised_at IS NOT NULL
                                 AND coalesce(o.delivered_at, o.picked_up_at) <= o.promised_at)::int AS on_time,
              count(DISTINCT o.user_id)::int AS customers
         FROM food_orders o WHERE ${inRange}`,
      p,
    );
    const [repeat] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM (
         SELECT o.user_id FROM food_orders o WHERE ${inRange} GROUP BY o.user_id HAVING count(*) >= 2) x`,
      p,
    );
    const reasons = await this.dataSource.query(
      `SELECT o.status, coalesce(o.cancel_reason, 'No reason given') AS reason, count(*)::int AS n
         FROM food_orders o WHERE ${inRange} AND o.status IN ('rejected', 'auto_rejected', 'cancelled')
        GROUP BY 1, 2 ORDER BY n DESC, reason LIMIT 10`,
      p,
    );
    const items = await this.dataSource.query(
      `SELECT oi.item_name AS name, sum(oi.quantity)::int AS quantity, sum(oi.line_total)::int AS recorded_sales
         FROM food_order_items oi JOIN food_orders o ON o.id = oi.order_id
        WHERE ${inRange} AND ${DONE}
        GROUP BY oi.item_name ORDER BY quantity DESC, name LIMIT 5`,
      p,
    );
    const ratio = (a: number, b: number) =>
      b ? Math.round((a / b) * 1000) / 1000 : null;
    const byDate = new Map<string, any>(daily.map((d: any) => [d.date, d]));
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const row = byDate.get(d);
      days.push({
        date: d,
        orders: row?.orders ?? 0,
        completed: row?.completed ?? 0,
        cancelled: row?.cancelled ?? 0,
        recordedSales: row?.recorded_sales ?? 0,
      });
    }
    return {
      range: { from, to, timezone: tz },
      note: 'Recorded sales are the orders you marked delivered or collected. You received this money directly — MetroMatrix holds none of it.',
      totals: {
        orders: k.orders,
        completed: k.completed,
        recordedSales: k.recorded_sales,
        averageOrderValue: k.completed
          ? Math.floor(k.recorded_sales / k.completed)
          : null,
      },
      days,
      acceptanceRate: ratio(k.accepted, k.answered),
      autoRejected: k.auto_rejected,
      avgAcceptSeconds: k.avg_accept_seconds,
      avgPrepMinutes: k.avg_prep_minutes,
      onTimeRate: ratio(k.on_time, k.promised),
      cancelReasons: reasons.map((r: any) => ({
        status: r.status,
        reason: r.reason,
        count: r.n,
      })),
      topItems: items.map((i: any) => ({
        name: i.name,
        quantity: i.quantity,
        recordedSales: i.recorded_sales,
      })),
      repeatCustomers: {
        customers: k.customers,
        repeat: repeat.n,
        rate: ratio(repeat.n, k.customers),
      },
    };
  }
}
