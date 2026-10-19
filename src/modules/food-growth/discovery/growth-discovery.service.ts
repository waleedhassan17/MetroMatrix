import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FoodDiscoveryService } from '../../food/discovery/discovery.service';

/**
 * Bachat Box and tiffin on the Food home: the `bachat_box` badge on vendor
 * cards with a box to collect right now, and the `surplusNearYou` and
 * `tiffinNearYou` rails. (Ramadan adds `iftarNearYou`; stories add the
 * hygiene and signature badges.)
 */
@Injectable()
export class GrowthDiscoveryService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discovery: FoodDiscoveryService,
  ) {}

  onModuleInit(): void {
    this.discovery.badgeSources.push(async (ids, now) => {
      const out = new Map<string, string[]>();
      for (const id of await this.withBoxes(ids, now))
        out.set(id, ['bachat_box']);
      return out;
    });
    this.discovery.railSources.push(async ({ brandIds, now }) => {
      const [boxes, tiffin] = await Promise.all([
        this.withBoxes(brandIds, now),
        this.withTiffin(brandIds),
      ]);
      return {
        ...(boxes.length ? { surplusNearYou: boxes } : {}),
        ...(tiffin.length ? { tiffinNearYou: tiffin } : {}),
      };
    });
  }

  /** Brands with a live box still to collect, the soonest pickup first. */
  private async withBoxes(brandIds: string[], now: Date): Promise<string[]> {
    if (!brandIds.length) return [];
    const rows = await this.dataSource.query(
      `SELECT br.brand_id, min(sb.pickup_from) AS first
         FROM surplus_boxes sb JOIN branches br ON br.id = sb.branch_id
        WHERE br.brand_id = ANY($1::uuid[]) AND sb.status = 'live' AND sb.remaining > 0 AND sb.pickup_to > $2
        GROUP BY br.brand_id ORDER BY first, br.brand_id`,
      [brandIds, now],
    );
    return rows.map((r: { brand_id: string }) => r.brand_id);
  }

  /** Brands with an active tiffin plan that still has a free place, the cheapest first. */
  private async withTiffin(brandIds: string[]): Promise<string[]> {
    if (!brandIds.length) return [];
    const rows = await this.dataSource.query(
      `SELECT p.brand_id, min(p.price_per_period) AS price
         FROM tiffin_plans p
        WHERE p.brand_id = ANY($1::uuid[]) AND p.is_active
          AND p.capacity > (SELECT count(*) FROM tiffin_subscriptions s
                             WHERE s.plan_id = p.id AND s.status IN ('active', 'paused'))
        GROUP BY p.brand_id ORDER BY price, p.brand_id`,
      [brandIds],
    );
    return rows.map((r: { brand_id: string }) => r.brand_id);
  }
}
