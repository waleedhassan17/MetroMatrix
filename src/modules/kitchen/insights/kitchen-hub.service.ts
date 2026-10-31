import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  addDays,
  localDayBounds,
  todayIn,
} from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { ServiceabilityService } from '../../food/availability/serviceability.service';
import { CostingService } from '../costing/costing.service';
import { ForecastService } from '../forecast/forecast.service';
import { StockAvailabilityService } from '../stock/stock-availability.service';
import { StockViewsService } from '../stock/stock-views.service';
import { SurplusService } from '../surplus/surplus.service';
import { WasteService } from '../waste/waste.service';
import type { StockQueryDto } from '../dto/stock.dto';
import type { WasteSummaryQueryDto } from '../dto/purchase.dto';

/** A dish whose stock makes this many servings or fewer shows on the board as running low. */
export const LOW_SERVINGS = 5;

/** A finished experiment counts as a result to read for this many days. */
const RESULT_DAYS = 14;

/** One part of the hub's numbers, added by another module (tiffin, catering, …) under its key. */
export type SummaryPart = (
  v: VendorRef,
  ctx: { today: string; timezone: string; now: Date },
) => Promise<unknown>;

/**
 * The Kitchen tab's numbers in one read (GET /summary) and the board's kitchen
 * side (GET /board). Each figure is the one the screen it opens shows: the
 * stock summary, costing, tomorrow's forecast, the week's waste and donations,
 * and (registered by Growth) tiffin, catering, the storefront, demand, the
 * hygiene badge and Ramadan.
 */
@Injectable()
export class KitchenHubService {
  private readonly parts = new Map<string, SummaryPart>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: StockAvailabilityService,
    private readonly serviceability: ServiceabilityService,
    private readonly stockViews: StockViewsService,
    private readonly costing: CostingService,
    private readonly forecast: ForecastService,
    private readonly waste: WasteService,
    private readonly surplus: SurplusService,
  ) {}

  register(key: string, part: SummaryPart): void {
    this.parts.set(key, part);
  }

  /** Dishes running low or sold out by stock, the prep time quotes use now, and the packing rule. */
  async board(v: VendorRef, now = new Date()) {
    const m = this.dataSource.manager;
    const items: Array<{ id: string; name: string }> = await m.query(
      `SELECT id, name FROM menu_items WHERE brand_id = $1 AND is_active ORDER BY name`,
      [v.brandId],
    );
    const cards = await this.availability.cardServings(
      m,
      items.map((i) => i.id),
    );
    const lowStock: Array<{ itemId: string; name: string; servings: number }> =
      [];
    for (const i of items) {
      // A dish is as available as the size that can make the most.
      const known = (cards.get(i.id) ?? [])
        .map((c) => c.servings)
        .filter((s): s is number => s !== null);
      if (!known.length) continue;
      const best = Math.max(...known);
      if (best >= 1 && best <= LOW_SERVINGS)
        lowStock.push({ itemId: i.id, name: i.name, servings: best });
    }
    lowStock.sort(
      (a, b) => a.servings - b.servings || a.name.localeCompare(b.name),
    );
    const soldOutByStock: Array<{ itemId: string; name: string }> =
      await m.query(
        `SELECT mi.id AS "itemId", mi.name FROM branch_item_overrides o JOIN menu_items mi ON mi.id = o.item_id
          WHERE o.branch_id = $1 AND o.auto_reason = 'stock' AND NOT o.is_available ORDER BY mi.name`,
        [v.branchId],
      );
    const b = (await this.serviceability.branch(v.branchId, null, m))!;
    const [s] = await m.query(
      `SELECT require_packing_photo FROM branches WHERE id = $1`,
      [v.branchId],
    );
    return {
      lowStock,
      soldOutByStock,
      prep: this.serviceability.prepFor(b, 1, now),
      requirePackingPhoto: s.require_packing_photo as boolean,
    };
  }

  async summary(v: VendorRef, now = new Date()) {
    const m = this.dataSource.manager;
    const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
      v.branchId,
    ]);
    const timezone: string = b.timezone;
    const today = todayIn(timezone, now);
    const tomorrow = addDays(today, 1);
    const weekStart = localDayBounds(addDays(today, -6), timezone).start;
    const [stock, attention, costing, forecast, waste, donations, buys, tests] =
      await Promise.all([
        this.stockViews.overview(v, {
          filter: 'all',
          page: 1,
          pageSize: 1,
        } as StockQueryDto),
        m.query(
          `SELECT count(*)::int AS n FROM kitchen_ingredients
            WHERE branch_id = $1 AND is_active AND (on_hand < 0 OR (par_level IS NOT NULL AND on_hand < par_level))`,
          [v.branchId],
        ),
        this.costing.view(v),
        this.forecast.view(v, tomorrow, 1),
        this.waste.summary(v, { range: '7d' } as WasteSummaryQueryDto, now),
        this.surplus.donations(v),
        m.query(
          `SELECT coalesce(sum(total), 0)::int AS total, count(*)::int AS n FROM purchases
            WHERE branch_id = $1 AND purchased_at >= $2`,
          [v.branchId, weekStart],
        ),
        m.query(
          // Stored 'active'; running once its first day has come (as GET /experiments?status=running).
          `SELECT count(*) FILTER (WHERE status = 'active' AND starts_on <= $3::date)::int AS running,
                  count(*) FILTER (WHERE status = 'completed' AND completed_at >= $2)::int AS results
             FROM menu_experiments WHERE branch_id = $1`,
          [
            v.branchId,
            new Date(now.getTime() - RESULT_DAYS * 86_400_000),
            today,
          ],
        ),
      ]);
    const growth: Record<string, unknown> = {
      experiments: { running: tests[0].running, results: tests[0].results },
    };
    for (const [key, part] of this.parts)
      growth[key] = await part(v, { today, timezone, now });
    const c = costing.summary;
    return {
      date: today,
      stock: {
        ingredients: stock.summary.ingredients,
        value: stock.summary.value,
        belowPar: stock.summary.belowPar,
        negative: stock.summary.negative,
        expiring: stock.summary.expiringIn3Days,
        /** Below par or below zero, each ingredient once. */
        attention: attention[0].n as number,
      },
      recipes: {
        dishes: c.dishes,
        withRecipe: c.withRecipe,
        withoutRecipe: c.dishes - c.withRecipe,
        aboveTarget: c.aboveTarget,
        avgFoodCostPct: c.avgFoodCostPct,
        targetFoodCostPct: costing.targetFoodCostPct,
      },
      purchases: { weekTotal: buys[0].total, weekCount: buys[0].n },
      forecast: {
        date: tomorrow,
        dishes: forecast.items.length,
        /** Each dish's own number when the vendor set one, else the forecast rounded. */
        portions: forecast.items.reduce(
          (s: number, i: { adjusted: number | null; expected: number }) =>
            s + (i.adjusted ?? Math.round(i.expected)),
          0,
        ),
        learning: forecast.learning,
      },
      waste: {
        weekCost: waste.totalCost,
        mealsRescued: donations.mealsRescued,
      },
      growth,
    };
  }
}
