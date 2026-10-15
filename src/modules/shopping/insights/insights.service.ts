import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { INSIGHT_RANGES, InsightRange } from './dto/insights.dto';
import { LOW_STOCK_THRESHOLD } from '../common/catalog-sql';
import { OPEN_RETURN_STATUSES } from '../returns/return-status';

/** Day boundaries are Pakistan days, whatever the server's clock zone. */
const PKT_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Karachi')::date`;
const PKT_TODAY = `(now() AT TIME ZONE 'Asia/Karachi')::date`;

/**
 * The partner's numbers. "Recorded sales" is the sum of delivered order
 * totals — what customers paid the store directly. MetroMatrix holds none of
 * it, so it is never labelled revenue, balance or earnings.
 */
@Injectable()
export class InsightsService {
  constructor(private readonly dataSource: DataSource) {}

  async dashboard(storeId: string) {
    const [orders] = await this.dataSource.query(
      `SELECT
         count(*) FILTER (WHERE ${PKT_DAY('created_at')} = ${PKT_TODAY})::int AS today_orders,
         count(*) FILTER (WHERE status = 'placed')::int AS new_orders,
         count(*) FILTER (WHERE status IN ('confirmed', 'packed'))::int AS to_ship,
         count(*) FILTER (WHERE payment_status = 'proof_submitted' AND status <> 'cancelled')::int AS awaiting_payment_confirmation,
         count(*) FILTER (WHERE payment_status = 'refund_due')::int AS refunds_due,
         count(*) FILTER (WHERE cancel_requested_at IS NOT NULL AND status IN ('confirmed', 'packed'))::int AS cancel_requests,
         coalesce(sum(total) FILTER (WHERE status IN ('delivered', 'completed') AND delivered_at > now() - interval '7 days'), 0)::int AS sales_7d,
         coalesce(sum(total) FILTER (WHERE status IN ('delivered', 'completed') AND delivered_at > now() - interval '30 days'), 0)::int AS sales_30d
       FROM store_orders WHERE store_id = $1`,
      [storeId],
    );
    const [other] = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE p.store_id = $1 AND p.status = 'active' AND v.is_active AND v.stock <= ${LOW_STOCK_THRESHOLD}) AS low_stock,
         (SELECT count(*)::int FROM return_requests r
           WHERE r.store_id = $1 AND r.status = ANY($2::return_status[])) AS open_returns,
         (SELECT count(*)::int FROM product_reviews r
           WHERE r.store_id = $1 AND r.store_reply IS NULL AND NOT r.is_hidden) AS unreplied_reviews,
         (SELECT rating_avg FROM stores WHERE id = $1) AS rating_avg,
         (SELECT rating_count FROM stores WHERE id = $1) AS rating_count`,
      [storeId, [...OPEN_RETURN_STATUSES]],
    );
    return {
      todayNewOrders: orders.today_orders,
      newOrders: orders.new_orders,
      toShip: orders.to_ship,
      awaitingPaymentConfirmation: orders.awaiting_payment_confirmation,
      refundsDue: orders.refunds_due,
      cancelRequests: orders.cancel_requests,
      lowStockVariants: other.low_stock,
      openReturns: other.open_returns,
      unrepliedReviews: other.unreplied_reviews,
      rating: { avg: parseFloat(other.rating_avg), count: other.rating_count },
      recordedSales: {
        last7Days: orders.sales_7d,
        last30Days: orders.sales_30d,
      },
    };
  }

  /**
   * For the last N Pakistan days (today included):
   *  - ordersPerDay: orders placed (any status) by day placed;
   *  - recordedSalesPerDay: delivered/completed totals by day delivered;
   *  - topProducts: units and value from orders not cancelled;
   *  - repeatCustomers: customers with 2+ non-cancelled orders / all customers;
   *  - conversion: of the orders placed in range, how many reached delivered.
   */
  async insights(storeId: string, range: InsightRange = '30d') {
    const days = INSIGHT_RANGES[range];
    const from = `(${PKT_TODAY} - ${days - 1})`;
    const series = await this.dataSource.query(
      `WITH d AS (SELECT generate_series(${from}, ${PKT_TODAY}, interval '1 day')::date AS day)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              (SELECT count(*)::int FROM store_orders so
                WHERE so.store_id = $1 AND ${PKT_DAY('so.created_at')} = d.day) AS orders,
              (SELECT coalesce(sum(so.total), 0)::int FROM store_orders so
                WHERE so.store_id = $1 AND so.status IN ('delivered', 'completed')
                  AND ${PKT_DAY('so.delivered_at')} = d.day) AS recorded_sales
         FROM d ORDER BY d.day`,
      [storeId],
    );
    const inRange = `so.store_id = $1 AND ${PKT_DAY('so.created_at')} >= ${from}`;
    const top = await this.dataSource.query(
      `SELECT i.product_id, max(i.product_name) AS snapshot_name, p.name AS current_name,
              sum(i.quantity)::int AS units, sum(i.line_total)::int AS value
         FROM store_order_items i
         JOIN store_orders so ON so.id = i.store_order_id
         LEFT JOIN products p ON p.id = i.product_id
        WHERE ${inRange} AND so.status <> 'cancelled'
        GROUP BY i.product_id, p.name
        ORDER BY units DESC, value DESC, i.product_id
        LIMIT 5`,
      [storeId],
    );
    const [customers] = await this.dataSource.query(
      `SELECT count(*)::int AS customers, count(*) FILTER (WHERE n >= 2)::int AS repeat
         FROM (SELECT so.user_id, count(*) AS n FROM store_orders so
                WHERE ${inRange} AND so.status <> 'cancelled' GROUP BY so.user_id) c`,
      [storeId],
    );
    const [funnel] = await this.dataSource.query(
      `SELECT count(*)::int AS placed,
              count(*) FILTER (WHERE so.status IN ('delivered', 'completed'))::int AS delivered,
              count(*) FILTER (WHERE so.status = 'cancelled')::int AS cancelled
         FROM store_orders so WHERE ${inRange}`,
      [storeId],
    );
    const ratio = (a: number, b: number) =>
      b ? Math.round((a / b) * 10_000) / 10_000 : 0;
    return {
      range,
      days,
      ordersPerDay: series.map((r: any) => ({
        date: r.date,
        orders: r.orders,
      })),
      recordedSalesPerDay: series.map((r: any) => ({
        date: r.date,
        amount: r.recorded_sales,
      })),
      totals: {
        orders: series.reduce((n: number, r: any) => n + r.orders, 0),
        recordedSales: series.reduce(
          (n: number, r: any) => n + r.recorded_sales,
          0,
        ),
      },
      topProducts: top.map((r: any) => ({
        productId: r.product_id,
        name: r.current_name ?? r.snapshot_name,
        units: r.units,
        value: r.value,
      })),
      repeatCustomers: {
        customers: customers.customers,
        repeat: customers.repeat,
        share: ratio(customers.repeat, customers.customers),
      },
      conversion: {
        placed: funnel.placed,
        delivered: funnel.delivered,
        cancelled: funnel.cancelled,
        rate: ratio(funnel.delivered, funnel.placed),
      },
    };
  }
}
