import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { paged } from '../../../common/pagination/pagination';
import { addDays } from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { WasteEntry } from '../entities/waste-entry.entity';
import {
  WasteDto,
  WasteQueryDto,
  WasteSummaryQueryDto,
} from '../dto/purchase.dto';
import { kitchenNotFound } from '../common/errors';
import { KitchenStockService, StockLine } from '../stock/kitchen-stock.service';
import { KitchenAlertsService } from '../stock/kitchen-alerts.service';
import { IngredientsService } from '../stock/ingredients.service';
import { canonicalUnit, round3, toBase } from '../stock/units';

const SERVING_UNITS = new Set([
  'serving',
  'servings',
  'plate',
  'plates',
  'portion',
  'portions',
]);

/**
 * The waste log. An ingredient is taken out of stock (oldest batches
 * first); a dish's portions take its recipe out. Cost is what the stock was
 * worth at the batches' cost.
 */
@Injectable()
export class WasteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: KitchenStockService,
    private readonly alerts: KitchenAlertsService,
    private readonly ingredients: IngredientsService,
  ) {}

  async log(v: VendorRef, dto: WasteDto) {
    const id = await this.dataSource.transaction(async (m) => {
      let lines: StockLine[] = [];
      let unit = dto.unit;
      if (dto.ingredientId) {
        const [i] = await m.query(
          `SELECT id, base_unit, custom_units FROM kitchen_ingredients WHERE id = $1 AND branch_id = $2`,
          [dto.ingredientId, v.branchId],
        );
        if (!i) throw kitchenNotFound('Ingredient');
        lines = [
          {
            ingredientId: i.id,
            delta: -toBase(dto.qty, dto.unit, {
              baseUnit: i.base_unit,
              customUnits: i.custom_units,
            }),
          },
        ];
        unit = canonicalUnit(dto.unit);
      } else {
        const [item] = await m.query(
          `SELECT id FROM menu_items WHERE id = $1 AND brand_id = $2`,
          [dto.menuItemId, v.brandId],
        );
        if (!item) throw kitchenNotFound('Item');
        if (!SERVING_UNITS.has(canonicalUnit(dto.unit)))
          throw new BadRequestException({
            code: ErrorCode.UNIT_MISMATCH,
            message: 'A dish is wasted in servings.',
            details: { unit: dto.unit, allowed: ['serving'] },
          });
        unit = 'serving';
        const recipe: Array<{
          ingredient_id: string;
          qty_base: string;
          yield_servings: number;
        }> = await m.query(
          `SELECT rl.ingredient_id, rl.qty_base, rc.yield_servings FROM recipe_cards rc
             JOIN recipe_lines rl ON rl.recipe_card_id = rc.id AND rl.option_id IS NULL AND NOT rl.is_packaging
            WHERE rc.menu_item_id = $1 AND rc.variant_id IS NULL`,
          [item.id],
        );
        const need = new Map<string, number>();
        for (const r of recipe)
          need.set(
            r.ingredient_id,
            round3(
              (need.get(r.ingredient_id) ?? 0) +
                (Number(r.qty_base) / r.yield_servings) * dto.qty,
            ),
          );
        lines = [...need].map(([ingredientId, q]) => ({
          ingredientId,
          delta: -q,
        }));
      }
      const e = await m.save(
        m.create(WasteEntry, {
          branchId: v.branchId,
          ingredientId: dto.ingredientId ?? null,
          menuItemId: dto.menuItemId ?? null,
          qty: dto.qty,
          unit,
          reason: dto.reason,
          note: dto.note ?? null,
          loggedBy: v.ownerUserId,
          cost: null,
        }),
      );
      if (lines.length) {
        await this.stock.apply(
          m,
          v.branchId,
          lines,
          'waste',
          { type: 'waste', id: e.id },
          v.ownerUserId,
        );
        const [{ cost }] = await m.query(
          `SELECT coalesce(round(-sum(delta * unit_cost)), 0)::int AS cost FROM stock_movements
            WHERE ref_type = 'waste' AND ref_id = $1`,
          [e.id],
        );
        await m.update(WasteEntry, { id: e.id }, { cost });
      }
      return e.id;
    });
    await this.alerts.flush(v.branchId);
    return this.one(v, id);
  }

  private async one(v: VendorRef, id: string) {
    const [r] = await this.rows(v, `w.id = $2`, [id]);
    if (!r) throw kitchenNotFound('Waste entry');
    return r;
  }

  private async rows(
    v: VendorRef,
    where: string,
    params: unknown[],
    tail = '',
  ) {
    const rows = await this.dataSource.query(
      `SELECT w.id, w.created_at, w.ingredient_id, ki.name AS ingredient, w.menu_item_id, mi.name AS dish,
              w.qty, w.unit, w.reason, w.cost, w.note
         FROM waste_entries w
         LEFT JOIN kitchen_ingredients ki ON ki.id = w.ingredient_id
         LEFT JOIN menu_items mi ON mi.id = w.menu_item_id
        WHERE w.branch_id = $1 AND ${where} ORDER BY w.created_at DESC, w.id ${tail}`,
      [v.branchId, ...params],
    );
    return rows.map((r: any) => ({
      id: r.id,
      at: r.created_at,
      ingredientId: r.ingredient_id,
      menuItemId: r.menu_item_id,
      name: r.ingredient ?? r.dish,
      kind: r.ingredient_id ? 'ingredient' : 'dish',
      qty: Number(r.qty),
      unit: r.unit,
      reason: r.reason,
      cost: r.cost,
      note: r.note,
    }));
  }

  async list(v: VendorRef, q: WasteQueryDto) {
    const where: string[] = ['true'];
    const params: unknown[] = [];
    if (q.reason) {
      params.push(q.reason);
      where.push(`w.reason = $${params.length + 1}`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`w.created_at >= $${params.length + 1}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`w.created_at < $${params.length + 1}::date + 1`);
    }
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM waste_entries w WHERE w.branch_id = $1 AND ${where.join(' AND ')}`,
      [v.branchId, ...params],
    );
    const items = await this.rows(
      v,
      where.join(' AND '),
      params,
      `LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    );
    return paged(items, n, q);
  }

  /** Totals for the last 7 / 30 / 90 days (branch-local), by reason and item, with a daily series and the period before. */
  async summary(v: VendorRef, q: WasteSummaryQueryDto, now = new Date()) {
    const days = Number((q.range ?? '7d').replace('d', ''));
    const today = await this.ingredients.today(
      this.dataSource.manager,
      v.branchId,
    );
    const [b] = await this.dataSource.query(
      `SELECT timezone FROM branches WHERE id = $1`,
      [v.branchId],
    );
    const from = addDays(today, -(days - 1));
    const start = DateTime.fromISO(from, { zone: b.timezone }).toJSDate();
    const prevStart = DateTime.fromISO(addDays(from, -days), {
      zone: b.timezone,
    }).toJSDate();
    const [tot] = await this.dataSource.query(
      `SELECT coalesce(sum(cost) FILTER (WHERE created_at >= $2), 0)::int AS cost,
              count(*) FILTER (WHERE created_at >= $2)::int AS entries,
              coalesce(sum(cost) FILTER (WHERE created_at >= $3 AND created_at < $2), 0)::int AS prev
         FROM waste_entries WHERE branch_id = $1 AND created_at >= $3`,
      [v.branchId, start, prevStart],
    );
    const byReason = await this.dataSource.query(
      `SELECT reason, coalesce(sum(cost), 0)::int AS cost, count(*)::int AS entries FROM waste_entries
        WHERE branch_id = $1 AND created_at >= $2 GROUP BY reason ORDER BY cost DESC`,
      [v.branchId, start],
    );
    const top = await this.dataSource.query(
      `SELECT coalesce(ki.name, mi.name) AS name, CASE WHEN w.ingredient_id IS NULL THEN 'dish' ELSE 'ingredient' END AS kind,
              coalesce(w.ingredient_id, w.menu_item_id) AS id, coalesce(sum(w.cost), 0)::int AS cost, count(*)::int AS entries
         FROM waste_entries w LEFT JOIN kitchen_ingredients ki ON ki.id = w.ingredient_id
         LEFT JOIN menu_items mi ON mi.id = w.menu_item_id
        WHERE w.branch_id = $1 AND w.created_at >= $2
        GROUP BY 1, 2, 3 ORDER BY cost DESC LIMIT 5`,
      [v.branchId, start],
    );
    const daily = await this.dataSource.query(
      `SELECT to_char((created_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS date, coalesce(sum(cost), 0)::int AS cost
         FROM waste_entries WHERE branch_id = $1 AND created_at >= $2 GROUP BY 1 ORDER BY 1`,
      [v.branchId, start, b.timezone],
    );
    void now;
    return {
      range: `${days}d`,
      from,
      to: today,
      totalCost: tot.cost,
      entries: tot.entries,
      previousCost: tot.prev,
      changePct: tot.prev
        ? Math.round(((tot.cost - tot.prev) / tot.prev) * 100)
        : null,
      byReason,
      top,
      daily,
    };
  }
}
