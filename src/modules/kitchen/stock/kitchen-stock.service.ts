import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { MovementReason } from '../entities/stock-movement.entity';
import { KitchenAlertsService } from './kitchen-alerts.service';
import { StockAvailabilityService } from './stock-availability.service';
import { display, round3, round4 } from './units';

export interface StockLine {
  ingredientId: string;
  /** Base units; positive in, negative out. */
  delta: number;
  /** Rupees per base unit for stock coming in (purchases); default the average cost. */
  unitCost?: number;
  expiresOn?: string | null;
  purchaseLineId?: string | null;
  note?: string | null;
}

export interface StockRef {
  type: 'food_order' | 'purchase' | 'waste' | 'count' | 'manual';
  id: string | null;
}

interface Held {
  id: string;
  name: string;
  baseUnit: 'g' | 'ml' | 'piece';
  onHand: number;
  avg: number;
  lastCost: number | null;
  wasNegative: boolean;
}

export const ingredientNotFound = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'Ingredient not found.',
  });

/**
 * The only code that changes stock (as InventoryService is for Shopping):
 * locks the ingredients in id order, receives into a new batch or consumes
 * oldest batches first, writes one movement per batch with the balance after
 * it, keeps the weighted average cost, and then re-checks which dishes can
 * still be made. Stock may go negative — it never blocks an order; going
 * below zero queues a "log your purchase" alert.
 */
@Injectable()
export class KitchenStockService {
  constructor(
    private readonly availability: StockAvailabilityService,
    private readonly alerts: KitchenAlertsService,
  ) {}

  async apply(
    m: EntityManager,
    branchId: string,
    lines: StockLine[],
    reason: MovementReason,
    ref: StockRef,
    actorUserId: string | null,
  ): Promise<void> {
    const live = lines.filter((l) => Math.abs(l.delta) >= 0.0005);
    if (!live.length) return;
    const held = await this.lock(
      m,
      branchId,
      live.map((l) => l.ingredientId),
    );
    for (const line of live) {
      const h = held.get(line.ingredientId)!;
      if (line.delta > 0)
        await this.addIn(
          m,
          h,
          round3(line.delta),
          line.unitCost ?? null,
          reason,
          ref,
          actorUserId,
          line,
        );
      else
        await this.takeOut(
          m,
          h,
          round3(-line.delta),
          reason,
          ref,
          actorUserId,
          line.note ?? null,
        );
    }
    await this.finish(m, branchId, held);
  }

  /**
   * Put back what an order (or purchase) took out: into the same batches
   * when they still exist. Idempotent per ref through the caller's flag
   * (food_orders.stock_restored_at).
   */
  async restoreRef(
    m: EntityManager,
    branchId: string,
    ref: StockRef,
    takenAs: MovementReason,
    reason: MovementReason,
    actorUserId: string | null,
  ): Promise<void> {
    const moves: Array<{
      ingredient_id: string;
      batch_id: string | null;
      delta: string;
      unit_cost: string;
    }> = await m.query(
      `SELECT ingredient_id, batch_id, delta, unit_cost FROM stock_movements
          WHERE ref_type = $1 AND ref_id = $2 AND reason = $3 AND delta < 0 ORDER BY created_at, id`,
      [ref.type, ref.id, takenAs],
    );
    if (!moves.length) return;
    const held = await this.lock(
      m,
      branchId,
      moves.map((x) => x.ingredient_id),
    );
    for (const x of moves) {
      const h = held.get(x.ingredient_id)!;
      await this.giveBack(
        m,
        h,
        -Number(x.delta),
        x.batch_id,
        Number(x.unit_cost),
        reason,
        ref,
        actorUserId,
      );
    }
    await this.finish(m, branchId, held);
  }

