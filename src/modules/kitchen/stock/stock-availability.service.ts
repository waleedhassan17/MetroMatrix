import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { KitchenAlertsService } from './kitchen-alerts.service';

export interface CardServings {
  cardId: string;
  variantId: string | null;
  /** Whole servings the stock on hand makes (base lines, packaging excluded). null = the card has no such lines. */
  servings: number | null;
  /** The ingredient that runs out first. */
  limitedBy: { ingredientId: string; name: string } | null;
}

/**
 * Which dishes the stock can still make, and the automatic sold-out:
 * servings = min over a card's base (non-packaging, non-add-on) lines of
 * floor(on hand ÷ per-serving quantity). A dish with no card, or whose cards
 * all make ≥ 1, is left alone. Below 1 on every card → unavailable with
 * auto_reason 'stock' (and the vendor is told); back to ≥ 1 → available
 * again — but only if the stock made it unavailable. A vendor's own
 * sold-out is never undone here.
 */
@Injectable()
export class StockAvailabilityService {
  constructor(private readonly alerts: KitchenAlertsService) {}

  async cardServings(
    m: EntityManager,
    itemIds: string[],
  ): Promise<Map<string, CardServings[]>> {
    if (!itemIds.length) return new Map();
    const rows: Array<{
      card_id: string;
      menu_item_id: string;
      variant_id: string | null;
      yield_servings: number;
      ingredient_id: string | null;
      name: string | null;
      qty_base: string | null;
      on_hand: string | null;
    }> = await m.query(
      `SELECT rc.id AS card_id, rc.menu_item_id, rc.variant_id, rc.yield_servings,
              ki.id AS ingredient_id, ki.name, rl.qty_base, ki.on_hand
         FROM recipe_cards rc
         LEFT JOIN recipe_lines rl ON rl.recipe_card_id = rc.id AND rl.option_id IS NULL AND NOT rl.is_packaging
         LEFT JOIN kitchen_ingredients ki ON ki.id = rl.ingredient_id
        WHERE rc.menu_item_id = ANY($1::uuid[])
        ORDER BY rc.menu_item_id, rc.variant_id NULLS FIRST`,
      [itemIds],
    );
    const cards = new Map<string, CardServings & { itemId: string }>();
    for (const r of rows) {
      let c = cards.get(r.card_id);
      if (!c) {
        c = {
          cardId: r.card_id,
          itemId: r.menu_item_id,
          variantId: r.variant_id,
          servings: null,
          limitedBy: null,
        };
        cards.set(r.card_id, c);
      }
      if (!r.ingredient_id || r.qty_base === null) continue;
      const perServing = Number(r.qty_base) / r.yield_servings;
      const s = Math.max(0, Math.floor(Number(r.on_hand) / perServing + 1e-9));
      if (c.servings === null || s < c.servings) {
        c.servings = s;
        c.limitedBy = { ingredientId: r.ingredient_id, name: r.name! };
      }
    }
    const out = new Map<string, CardServings[]>();
    for (const { itemId, ...c } of cards.values())
      out.set(itemId, [...(out.get(itemId) ?? []), c]);
    return out;
  }

  /** Re-check the dishes that use these ingredients (in the caller's transaction). */
  async sync(
    m: EntityManager,
    branchId: string,
    ingredientIds: string[],
  ): Promise<void> {
    if (!ingredientIds.length) return;
    const items: Array<{ id: string; name: string }> = await m.query(
      `SELECT DISTINCT mi.id, mi.name FROM recipe_lines rl
         JOIN recipe_cards rc ON rc.id = rl.recipe_card_id
         JOIN menu_items mi ON mi.id = rc.menu_item_id
         JOIN branches br ON br.brand_id = mi.brand_id AND br.id = $1
        WHERE rl.ingredient_id = ANY($2::uuid[]) AND rl.option_id IS NULL AND NOT rl.is_packaging`,
      [branchId, ingredientIds],
    );
    await this.syncItems(m, branchId, items);
  }

  async syncItems(
    m: EntityManager,
    branchId: string,
    items: Array<{ id: string; name: string }>,
  ): Promise<void> {
    if (!items.length) return;
    const servings = await this.cardServings(
      m,
      items.map((i) => i.id),
    );
    const overrides: Array<{
      item_id: string;
      is_available: boolean;
      auto_reason: string | null;
      unavailable_until: Date | null;
    }> = await m.query(
      `SELECT item_id, is_available, auto_reason, unavailable_until FROM branch_item_overrides
          WHERE branch_id = $1 AND item_id = ANY($2::uuid[]) FOR UPDATE`,
      [branchId, items.map((i) => i.id)],
    );
    for (const item of items) {
      const cards = (servings.get(item.id) ?? []).filter(
        (c) => c.servings !== null,
      );
      if (!cards.length) continue;
      const best = Math.max(...cards.map((c) => c.servings!));
      const row = overrides.find((o) => o.item_id === item.id);
      const manualOff =
        row &&
        (!row.is_available ||
          (row.unavailable_until && row.unavailable_until > new Date()));
      if (best < 1 && !manualOff) {
        await m.query(
          `INSERT INTO branch_item_overrides (branch_id, item_id, is_available, auto_reason)
           VALUES ($1, $2, false, 'stock')
           ON CONFLICT (branch_id, item_id) DO UPDATE SET is_available = false, auto_reason = 'stock',
             unavailable_until = NULL, updated_at = now()`,
          [branchId, item.id],
        );
        const short = cards.find((c) => c.limitedBy)?.limitedBy?.name;
        await this.alerts.queue(
          m,
          branchId,
          'sold_out_stock',
          `${item.name} is sold out`,
          `${short ? `${short} ran out. ` : ''}It comes back by itself when you log a purchase or a stock count.`,
          {
            itemId: item.id,
            ingredientId: cards.find((c) => c.limitedBy)?.limitedBy
              ?.ingredientId,
            screen: 'kitchen.stock',
          },
        );
      } else if (
        best >= 1 &&
        row &&
        !row.is_available &&
        row.auto_reason === 'stock'
      ) {
        await m.query(
          `UPDATE branch_item_overrides SET is_available = true, auto_reason = NULL, updated_at = now()
            WHERE branch_id = $1 AND item_id = $2 AND auto_reason = 'stock'`,
          [branchId, item.id],
        );
        await this.alerts.queue(
          m,
          branchId,
          'back_in_stock',
          `${item.name} is back on your menu`,
          `There is stock for ${best} more.`,
          { itemId: item.id, screen: 'food.vendor.menu' },
        );
      }
    }
  }
}
