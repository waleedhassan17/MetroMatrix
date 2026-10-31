import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KitchenHubService } from '../../kitchen/insights/kitchen-hub.service';
import { DemandService } from '../demand/demand.service';
import { RamadanService } from '../ramadan/ramadan.service';
import { StoryService } from '../story/story.service';
import { TiffinService } from '../tiffin/tiffin.service';

/** Orders through the kitchen's own link or QR count over this many days. */
const STOREFRONT_DAYS = 30;

/**
 * Growth's numbers on the Kitchen tab (GET /food/vendor/kitchen/summary →
 * `growth`). Each is what the screen it opens shows: tiffin, catering, the
 * storefront, the demand map's newest week, the hygiene badge and Ramadan.
 */
@Injectable()
export class GrowthSummaryService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hub: KitchenHubService,
    private readonly tiffin: TiffinService,
    private readonly demand: DemandService,
    private readonly story: StoryService,
    private readonly ramadan: RamadanService,
  ) {}

  onModuleInit(): void {
    this.hub.register('tiffin', async (v) => {
      const [c] = await this.dataSource.query(
        `SELECT (SELECT count(*)::int FROM tiffin_plans WHERE brand_id = $1 AND is_active) AS plans,
                count(s.id) FILTER (WHERE s.status IN ('active', 'paused'))::int AS subscribers,
                count(s.id) FILTER (WHERE s.status = 'requested')::int AS requested
           FROM tiffin_plans p LEFT JOIN tiffin_subscriptions s ON s.plan_id = p.id
          WHERE p.brand_id = $1`,
        [v.brandId],
      );
      const t = await this.tiffin.tomorrow(v);
      return {
        plans: c.plans,
        subscribers: c.subscribers,
        requested: c.requested,
        mealsTomorrow: t.meals,
      };
    });
    this.hub.register('catering', async (v, { today }) => {
      const [c] = await this.dataSource.query(
        `SELECT count(*) FILTER (WHERE status = 'requested')::int AS requested,
                count(*) FILTER (WHERE status IN ('accepted', 'advance_proof', 'confirmed') AND event_date >= $2::date)::int AS upcoming
           FROM catering_requests WHERE brand_id = $1`,
        [v.brandId, today],
      );
      return { requested: c.requested, upcoming: c.upcoming };
    });
    this.hub.register('storefront', async (v, { now }) => {
      const [c] = await this.dataSource.query(
        `SELECT count(*)::int AS orders FROM food_orders
          WHERE brand_id = $1 AND source IN ('storefront', 'qr') AND status NOT IN ('rejected', 'cancelled')
            AND created_at >= $2`,
        [v.brandId, new Date(now.getTime() - STOREFRONT_DAYS * 86_400_000)],
      );
      return { days: STOREFRONT_DAYS, orders: c.orders };
    });
    this.hub.register('demand', async (v) => {
      const map = await this.demand.vendorMap(v, {});
      const cells = (
        map.cells as Array<{ unmetSearches: number; inYourZone: boolean }>
      ).filter((c) => c.inYourZone);
      return {
        week: (map as { week?: string | null }).week ?? null,
        unmetSearches: cells.reduce((s, c) => s + c.unmetSearches, 0),
      };
    });
    this.hub.register(
      'hygiene',
      async (v) => (await this.story.get(v)).hygieneStatus,
    );
    this.hub.register('ramadan', async (v, { today }) => {
      const r = await this.ramadan.get(v);
      const now = r.events.find(
        (e: { startsOn: string; endsOn: string }) =>
          e.startsOn <= today && today <= e.endsOn,
      );
      return {
        enabled: r.settings.enabled,
        period: now ? 'now' : r.events.length ? 'ahead' : 'none',
      };
    });
  }
}