  /**
   * Take an untouched purchase back out: its batches emptied, a manual
   * movement each, and the average cost as if it had never come in.
   */
  async reversePurchase(
    m: EntityManager,
    branchId: string,
    purchaseId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const moves: Array<{
      ingredient_id: string;
      batch_id: string | null;
      delta: string;
      unit_cost: string;
    }> = await m.query(
      `SELECT ingredient_id, batch_id, delta, unit_cost FROM stock_movements
        WHERE ref_type = 'purchase' AND ref_id = $1 AND reason = 'purchase' ORDER BY created_at, id`,
      [purchaseId],
    );
    if (!moves.length) return;
    const held = await this.lock(
      m,
      branchId,
      moves.map((x) => x.ingredient_id),
    );
    for (const x of moves) {
      const h = held.get(x.ingredient_id)!;
      const qty = Number(x.delta);
      const cost = Number(x.unit_cost);
      if (x.batch_id)
        await m.query(
          `UPDATE stock_batches SET qty_remaining = GREATEST(qty_remaining - $2, 0), updated_at = now() WHERE id = $1`,
          [x.batch_id, qty],
        );
      const left = round3(h.onHand - qty);
      // What is left is valued at the batches still on the shelf.
      const [val] = await m.query(
        `SELECT sum(qty_remaining) AS q, sum(qty_remaining * unit_cost) AS v
           FROM stock_batches WHERE ingredient_id = $1 AND qty_remaining > 0`,
        [h.id],
      );
      if (Number(val.q) > 0) h.avg = round4(Number(val.v) / Number(val.q));
      h.onHand = left;
      await this.move(
        m,
        h,
        x.batch_id,
        -qty,
        cost,
        'manual',
        { type: 'purchase', id: purchaseId },
        actorUserId,
        'Purchase deleted',
      );
    }
    await this.finish(m, branchId, held);
  }

  private async lock(
    m: EntityManager,
    branchId: string,
    ids: string[],
  ): Promise<Map<string, Held>> {
    const unique = [...new Set(ids)].sort();
    const rows = await m.query(
      `SELECT id, name, base_unit, on_hand, avg_cost, last_cost FROM kitchen_ingredients
        WHERE branch_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [branchId, unique],
    );
    if (rows.length !== unique.length) throw ingredientNotFound();
    return new Map(
      rows.map((r: any) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          baseUnit: r.base_unit,
          onHand: Number(r.on_hand),
          avg: Number(r.avg_cost),
          lastCost: r.last_cost === null ? null : Number(r.last_cost),
          wasNegative: Number(r.on_hand) < 0,
        } satisfies Held,
      ]),
    );
  }

  /** Stock in: settles any shortfall first, the rest becomes a batch; weighted average over what is held. */
  private async addIn(
    m: EntityManager,
    h: Held,
    qty: number,
    unitCost: number | null,
    reason: MovementReason,
    ref: StockRef,
    actor: string | null,
    line: StockLine,
  ) {
    const cost = round4(unitCost ?? h.avg);
    const settle = Math.min(qty, Math.max(-h.onHand, 0));
    const intoBatch = round3(qty - settle);
    const [batch] = await m.query(
      `INSERT INTO stock_batches (ingredient_id, qty_received, qty_remaining, unit_cost, expires_on, purchase_line_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        h.id,
        qty,
        intoBatch,
        cost,
        line.expiresOn ?? null,
        line.purchaseLineId ?? null,
      ],
    );
    const heldQty = Math.max(h.onHand, 0);
    h.avg = round4((heldQty * h.avg + qty * cost) / (heldQty + qty));
    if (reason === 'purchase') h.lastCost = cost;
    h.onHand = round3(h.onHand + qty);
    await this.move(
      m,
      h,
      batch.id,
      qty,
      cost,
      reason,
      ref,
      actor,
      line.note ?? null,
    );
  }

