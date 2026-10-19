import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import {
  addDays,
  shortDateLabel,
  todayIn,
} from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { StockAvailabilityService } from '../stock/stock-availability.service';
import { display, round3 } from '../stock/units';
import { ForecastService } from './forecast.service';
import { InsightCardsService } from '../insights/insight-cards.service';

/** The shopping list buys this much over the plan. */
export const SAFETY_BUFFER = 0.1;

interface NeedLine {
  ingredientId: string;
  name: string;
  category: string;
  baseUnit: 'g' | 'ml' | 'piece';
  need: number;
  onHand: number;
  parLevel: number | null;
}

/**
 * Prep sheet, shopping list and suggested portions — all from the planned
 * portions per dish (the vendor's number, else the forecast, plus certain
 * demand) × the recipe cards.
 */
@Injectable()
export class PrepService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly forecast: ForecastService,
    private readonly availability: StockAvailabilityService,
    private readonly insights: InsightCardsService,
  ) {}

  onModuleInit(): void {
    // Tomorrow's plan needs more than the shelf has.
    this.insights.register(async (v, today) => {
      const list = await this.shoppingList(v, addDays(today, 1));
      const short = list.lines.filter(
        (l) => l.reason === 'plan' && l.need > l.inStock,
      );
      if (!short.length) return [];
      const top = short
        .slice(0, 3)
        .map((l) => `${l.name} ${l.toBuyDisplay.qty} ${l.toBuyDisplay.unit}`);
      return [
        {
          kind: 'forecast_gap',
          priority: 3,
          title: `Tomorrow needs more than you have: ${short.length} ingredient${short.length === 1 ? '' : 's'}`,
          body: `Buy ${top.join(', ')}${short.length > 3 ? ' and more' : ''}.`,
          action: {
            label: 'Shopping list',
            screen: 'kitchen.shopping-list',
            params: { date: list.date },
          },
          data: {
            date: list.date,
            ingredients: short.map((l) => l.ingredientId),
          },
        },
      ];
    });
  }

  private async dateFor(m: EntityManager, branchId: string, date?: string) {
    const [b] = await m.query(`SELECT timezone FROM branches WHERE id = $1`, [
      branchId,
    ]);
    const today = todayIn(b.timezone);
    return { date: date ?? addDays(today, 1), today };
  }

  /** Planned dishes and what they use (base lines of the dish's card; add-ons left out). */
  private async needs(m: EntityManager, v: VendorRef, date: string) {
    const planned = await this.forecast.planned(m, v.branchId, date);
    const ids = [...planned.keys()];
    const items: Array<{ id: string; name: string }> = ids.length
      ? await m.query(
          `SELECT id, name FROM menu_items WHERE id = ANY($1::uuid[]) ORDER BY sort, name`,
          [ids],
        )
      : [];
    const lines: Array<{
      menu_item_id: string;
      ingredient_id: string;
      name: string;
      category: string;
      base_unit: 'g' | 'ml' | 'piece';
      qty_base: string;
      yield_servings: number;
      on_hand: string;
      par_level: string | null;
    }> = ids.length
      ? await m.query(
          `SELECT rc.menu_item_id, ki.id AS ingredient_id, ki.name, ki.category, ki.base_unit, rl.qty_base,
                  rc.yield_servings, ki.on_hand, ki.par_level
             FROM recipe_cards rc JOIN recipe_lines rl ON rl.recipe_card_id = rc.id AND rl.option_id IS NULL
             JOIN kitchen_ingredients ki ON ki.id = rl.ingredient_id
            WHERE rc.menu_item_id = ANY($1::uuid[]) AND rc.variant_id IS NULL`,
          [ids],
        )
      : [];
    const need = new Map<string, NeedLine>();
    for (const l of lines) {
      const p = planned.get(l.menu_item_id)!;
      const q = (Number(l.qty_base) / l.yield_servings) * p.planned;
      const cur = need.get(l.ingredient_id) ?? {
        ingredientId: l.ingredient_id,
        name: l.name,
        category: l.category,
        baseUnit: l.base_unit,
        need: 0,
        onHand: Number(l.on_hand),
        parLevel: l.par_level === null ? null : Number(l.par_level),
      };
      cur.need = round3(cur.need + q);
      need.set(l.ingredient_id, cur);
    }
    const withCard = new Set(lines.map((l) => l.menu_item_id));
    return {
      dishes: items.map((i) => ({
        itemId: i.id,
        name: i.name,
        ...planned.get(i.id)!,
        hasRecipe: withCard.has(i.id),
      })),
      need: [...need.values()],
    };
  }

  async prepSheet(v: VendorRef, date?: string) {
    const m = this.dataSource.manager;
    const d = await this.dateFor(m, v.branchId, date);
    const { dishes, need } = await this.needs(m, v, d.date);
    const byCategory = new Map<string, unknown[]>();
    for (const n of need.sort((a, b) => a.name.localeCompare(b.name))) {
      const inStock = Math.max(n.onHand, 0);
      const short = round3(Math.max(0, n.need - inStock));
      byCategory.set(n.category, [
        ...(byCategory.get(n.category) ?? []),
        {
          ingredientId: n.ingredientId,
          name: n.name,
          need: n.need,
          needDisplay: display(n.need, n.baseUnit),
          inStock,
          inStockDisplay: display(inStock, n.baseUnit),
          short,
          shortDisplay: display(short, n.baseUnit),
        },
      ]);
    }
    return {
      date: d.date,
      dishes,
      ingredients: [...byCategory].map(([category, lines]) => ({
        category,
        lines,
      })),
      dishesWithoutRecipe: dishes
        .filter((x) => !x.hasRecipe && x.planned > 0)
        .map((x) => ({ itemId: x.itemId, name: x.name })),
    };
  }

  /** Need − stock + 10% buffer; topped up so stock stays at the par level after cooking. */
  async shoppingList(v: VendorRef, date?: string) {
    const m = this.dataSource.manager;
    const d = await this.dateFor(m, v.branchId, date);
    const { need } = await this.needs(m, v, d.date);
    const lines = need
      .map((n) => {
        const inStock = Math.max(n.onHand, 0);
        const forPlan = n.need * (1 + SAFETY_BUFFER) - inStock;
        const forPar = n.parLevel !== null ? n.need + n.parLevel - inStock : 0;
        const toBuy = round3(Math.max(0, forPlan, forPar));
        return {
          ingredientId: n.ingredientId,
          name: n.name,
          category: n.category,
          need: n.need,
          inStock,
          parLevel: n.parLevel,
          toBuy,
          toBuyDisplay: display(toBuy, n.baseUnit),
          reason: forPar > forPlan ? 'par_level' : 'plan',
        };
      })
      .filter((l) => l.toBuy > 0)
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
      );
    const text = [
      `Shopping list — ${shortDateLabel(d.date)}`,
      ...lines.map(
        (l) => `• ${l.name}: ${l.toBuyDisplay.qty} ${l.toBuyDisplay.unit}`,
      ),
    ].join('\n');
    return {
      date: d.date,
      bufferPct: SAFETY_BUFFER * 100,
      lines,
      text,
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}`,
    };
  }

  /** Home kitchens: tomorrow's portions = the forecast's high, rounded, capped by what the stock makes. */
  async portionSuggestions(v: VendorRef, date?: string) {
    const m = this.dataSource.manager;
    const d = await this.dateFor(m, v.branchId, date);
    const rows: Array<{
      menu_item_id: string;
      name: string;
      high: string;
      adjusted: number | null;
      daily_limit: number | null;
    }> = await m.query(
      `SELECT f.menu_item_id, mi.name, f.high, f.adjusted, o.daily_limit
           FROM demand_forecasts f JOIN menu_items mi ON mi.id = f.menu_item_id AND mi.is_active
           LEFT JOIN branch_item_overrides o ON o.branch_id = f.branch_id AND o.item_id = f.menu_item_id
          WHERE f.branch_id = $1 AND f.for_date = $2::date ORDER BY mi.sort, mi.name`,
      [v.branchId, d.date],
    );
    const servings = await this.availability.cardServings(
      m,
      rows.map((r) => r.menu_item_id),
    );
    return {
      date: d.date,
      items: rows.map((r) => {
        const fromForecast = r.adjusted ?? Math.round(Number(r.high));
        const cards = (servings.get(r.menu_item_id) ?? []).filter(
          (c) => c.servings !== null,
        );
        const fromStock = cards.length
          ? Math.max(...cards.map((c) => c.servings!))
          : null;
        const suggested =
          fromStock === null ? fromForecast : Math.min(fromForecast, fromStock);
        return {
          itemId: r.menu_item_id,
          name: r.name,
          suggested,
          fromForecast,
          fromStock,
          cappedByStock: fromStock !== null && fromStock < fromForecast,
          current: r.daily_limit,
        };
      }),
    };
  }

  /** One tap: today → portions reset now; tomorrow → the daily limit the nightly reset uses. */
  async applySuggestions(v: VendorRef, date: string) {
    const m = this.dataSource.manager;
    const d = await this.dateFor(m, v.branchId, date);
    if (date !== d.today && date !== addDays(d.today, 1))
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Portions can be set for today or tomorrow.',
        details: { fields: { date: ['today or tomorrow'] } },
      });
    const s = await this.portionSuggestions(v, date);
    await this.dataSource.transaction(async (tx) => {
      for (const i of s.items) {
        if (date === d.today)
          await tx.query(
            `INSERT INTO branch_item_overrides (branch_id, item_id, daily_limit, remaining_today) VALUES ($1, $2, $3, $3)
             ON CONFLICT (branch_id, item_id) DO UPDATE SET daily_limit = EXCLUDED.daily_limit,
               remaining_today = EXCLUDED.daily_limit, updated_at = now()`,
            [v.branchId, i.itemId, i.suggested],
          );
        else
          await tx.query(
            `INSERT INTO branch_item_overrides (branch_id, item_id, daily_limit) VALUES ($1, $2, $3)
             ON CONFLICT (branch_id, item_id) DO UPDATE SET daily_limit = EXCLUDED.daily_limit, updated_at = now()`,
            [v.branchId, i.itemId, i.suggested],
          );
      }
    });
    return {
      date,
      applied: s.items.map((i) => ({
        itemId: i.itemId,
        name: i.name,
        portions: i.suggested,
      })),
    };
  }

  /** How good the kitchen's promises have been (last 30 days), and what it has learned. */
  async etaAccuracy(v: VendorRef) {
    const [r] = await this.dataSource.query(
      `SELECT count(*)::int AS orders,
              count(*) FILTER (WHERE coalesce(delivered_at, picked_up_at) <= promised_at + interval '5 minutes')::int AS on_time,
              round(avg(GREATEST(0, extract(epoch FROM coalesce(delivered_at, picked_up_at) - promised_at) / 60))
                FILTER (WHERE coalesce(delivered_at, picked_up_at) > promised_at + interval '5 minutes'))::int AS avg_late
         FROM food_orders
        WHERE branch_id = $1 AND promised_at IS NOT NULL AND coalesce(delivered_at, picked_up_at) IS NOT NULL
          AND created_at > now() - interval '30 days'`,
      [v.branchId],
    );
    const stats = await this.dataSource.query(
      `SELECT hour_bucket, size_bucket, p50_minutes, p75_minutes, samples FROM prep_time_stats
        WHERE branch_id = $1 ORDER BY hour_bucket, size_bucket`,
      [v.branchId],
    );
    const [b] = await this.dataSource.query(
      `SELECT prep_minutes FROM branches WHERE id = $1`,
      [v.branchId],
    );
    return {
      orders: r.orders,
      onTime: r.on_time,
      onTimePct: r.orders ? Math.round((r.on_time / r.orders) * 100) : null,
      avgLateMinutes: r.avg_late,
      configuredPrepMinutes: b.prep_minutes,
      learned: stats.map((s: any) => ({
        hour: s.hour_bucket,
        size: s.size_bucket,
        p50: s.p50_minutes,
        p75: s.p75_minutes,
        samples: s.samples,
        inUse: s.samples >= 20,
      })),
    };
  }
}
