import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { RecipeCard } from '../entities/recipe-card.entity';
import { RecipeLine } from '../entities/recipe-line.entity';
import { RecipeDto } from '../dto/stock.dto';
import { kitchenNotFound } from '../common/errors';
import { StockAvailabilityService } from '../stock/stock-availability.service';
import { KitchenAlertsService } from '../stock/kitchen-alerts.service';
import { round4, toBase } from '../stock/units';
import { todayIn } from '../../../common/time/time.util';

/**
 * Recipe cards: what a dish (or one size of it) uses. Saving a card
 * re-checks the dish against stock straight away, so a card for something
 * the kitchen has run out of makes it sold out.
 */
@Injectable()
export class RecipesService {
  /** Told after a card is saved or removed (nutrition recomputes, P10). Never fails the save. */
  readonly saved: Array<(v: VendorRef, itemId: string) => Promise<void>> = [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: StockAvailabilityService,
    private readonly alerts: KitchenAlertsService,
  ) {}

  async ownedItem(
    m: EntityManager,
    v: VendorRef,
    itemId: string,
    variantId?: string,
  ) {
    const [item] = await m.query(
      `SELECT id, name FROM menu_items WHERE id = $1 AND brand_id = $2`,
      [itemId, v.brandId],
    );
    if (!item) throw kitchenNotFound('Item');
    if (variantId) {
      const [variant] = await m.query(
        `SELECT id FROM item_variants WHERE id = $1 AND item_id = $2`,
        [variantId, itemId],
      );
      if (!variant) throw kitchenNotFound('Variant');
    }
    return item as { id: string; name: string };
  }

  async get(
    v: VendorRef,
    itemId: string,
    variantId?: string,
    m: EntityManager = this.dataSource.manager,
  ) {
    await this.ownedItem(m, v, itemId, variantId);
    const card = await m.findOne(RecipeCard, {
      where: {
        menuItemId: itemId,
        variantId: variantId ?? (null as unknown as undefined),
      },
    });
    if (!card) return null;
    return this.view(m, card);
  }

