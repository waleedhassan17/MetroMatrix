import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, EntityManager } from 'typeorm';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { parallel } from '../../../common/db/parallel';

export interface CostRow {
  itemId: string;
  name: string;
  isActive: boolean;
  variantId: string | null;
  variantName: string | null;
  price: number;
  hasRecipe: boolean;
  /** Rupees per serving at today's average cost (packaging included, add-ons not). */
  cost: number | null;
  foodCostPct: number | null;
  margin: number | null;
  /** Lines whose ingredient has no cost yet (log a purchase). */
  uncosted: string[];
  lastWeekPct: number | null;
  /** Food cost % points since the start of last week's snapshot. */
  trend: number | null;
  aboveTarget: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monday of the branch's current week, "YYYY-MM-DD". */
export const weekStartOf = (now: Date, tz: string) =>
  DateTime.fromJSDate(now, { zone: tz }).startOf('week').toISODate()!;

/**
 * Dish costing: cost per serving = Σ card lines ÷ yield × average cost; a
 * size without its own card uses the dish's. Food cost % = cost ÷ price;
 * margin = price − cost. A weekly snapshot per dish and size gives the trend.
 */
@Injectable()
export class CostingService {
  constructor(private readonly dataSource: DataSource) {}

  async target(
    m: EntityManager,
    branchId: string,
  ): Promise<{ target: number; tz: string }> {
    const [b] = await m.query(
      `SELECT target_food_cost_pct, timezone FROM branches WHERE id = $1`,
      [branchId],
    );
    return { target: b.target_food_cost_pct, tz: b.timezone };
  }

  /** Every dish and size of the brand (or just `itemIds`). */
  async rows(
    m: EntityManager,
    v: Pick<VendorRef, 'brandId' | 'branchId'>,
    itemIds?: string[],
    now = new Date(),
  ): Promise<CostRow[]> {
    const { target, tz } = await this.target(m, v.branchId);
    const items: Array<{
      id: string;
      name: string;
      base_price: number;
      is_active: boolean;
    }> = await m.query(
      `SELECT id, name, base_price, is_active FROM menu_items
        WHERE brand_id = $1 ${itemIds ? 'AND id = ANY($2::uuid[])' : ''} ORDER BY sort, name`,
      itemIds ? [v.brandId, itemIds] : [v.brandId],
    );
    if (!items.length) return [];
    const ids = items.map((i) => i.id);
    const [variants, lines, snaps] = await parallel(m, [
      () =>
        m.query(
          `SELECT id, item_id, name, price FROM item_variants WHERE item_id = ANY($1::uuid[]) ORDER BY sort, name`,
          [ids],
        ),
      () =>
        m.query(
          `SELECT rc.menu_item_id, rc.variant_id, rc.yield_servings, rl.qty_base, ki.avg_cost, ki.name
           FROM recipe_cards rc JOIN recipe_lines rl ON rl.recipe_card_id = rc.id AND rl.option_id IS NULL
           JOIN kitchen_ingredients ki ON ki.id = rl.ingredient_id
          WHERE rc.menu_item_id = ANY($1::uuid[])`,
          [ids],
        ),
      () =>
        m.query(
          `SELECT menu_item_id, variant_key, food_cost_pct FROM item_cost_snapshots
          WHERE menu_item_id = ANY($1::uuid[]) AND week_start = $2`,
          [
            ids,
            DateTime.fromISO(weekStartOf(now, tz))
              .minus({ weeks: 1 })
              .toISODate(),
          ],
        ),
    ]);
    const cardOf = (itemId: string, variantId: string | null) => {
      const own = lines.filter(
        (l: any) => l.menu_item_id === itemId && l.variant_id === variantId,
      );
      if (own.length || variantId === null) return own;
      return lines.filter(
        (l: any) => l.menu_item_id === itemId && l.variant_id === null,
      );
    };
    const out: CostRow[] = [];
    for (const item of items) {
      const sizes = variants.filter((x: any) => x.item_id === item.id);
      const rows: Array<{
        id: string | null;
        name: string | null;
        price: number;
      }> = sizes.length
        ? sizes.map((x: any) => ({ id: x.id, name: x.name, price: x.price }))
        : [{ id: null, name: null, price: item.base_price }];
      for (const r of rows) {
        const card = cardOf(item.id, r.id);
        const hasRecipe = card.length > 0;
        const cost = hasRecipe
          ? round2(
              card.reduce(
                (s: number, l: any) =>
                  s +
                  (Number(l.qty_base) / l.yield_servings) * Number(l.avg_cost),
                0,
              ),
            )
          : null;
        const pct =
          cost !== null && r.price > 0 ? round1((cost / r.price) * 100) : null;
        const snap = snaps.find(
          (s: any) =>
            s.menu_item_id === item.id && s.variant_key === (r.id ?? '-'),
        );
        const last = snap ? Number(snap.food_cost_pct) : null;
        out.push({
          itemId: item.id,
          name: item.name,
          isActive: item.is_active,
          variantId: r.id,
          variantName: r.name,
          price: r.price,
          hasRecipe,
          cost,
          foodCostPct: pct,
          margin: cost !== null ? Math.round(r.price - cost) : null,
          uncosted: card
            .filter((l: any) => Number(l.avg_cost) === 0)
            .map((l: any) => l.name),
          lastWeekPct: last,
          trend: pct !== null && last !== null ? round1(pct - last) : null,
          aboveTarget: pct !== null && pct > target,
        });
      }
    }
    return out;
  }

  async view(v: VendorRef) {
    await this.snapshot(this.dataSource.manager, v);
    const rows = await this.rows(this.dataSource.manager, v);
    const { target } = await this.target(this.dataSource.manager, v.branchId);
    const costed = rows.filter((r) => r.foodCostPct !== null);
    return {
      targetFoodCostPct: target,
      items: rows,
      summary: {
        dishes: new Set(rows.map((r) => r.itemId)).size,
        withRecipe: new Set(
          rows.filter((r) => r.hasRecipe).map((r) => r.itemId),
        ).size,
        aboveTarget: rows.filter((r) => r.aboveTarget).length,
        avgFoodCostPct: costed.length
          ? round1(
              costed.reduce((s, r) => s + r.foodCostPct!, 0) / costed.length,
            )
          : null,
      },
    };
  }

  /** This week's baseline (idempotent: the first look of the week, or the weekly job). */
  async snapshot(
    m: EntityManager,
    v: Pick<VendorRef, 'brandId' | 'branchId'>,
    now = new Date(),
  ) {
    const { tz } = await this.target(m, v.branchId);
    const week = weekStartOf(now, tz);
    const rows = (await this.rows(m, v, undefined, now)).filter(
      (r) => r.foodCostPct !== null,
    );
    for (const r of rows)
      await m.query(
        `INSERT INTO item_cost_snapshots (branch_id, menu_item_id, variant_key, week_start, cost, price, food_cost_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (menu_item_id, variant_key, week_start) DO NOTHING`,
        [
          v.branchId,
          r.itemId,
          r.variantId ?? '-',
          week,
          r.cost,
          r.price,
          r.foodCostPct,
        ],
      );
    return rows.length;
  }
}
