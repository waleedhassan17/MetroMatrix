import { Injectable, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FoodOrderTransitionsService } from '../../food/orders/food-order-transitions.service';
import { FoodNotifier } from '../../food/orders/food-notifier.service';
import { NEGATIVE_END } from '../../food/orders/food-order-status';
import type { FoodOrder } from '../../food/orders/entities/food-order.entity';
import { KitchenStockService, StockLine } from './kitchen-stock.service';
import { KitchenAlertsService } from './kitchen-alerts.service';
import { round3 } from './units';

/**
 * Orders and stock: accepting deducts what the recipe cards say (add-on
 * lines only when that option was chosen; items without a card are
 * skipped), cancelling after that puts it back. Both run inside the order's
 * own transaction, once each (stock_deducted_at / stock_restored_at), and
 * the alerts they queue go out right after it commits.
 */
@Injectable()
export class OrderStockService implements OnModuleInit {
  constructor(
    private readonly transitions: FoodOrderTransitionsService,
    private readonly notifier: FoodNotifier,
    private readonly stock: KitchenStockService,
    private readonly alerts: KitchenAlertsService,
  ) {}

  onModuleInit(): void {
    this.transitions.afterStatus.push(async (m, order, _from, to, actor) => {
      if (to === 'accepted') await this.deduct(m, order, actor.userId);
      else if (NEGATIVE_END.includes(to))
        await this.restore(m, order, actor.userId);
    });
    this.notifier.afterChange.push((orderId) =>
      this.alerts.flushForOrder(orderId),
    );
  }

  /** The base-unit quantities an order's lines use, per ingredient. */
  async needs(m: EntityManager, orderId: string): Promise<Map<string, number>> {
    const rows: Array<{
      quantity: number;
      options: Array<{ id: string }>;
      yield_servings: number;
      ingredient_id: string;
      qty_base: string;
      option_id: string | null;
    }> = await m.query(
      `SELECT oi.quantity, oi.options, rc.yield_servings, rl.ingredient_id, rl.qty_base, rl.option_id
         FROM food_order_items oi
         JOIN LATERAL (
           SELECT c.* FROM recipe_cards c
            WHERE c.menu_item_id = oi.item_id
              AND (c.variant_id = oi.variant_id OR c.variant_id IS NULL)
            ORDER BY c.variant_id NULLS LAST LIMIT 1
         ) rc ON true
         JOIN recipe_lines rl ON rl.recipe_card_id = rc.id
        WHERE oi.order_id = $1`,
      [orderId],
    );
    const need = new Map<string, number>();
    for (const r of rows) {
      if (r.option_id && !(r.options ?? []).some((o) => o.id === r.option_id))
        continue;
      const qty = (Number(r.qty_base) / r.yield_servings) * r.quantity;
      need.set(r.ingredient_id, round3((need.get(r.ingredient_id) ?? 0) + qty));
    }
    return need;
  }

  async deduct(
    m: EntityManager,
    order: FoodOrder,
    actorUserId: string | null,
  ): Promise<void> {
    const [claim] = await m.query(
      `UPDATE food_orders SET stock_deducted_at = now() WHERE id = $1 AND stock_deducted_at IS NULL RETURNING id`,
      [order.id],
    );
    if (!claim) return;
    const need = await this.needs(m, order.id);
    const lines: StockLine[] = [...need].map(([ingredientId, qty]) => ({
      ingredientId,
      delta: -qty,
    }));
    await this.stock.apply(
      m,
      order.branchId,
      lines,
      'order',
      { type: 'food_order', id: order.id },
      actorUserId,
    );
  }

  async restore(
    m: EntityManager,
    order: FoodOrder,
    actorUserId: string | null,
  ): Promise<void> {
    const [claim] = await m.query(
      `UPDATE food_orders SET stock_restored_at = now()
        WHERE id = $1 AND stock_deducted_at IS NOT NULL AND stock_restored_at IS NULL RETURNING id`,
      [order.id],
    );
    if (!claim) return;
    await this.stock.restoreRef(
      m,
      order.branchId,
      { type: 'food_order', id: order.id },
      'order',
      'order_cancel',
      actorUserId,
    );
  }
}