  async put(
    v: VendorRef,
    itemId: string,
    variantId: string | undefined,
    dto: RecipeDto,
  ) {
    await this.dataSource.transaction(async (m) => {
      const item = await this.ownedItem(m, v, itemId, variantId);
      const ids = [...new Set(dto.lines.map((l) => l.ingredientId))];
      const ings: Array<{
        id: string;
        base_unit: 'g' | 'ml' | 'piece';
        custom_units: [];
      }> = await m.query(
        `SELECT id, base_unit, custom_units FROM kitchen_ingredients WHERE branch_id = $1 AND id = ANY($2::uuid[])`,
        [v.branchId, ids],
      );
      if (ings.length !== ids.length) throw kitchenNotFound('Ingredient');
      const optionIds = [
        ...new Set(dto.lines.map((l) => l.optionId).filter(Boolean)),
      ] as string[];
      if (optionIds.length) {
        const [{ n }] = await m.query(
          `SELECT count(DISTINCT o.id)::int AS n FROM options o
             JOIN item_option_groups l ON l.group_id = o.group_id AND l.item_id = $1
            WHERE o.id = ANY($2::uuid[])`,
          [itemId, optionIds],
        );
        if (n !== optionIds.length) throw kitchenNotFound('Option');
      }
      let card = await m.findOne(RecipeCard, {
        where: {
          menuItemId: itemId,
          variantId: variantId ?? (null as unknown as undefined),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!card)
        card = await m.save(
          m.create(RecipeCard, {
            menuItemId: itemId,
            variantId: variantId ?? null,
            yieldServings: dto.yieldServings ?? 1,
            notes: dto.notes ?? null,
          }),
        );
      else
        await m.update(
          RecipeCard,
          { id: card.id },
          {
            yieldServings: dto.yieldServings ?? card.yieldServings,
            notes: dto.notes !== undefined ? dto.notes : card.notes,
          },
        );
      await m.delete(RecipeLine, { recipeCardId: card.id });
      await m.insert(
        RecipeLine,
        dto.lines.map((l, i) => {
          const ing = ings.find((x) => x.id === l.ingredientId)!;
          return {
            recipeCardId: card!.id,
            ingredientId: l.ingredientId,
            qty: l.qty,
            unit: l.unit,
            qtyBase: toBase(l.qty, l.unit, {
              baseUnit: ing.base_unit,
              customUnits: ing.custom_units,
            }),
            optionId: l.optionId ?? null,
            isPackaging: l.isPackaging ?? false,
            sort: i,
          };
        }),
      );
      await this.availability.syncItems(m, v.branchId, [item]);
    });
    await this.alerts.flush(v.branchId);
    await this.tellSaved(v, itemId);
    return this.get(v, itemId, variantId);
  }

  private async tellSaved(v: VendorRef, itemId: string) {
    for (const f of this.saved)
      try {
        await f(v, itemId);
      } catch {
        /* the card is saved either way */
      }
  }

  /**
   * The signature badge on a dish (Chunk 5, P7): the vendor's own recipe,
   * by whom and since when. It needs the recipe card; a new claim clears a
   * staff removal (and goes back on the staff moderation list).
   */
  async signature(
    v: VendorRef,
    itemId: string,
    variantId: string | undefined,
    dto: { isSignature: boolean; by?: string | null; since?: string | null },
    now = new Date(),
  ) {
    const m = this.dataSource.manager;
    await this.ownedItem(m, v, itemId, variantId);
    const card = await m.findOne(RecipeCard, {
      where: {
        menuItemId: itemId,
        variantId: variantId ?? (null as unknown as undefined),
      },
    });
    if (!card) throw kitchenNotFound('Recipe card');
    if (dto.isSignature) {
      const [b] = await m.query(
        `SELECT fb.name, br.timezone FROM food_brands fb JOIN branches br ON br.id = $2 WHERE fb.id = $1`,
        [v.brandId, v.branchId],
      );
      await m.update(
        RecipeCard,
        { id: card.id },
        {
          isSignature: true,
          signatureBy: dto.by ?? card.signatureBy ?? b.name,
          signatureSince:
            dto.since ?? card.signatureSince ?? todayIn(b.timezone, now),
          signatureRemovedAt: null,
          signatureRemovedReason: null,
        },
      );
    } else
      await m.update(
        RecipeCard,
        { id: card.id },
        { isSignature: false, signatureBy: null, signatureSince: null },
      );
    return this.get(v, itemId, variantId);
  }

  async remove(v: VendorRef, itemId: string, variantId?: string) {
    await this.ownedItem(this.dataSource.manager, v, itemId, variantId);
    const res = await this.dataSource.manager.delete(RecipeCard, {
      menuItemId: itemId,
      variantId: variantId ?? (null as unknown as undefined),
    });
    if (!res.affected) throw kitchenNotFound('Recipe card');
    await this.tellSaved(v, itemId);
    return { removed: true };
  }

  async servings(v: VendorRef, itemId: string) {
    const item = await this.ownedItem(this.dataSource.manager, v, itemId);
    const cards =
      (
        await this.availability.cardServings(this.dataSource.manager, [itemId])
      ).get(itemId) ?? [];
    const known = cards
      .filter((c) => c.servings !== null)
      .map((c) => c.servings!);
    return {
      itemId,
      name: item.name,
      hasRecipe: cards.length > 0,
      /** The most any one size can make right now (null: no card, or no counted lines). */
      servings: known.length ? Math.max(...known) : null,
      cards,
    };
  }

  /** Cards with their lines, names and today's cost per serving at average cost. */
  async view(m: EntityManager, card: RecipeCard) {
    const lines = await m.query(
      `SELECT rl.id, rl.ingredient_id, ki.name, ki.base_unit, ki.avg_cost, rl.qty, rl.unit, rl.qty_base,
              rl.option_id, o.name AS option_name, rl.is_packaging
         FROM recipe_lines rl JOIN kitchen_ingredients ki ON ki.id = rl.ingredient_id
         LEFT JOIN options o ON o.id = rl.option_id
        WHERE rl.recipe_card_id = $1 ORDER BY rl.sort`,
      [card.id],
    );
    const servings =
      (await this.availability.cardServings(m, [card.menuItemId])).get(
        card.menuItemId,
      ) ?? [];
    const mine = servings.find((s) => s.cardId === card.id);
    const viewLines = lines.map((l: any) => {
      const perServing = Number(l.qty_base) / card.yieldServings;
      return {
        id: l.id,
        ingredientId: l.ingredient_id,
        name: l.name,
        qty: Number(l.qty),
        unit: l.unit,
        qtyBase: Number(l.qty_base),
        baseUnit: l.base_unit,
        optionId: l.option_id,
        optionName: l.option_name,
        isPackaging: l.is_packaging,
        costPerServing: round4(perServing * Number(l.avg_cost)),
      };
    });
    return {
      id: card.id,
      itemId: card.menuItemId,
      variantId: card.variantId,
      yieldServings: card.yieldServings,
      notes: card.notes,
      isSignature: card.isSignature,
      signatureBy: card.signatureBy,
      signatureSince: card.signatureSince,
      signatureRemovedAt: card.signatureRemovedAt,
      signatureRemovedReason: card.signatureRemovedReason,
      lines: viewLines,
      /** Base lines (add-ons excluded), at today's average cost; rupees. */
      costPerServing: Math.round(
        viewLines
          .filter((l: any) => !l.optionId)
          .reduce((s: number, l: any) => s + l.costPerServing, 0),
      ),
      servings: mine?.servings ?? null,
      limitedBy: mine?.limitedBy ?? null,
    };
  }
}
