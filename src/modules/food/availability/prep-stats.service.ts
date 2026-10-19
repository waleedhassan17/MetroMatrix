import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/** Days of accepted → ready history the smart ETA learns from. */
export const PREP_STATS_DAYS = 30;

/**
 * Smart ETA (Chunk 5): recompute each kitchen's real prep times — accepted
 * → ready over the last 30 days, p50 and p75 per local hour of acceptance
 * and order size (1-2, 3-5, 6+ items). Quotes switch to p75 once a bucket
 * has 20 samples. A full recompute; buckets without orders are removed.
 */
@Injectable()
export class PrepStatsService {
  async recompute(
    m: EntityManager,
    now: Date,
    branchId?: string,
  ): Promise<{ buckets: number }> {
    const rows = await m.query(
      `WITH o AS (
         SELECT fo.branch_id,
                extract(hour FROM fo.accepted_at AT TIME ZONE br.timezone)::int AS hour_bucket,
                CASE WHEN n.items <= 2 THEN '1-2' WHEN n.items <= 5 THEN '3-5' ELSE '6+' END AS size_bucket,
                extract(epoch FROM fo.ready_at - fo.accepted_at) / 60.0 AS minutes
           FROM food_orders fo
           JOIN branches br ON br.id = fo.branch_id
           JOIN LATERAL (SELECT coalesce(sum(quantity), 0)::int AS items FROM food_order_items WHERE order_id = fo.id) n ON true
          WHERE fo.accepted_at IS NOT NULL AND fo.ready_at IS NOT NULL AND fo.ready_at > fo.accepted_at
            AND fo.accepted_at >= $1::timestamptz - make_interval(days => $2)
            ${branchId ? 'AND fo.branch_id = $3' : ''}
       )
       SELECT branch_id, hour_bucket, size_bucket,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::int AS p50,
              round(percentile_cont(0.75) WITHIN GROUP (ORDER BY minutes))::int AS p75,
              count(*)::int AS samples
         FROM o GROUP BY 1, 2, 3`,
      branchId ? [now, PREP_STATS_DAYS, branchId] : [now, PREP_STATS_DAYS],
    );
    await m.query(
      `DELETE FROM prep_time_stats ${branchId ? 'WHERE branch_id = $1' : ''}`,
      branchId ? [branchId] : [],
    );
    for (const r of rows)
      await m.query(
        `INSERT INTO prep_time_stats (branch_id, hour_bucket, size_bucket, p50_minutes, p75_minutes, samples)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          r.branch_id,
          r.hour_bucket,
          r.size_bucket,
          Math.max(1, r.p50),
          Math.max(1, r.p75),
          r.samples,
        ],
      );
    return { buckets: rows.length };
  }
}
