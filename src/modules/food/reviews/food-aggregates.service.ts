import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Brand ratings and dish popularity, always a full recompute from the
 * source rows that writes only rows whose value changed — so running it
 * twice changes nothing the second time.
 */
@Injectable()
export class FoodAggregatesService {
  constructor(private readonly dataSource: DataSource) {}

  /** Visible reviews only. `brandId` null = every brand. Returns rows changed. */
  async ratings(
    m: EntityManager = this.dataSource.manager,
    brandId: string | null = null,
  ): Promise<number> {
    const [, n] = await m.query(
      `UPDATE food_brands fb
          SET rating_avg = x.avg, rating_count = x.n, updated_at = now()
         FROM (SELECT b.id,
                      coalesce(round(avg(r.food_rating)::numeric, 2), 0) AS avg,
                      count(r.id)::int AS n
                 FROM food_brands b
                 LEFT JOIN food_reviews r ON r.brand_id = b.id AND NOT r.is_hidden
                WHERE ($1::uuid IS NULL OR b.id = $1)
                GROUP BY b.id) x
        WHERE fb.id = x.id AND (fb.rating_avg, fb.rating_count) IS DISTINCT FROM (x.avg, x.n)`,
      [brandId],
    );
    return n ?? 0;
  }

  /** Portions sold per dish over the last 30 days (delivered or collected). */
  async sold30d(now = new Date()): Promise<number> {
    const [, n] = await this.dataSource.query(
      `UPDATE menu_items mi SET sold_30d = x.n, updated_at = now()
         FROM (SELECT i.id, coalesce(sum(oi.quantity) FILTER (WHERE o.id IS NOT NULL), 0)::int AS n
                 FROM menu_items i
                 LEFT JOIN food_order_items oi ON oi.item_id = i.id
                 LEFT JOIN food_orders o ON o.id = oi.order_id
                       AND o.status IN ('delivered', 'picked_up')
                       AND o.created_at > $1::timestamptz - interval '30 days'
                GROUP BY i.id) x
        WHERE mi.id = x.id AND mi.sold_30d <> x.n`,
      [now],
    );
    return n ?? 0;
  }
}
