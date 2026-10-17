import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FoodFavourite } from './entities/food-favourite.entity';
import {
  FoodDiscoveryService,
  VISIBLE_VENDOR_SQL,
} from '../discovery/discovery.service';
import { BranchStateService } from '../availability/branch-state.service';
import { ErrorCode } from '../../../common/errors/codes';

/** Saved vendors, and the "order again" row on the home screen. */
@Injectable()
export class FoodFavouritesService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discovery: FoodDiscoveryService,
    private readonly state: BranchStateService,
  ) {}

  onModuleInit(): void {
    this.discovery.orderAgain = (userId) => this.orderAgain(userId);
  }

  /** Vendors this customer received food from, most recent first. */
  async orderAgain(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT brand_id FROM food_orders WHERE user_id = $1 AND status IN ('delivered', 'picked_up')
        GROUP BY brand_id ORDER BY max(created_at) DESC LIMIT 10`,
      [userId],
    );
    return rows.map((r: any) => r.brand_id);
  }

  async list(userId: string, now = new Date()) {
    const rows = await this.dataSource.query(
      `SELECT fb.id, fb.slug, fb.name, fb.logo_url, fb.cover_url, fb.rating_avg, fb.rating_count,
              br.id AS branch_id, br.timezone, br.is_paused, br.pause_message, br.busy_until,
              br.busy_extra_minutes, br.prep_minutes, f.created_at AS saved_at
         FROM food_favourites f JOIN food_brands fb ON fb.id = f.brand_id
         JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
        WHERE f.user_id = $1 AND ${VISIBLE_VENDOR_SQL}
        ORDER BY f.created_at DESC LIMIT 200`,
      [userId],
    );
    const schedules = await this.state.schedules(
      rows.map((r: any) => r.branch_id),
      now,
    );
    return {
      items: rows.map((r: any) => {
        const open = this.state.state(
          { ...r, id: r.branch_id },
          schedules.get(r.branch_id)!,
          now,
        );
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          logoUrl: r.logo_url,
          coverUrl: r.cover_url,
          ratingAvg: parseFloat(r.rating_avg),
          ratingCount: r.rating_count,
          openState: {
            open: open.open,
            paused: open.paused,
            label: open.label,
          },
          savedAt: r.saved_at,
        };
      }),
    };
  }

  async add(userId: string, vendorId: string) {
    const [v] = await this.dataSource.query(
      `SELECT fb.id FROM food_brands fb JOIN branches br ON br.brand_id = fb.id
         JOIN businesses b ON b.id = fb.business_id WHERE fb.id = $1 AND ${VISIBLE_VENDOR_SQL}`,
      [vendorId],
    );
    if (!v)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'This vendor is not on Food Court.',
      });
    await this.dataSource.query(
      `INSERT INTO food_favourites (user_id, brand_id) VALUES ($1, $2) ON CONFLICT (user_id, brand_id) DO NOTHING`,
      [userId, vendorId],
    );
    return { vendorId, favourite: true };
  }

  async remove(userId: string, vendorId: string) {
    await this.dataSource.manager.delete(FoodFavourite, {
      userId,
      brandId: vendorId,
    });
    return { vendorId, favourite: false };
  }
}