  /** Stock out, oldest batch first; what no batch covers is a shortfall at the average cost. */
  private async takeOut(
    m: EntityManager,
    h: Held,
    qty: number,
    reason: MovementReason,
    ref: StockRef,
    actor: string | null,
    note: string | null,
  ) {
    let left = qty;
    const batches: Array<{
      id: string;
      qty_remaining: string;
      unit_cost: string;
    }> = await m.query(
      `SELECT id, qty_remaining, unit_cost FROM stock_batches
        WHERE ingredient_id = $1 AND qty_remaining > 0 ORDER BY received_at, created_at, id`,
      [h.id],
    );
    for (const b of batches) {
      if (left <= 0) break;
      const take = round3(Math.min(left, Number(b.qty_remaining)));
      await m.query(
        `UPDATE stock_batches SET qty_remaining = qty_remaining - $2, updated_at = now() WHERE id = $1`,
        [b.id, take],
      );
      h.onHand = round3(h.onHand - take);
      await this.move(
        m,
        h,
        b.id,
        -take,
        Number(b.unit_cost),
        reason,
        ref,
        actor,
        note,
      );
      left = round3(left - take);
    }
    if (left > 0) {
      h.onHand = round3(h.onHand - left);
      await this.move(m, h, null, -left, h.avg, reason, ref, actor, note);
    }
  }

  private async giveBack(
    m: EntityManager,
    h: Held,
    qty: number,
    batchId: string | null,
    unitCost: number,
    reason: MovementReason,
    ref: StockRef,
    actor: string | null,
  ) {
    const settle = Math.min(qty, Math.max(-h.onHand, 0));
    const intoBatch = round3(qty - settle);
    let target = batchId;
    if (intoBatch > 0) {
      const res = target
        ? await m.query(
            `UPDATE stock_batches SET qty_remaining = qty_remaining + $2, updated_at = now() WHERE id = $1 RETURNING id`,
            [target, intoBatch],
          )
        : [[]];
      const updated = Array.isArray(res[0]) ? res[0].length : res.length;
      if (!target || !updated) {
        const [b] = await m.query(
          `INSERT INTO stock_batches (ingredient_id, qty_received, qty_remaining, unit_cost) VALUES ($1, $2, $2, $3) RETURNING id`,
          [h.id, intoBatch, unitCost],
        );
        target = b.id;
      }
    }
    h.onHand = round3(h.onHand + qty);
    await this.move(
      m,
      h,
      intoBatch > 0 ? target : null,
      qty,
      unitCost,
      reason,
      ref,
      actor,
      null,
    );
  }

  private async move(
    m: EntityManager,
    h: Held,
    batchId: string | null,
    delta: number,
    unitCost: number,
    reason: MovementReason,
    ref: StockRef,
    actor: string | null,
    note: string | null,
  ) {
    await m.query(
      `INSERT INTO stock_movements (ingredient_id, batch_id, delta, reason, ref_type, ref_id, actor_user_id, balance_after, unit_cost, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        h.id,
        batchId,
        delta,
        reason,
        ref.type,
        ref.id,
        actor,
        h.onHand,
        round4(unitCost),
        note,
      ],
    );
  }

  private async finish(
    m: EntityManager,
    branchId: string,
    held: Map<string, Held>,
  ) {
    for (const h of held.values()) {
      await m.query(
        `UPDATE kitchen_ingredients
            SET on_hand = $2::numeric, avg_cost = $3::numeric, last_cost = $4::numeric, updated_at = now(),
                negative_alerted_at = CASE WHEN $2::numeric >= 0 THEN NULL
                                           ELSE coalesce(negative_alerted_at, now()) END
          WHERE id = $1`,
        [h.id, h.onHand, h.avg, h.lastCost],
      );
      // Below zero for the first time since it was last ≥ 0: one alert.
      if (h.onHand < 0 && !h.wasNegative) {
        const d = display(h.onHand, h.baseUnit);
        await this.alerts.queue(
          m,
          branchId,
          'stock_negative',
          `${h.name} is below zero`,
          `Your stock says ${d.qty} ${d.unit}. Log your purchase (or a count) so costs and sold-out stay right.`,
          { ingredientId: h.id, screen: 'kitchen.purchase.new' },
        );
      }
    }
    await this.availability.sync(m, branchId, [...held.keys()]);
  }
}
