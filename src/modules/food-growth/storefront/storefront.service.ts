import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { FoodDiscoveryService } from '../../food/discovery/discovery.service';
import { NEGATIVE_END } from '../../food/orders/food-order-status';
import { ORDER_SOURCES } from '../../food/common/food-types';

const NEGATIVE = NEGATIVE_END.map((s) => `'${s}'`).join(', ');
/** The sources that are the vendor's own reach: their link and their QR. */
const BROUGHT = ['storefront', 'qr'];

/**
 * The vendor's shareable storefront. The public page (`/public/food/store/:slug`)
 * is the vendor page any customer sees; the web storefront at
 * `STOREFRONT_BASE_URL/s/:slug` sends `source=storefront|qr` (and `?c=`
 * campaign) with the checkout, and "Orders you brought" counts them —
 * customers the vendor brought, not Food Court.
 */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discovery: FoodDiscoveryService,
    private readonly config: ConfigService,
  ) {}

  url(slug: string) {
    const base = this.config.get<string>('app.storefrontBaseUrl')!;
    return `${base}/s/${encodeURIComponent(slug)}`;
  }

  /** GET /public/food/store/:slug — the vendor page, for the web storefront. */
  async store(slug: string, now = new Date()) {
    const page = await this.discovery.vendor(slug, {}, now);
    return {
      ...page,
      storefront: {
        url: this.url(page.slug),
        sources: BROUGHT,
        note: 'Send source (storefront or qr) and campaign (?c=) with the checkout.',
      },
    };
  }

  /** GET /food/vendor/storefront — the link, the QR payload and what they brought. */
  async vendor(v: VendorRef, days: number, now = new Date()) {
    const [b] = await this.dataSource.query(
      `SELECT slug FROM food_brands WHERE id = $1`,
      [v.brandId],
    );
    const url = this.url(b.slug);
    const since = new Date(now.getTime() - days * 86_400_000);
    const [bySource, campaigns, [brought]] = await Promise.all([
      this.dataSource.query(
        `SELECT source, count(*)::int AS orders, coalesce(sum(total), 0)::int AS revenue
           FROM food_orders WHERE brand_id = $1 AND created_at >= $2 AND status NOT IN (${NEGATIVE})
          GROUP BY source`,
        [v.brandId, since],
      ),
      this.dataSource.query(
        `SELECT source, campaign, count(*)::int AS orders, coalesce(sum(total), 0)::int AS revenue
           FROM food_orders
          WHERE brand_id = $1 AND created_at >= $2 AND status NOT IN (${NEGATIVE})
            AND source = ANY($3::food_order_source[]) AND campaign IS NOT NULL
          GROUP BY source, campaign ORDER BY orders DESC, campaign LIMIT 20`,
        [v.brandId, since, BROUGHT],
      ),
      this.dataSource.query(
        `SELECT count(DISTINCT o.user_id)::int AS customers,
                count(DISTINCT o.user_id) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM food_orders e WHERE e.brand_id = o.brand_id AND e.user_id = o.user_id
                     AND e.created_at < o.created_at))::int AS new_customers
           FROM food_orders o
          WHERE o.brand_id = $1 AND o.created_at >= $2 AND o.status NOT IN (${NEGATIVE})
            AND o.source = ANY($3::food_order_source[])`,
        [v.brandId, since, BROUGHT],
      ),
    ]);
    const counts = Object.fromEntries(
      ORDER_SOURCES.map((s) => [s, { orders: 0, revenue: 0 }]),
    ) as Record<string, { orders: number; revenue: number }>;
    for (const r of bySource)
      counts[r.source] = { orders: r.orders, revenue: r.revenue };
    const total = Object.values(counts).reduce((s, c) => s + c.orders, 0);
    const mine = BROUGHT.reduce(
      (s, k) => ({
        orders: s.orders + counts[k].orders,
        revenue: s.revenue + counts[k].revenue,
      }),
      { orders: 0, revenue: 0 },
    );
    return {
      slug: b.slug,
      url,
      links: {
        storefront: `${url}?src=storefront`,
        qr: `${url}?src=qr`,
        campaignExample: `${url}?src=qr&c=flyer`,
      },
      /** Encode this in the QR at the counter, on the menu card or the packaging. */
      qr: { payload: `${url}?src=qr` },
      ordersYouBrought: {
        days,
        orders: mine.orders,
        revenue: mine.revenue,
        customers: brought.customers,
        newCustomers: brought.new_customers,
        share: total ? Math.round((mine.orders / total) * 1000) / 10 : 0,
        storefront: counts.storefront,
        qr: counts.qr,
        campaigns,
      },
      /** Every delivered-or-active order in the window, by where it came from. */
      bySource: counts,
      note: 'Zero commission on every order, wherever it came from.',
    };
  }
}
