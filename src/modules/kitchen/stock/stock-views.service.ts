import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  paged,
  likeEscape,
  PaginationQueryDto,
} from '../../../common/pagination/pagination';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { StockCountDto, StockQueryDto } from '../dto/stock.dto';
import { kitchenNotFound } from '../common/errors';
import { KitchenStockService } from './kitchen-stock.service';
import { KitchenAlertsService } from './kitchen-alerts.service';
import {
  EXPIRING_SQL,
  INGREDIENT_COLUMNS,
  IngredientsService,
  ingredientView,
} from './ingredients.service';
import { display, round3, toBase } from './units';

/** GET /stock, the stock take and the movement ledger. */
@Injectable()
export class StockViewsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: KitchenStockService,
    private readonly ingredients: IngredientsService,
    private readonly alerts: KitchenAlertsService,
  ) {}

  async overview(v: VendorRef, q: StockQueryDto) {
    const today = await this.ingredients.today(
      this.dataSource.manager,
      v.branchId,
    );
    const where = ['ki.branch_id = $1', 'ki.is_active'];
    const params: unknown[] = [v.branchId, today];
    if (q.category) {
      params.push(q.category);
      where.push(`ki.category = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${likeEscape(q.q)}%`);
      where.push(
        `(ki.name ILIKE $${params.length} OR ki.name_ur ILIKE $${params.length})`,
      );
    }
    const filter = q.filter ?? 'all';
    const having =
      filter === 'expiring'
        ? 'WHERE x.expiring_qty > 0'
        : filter === 'below_par'
          ? 'WHERE x.par_level IS NOT NULL AND x.on_hand < x.par_level'
          : filter === 'negative'
            ? 'WHERE x.on_hand < 0'
            : '';
    const base = `SELECT * FROM (SELECT ${INGREDIENT_COLUMNS}, ${EXPIRING_SQL('$2')}
                     FROM kitchen_ingredients ki WHERE ${where.join(' AND ')}) x ${having}`;
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM (${base}) y`,
      params,
    );
    const rows = await this.dataSource.query(
      `${base} ORDER BY x.on_hand < 0 DESC, x.expiring_qty > 0 DESC NULLS LAST, x.category, x.name
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      params,
    );
    const [s] = await this.dataSource.query(
      `SELECT count(*)::int AS ingredients,
              coalesce(round(sum(GREATEST(x.on_hand, 0) * x.avg_cost)), 0)::int AS value,
              count(*) FILTER (WHERE x.expiring_qty > 0)::int AS expiring,
              count(*) FILTER (WHERE x.par_level IS NOT NULL AND x.on_hand < x.par_level)::int AS below_par,
              count(*) FILTER (WHERE x.on_hand < 0)::int AS negative
         FROM (SELECT ${INGREDIENT_COLUMNS}, ${EXPIRING_SQL('$2')} FROM kitchen_ingredients ki
                WHERE ki.branch_id = $1 AND ki.is_active) x`,
      [v.branchId, today],
    );
    return {
      ...paged(rows.map(ingredientView), n, q),
      summary: {
        ingredients: s.ingredients,
        value: s.value,
        expiringIn3Days: s.expiring,
        belowPar: s.below_par,
        negative: s.negative,
      },
    };
  }

  /** A stock take: each line sets on-hand to what was counted (the difference is a count_adjust movement). */
  async count(v: VendorRef, dto: StockCountDto) {
    const ref = { type: 'count' as const, id: randomUUID() };
    const adjusted = await this.dataSource.transaction(async (m) => {
      const ids = [...new Set(dto.lines.map((l) => l.ingredientId))].sort();
      const rows: Array<{
        id: string;
        name: string;
        base_unit: 'g' | 'ml' | 'piece';
        custom_units: [];
        on_hand: string;
      }> = await m.query(
        `SELECT id, name, base_unit, custom_units, on_hand FROM kitchen_ingredients
            WHERE branch_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
        [v.branchId, ids],
      );
      if (rows.length !== ids.length) throw kitchenNotFound('Ingredient');
      const out: Array<{
        ingredientId: string;
        name: string;
        before: number;
        counted: number;
        delta: number;
      }> = [];
      for (const l of dto.lines) {
        const r = rows.find((x) => x.id === l.ingredientId)!;
        const counted = toBase(l.qty, l.unit, {
          baseUnit: r.base_unit,
          customUnits: r.custom_units,
        });
        const before = Number(r.on_hand);
        out.push({
          ingredientId: r.id,
          name: r.name,
          before,
          counted,
          delta: round3(counted - before),
        });
        r.on_hand = String(counted);
      }
      await this.stock.apply(
        m,
        v.branchId,
        out.map((o) => ({
          ingredientId: o.ingredientId,
          delta: o.delta,
          note: dto.note ?? 'Stock count',
        })),
        'count_adjust',
        ref,
        v.ownerUserId,
      );
      return out;
    });
    await this.alerts.flush(v.branchId);
    return { countId: ref.id, adjusted };
  }

  async movements(v: VendorRef, ingredientId: string, q: PaginationQueryDto) {
    const [i] = await this.dataSource.query(
      `SELECT id, base_unit FROM kitchen_ingredients WHERE id = $1 AND branch_id = $2`,
      [ingredientId, v.branchId],
    );
    if (!i) throw kitchenNotFound('Ingredient');
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE ingredient_id = $1`,
      [ingredientId],
    );
    const rows = await this.dataSource.query(
      `SELECT sm.id, sm.created_at, sm.delta, sm.reason, sm.ref_type, sm.ref_id, sm.balance_after, sm.unit_cost,
              sm.batch_id, sm.note, o.code AS order_code
         FROM stock_movements sm
         LEFT JOIN food_orders o ON sm.ref_type = 'food_order' AND o.id = sm.ref_id
        WHERE sm.ingredient_id = $1 ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      [ingredientId],
    );
    return paged(
      rows.map((r: any) => ({
        id: r.id,
        at: r.created_at,
        delta: Number(r.delta),
        deltaDisplay: display(Number(r.delta), i.base_unit),
        reason: r.reason,
        refType: r.ref_type,
        refId: r.ref_id,
        orderCode: r.order_code ?? undefined,
        balanceAfter: Number(r.balance_after),
        unitCost: Number(r.unit_cost),
        value: Math.round(Number(r.delta) * Number(r.unit_cost)),
        batchId: r.batch_id,
        note: r.note,
      })),
      n,
      q,
    );
  }

  /** Batches still on the shelf, oldest first (what FIFO will use next). */
  async batches(v: VendorRef, ingredientId: string) {
    const [i] = await this.dataSource.query(
      `SELECT id, base_unit FROM kitchen_ingredients WHERE id = $1 AND branch_id = $2`,
      [ingredientId, v.branchId],
    );
    if (!i) throw kitchenNotFound('Ingredient');
    const rows = await this.dataSource.query(
      `SELECT id, qty_received, qty_remaining, unit_cost, received_at, expires_on FROM stock_batches
        WHERE ingredient_id = $1 AND qty_remaining > 0 ORDER BY received_at, created_at, id`,
      [ingredientId],
    );
    return rows.map((b: any) => ({
      id: b.id,
      qtyReceived: Number(b.qty_received),
      qtyRemaining: Number(b.qty_remaining),
      remainingDisplay: display(Number(b.qty_remaining), i.base_unit),
      unitCost: Number(b.unit_cost),
      receivedAt: b.received_at,
      expiresOn: b.expires_on,
    }));
  }
}
