import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { IsNumber, Max, Min } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorCode } from '../../common/errors/codes';
import { paged, PaginationQueryDto } from '../../common/pagination/pagination';
import { returned } from '../../common/db/parallel';
import type { VendorRef } from '../food/vendor/food-vendor.service';
import { RecipesService } from '../kitchen/recipes/recipes.service';
import { KitchenJobsService } from '../kitchen/jobs/kitchen-jobs.service';
import { kitchenNotFound } from '../kitchen/common/errors';
import { AiService } from '../ai/ai.service';
import { aiUnavailable } from '../ai/ai-errors';
import { MenuItemNutrition } from './entities/menu-item-nutrition.entity';
import {
  badges,
  fromRecipe,
  MIN_MAPPED_SHARE,
  Nutrients,
  RecipeLineInput,
  round,
} from './nutrition-math';

export class EstimateAnswer {
  @IsNumber() @Min(20) @Max(2000) servingGrams!: number;
  @IsNumber() @Min(10) @Max(3000) kcal!: number;
  @IsNumber() @Min(0) @Max(300) proteinG!: number;
  @IsNumber() @Min(0) @Max(500) carbsG!: number;
  @IsNumber() @Min(0) @Max(300) fatG!: number;
  @IsNumber() @Min(0) @Max(100) fibreG!: number;
  @IsNumber() @Min(0) @Max(10000) sodiumMg!: number;
  @IsNumber() @Min(0) @Max(1) confidence!: number;
}
const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    [
      'servingGrams',
      'kcal',
      'proteinG',
      'carbsG',
      'fatG',
      'fibreG',
      'sodiumMg',
      'confidence',
    ].map((k) => [k, { type: 'number' }]),
  ),
  required: [
    'servingGrams',
    'kcal',
    'proteinG',
    'carbsG',
    'fatG',
    'fibreG',
    'sodiumMg',
    'confidence',
  ],
};

/** A recipe-based value is this sure; an AI estimate is never surer than ESTIMATE_MAX. */
export const RECIPE_CONFIDENCE = 0.9;
export const ESTIMATE_MAX_CONFIDENCE = 0.4;
const MANUAL =
  'Map the recipe card’s ingredients (80% of its weight) to show nutrition from the recipe.';

export const nutritionLabel = (method: string) =>
  method === 'recipe'
    ? 'Estimated from the kitchen’s recipe'
    : 'AI estimate — low confidence';

/**
 * A dish's nutrition (Chunk 5, P10): from the recipe card when ≥ 80% of its
 * weight is mapped to confirmed reference foods, else — on the vendor's
 * request — an AI estimate (nutrition_estimate@1) capped at low confidence.
 * Recomputed when a card or a mapping changes, and nightly.
 */
@Injectable()
export class ItemNutritionService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly recipes: RecipesService,
    private readonly jobs: KitchenJobsService,
  ) {}

  onModuleInit(): void {
    this.recipes.saved.push(async (_v, itemId) => {
      await this.compute(this.dataSource.manager, itemId);
    });
    this.jobs.nightly.push({ name: 'nutrition', run: () => this.nightly() });
  }

  /** The base card's food lines (no packaging, no add-ons), with their mapped reference food. */
  private async recipeLines(m: EntityManager, itemId: string) {
    const [card] = await m.query(
      `SELECT id, yield_servings FROM recipe_cards WHERE menu_item_id = $1 ORDER BY variant_id NULLS FIRST LIMIT 1`,
      [itemId],
    );
    if (!card) return null;
    const rows = await m.query(
      `SELECT ki.name, rl.qty_base, ki.base_unit, ki.nutrition_confirmed, ki.nutrition_piece_grams,
              nf.kcal, nf.protein_g, nf.carbs_g, nf.fat_g, nf.fibre_g, nf.sodium_mg, nf.piece_grams
         FROM recipe_lines rl JOIN kitchen_ingredients ki ON ki.id = rl.ingredient_id
         LEFT JOIN nutrition_foods nf ON nf.id = ki.nutrition_food_id AND nf.is_active
        WHERE rl.recipe_card_id = $1 AND NOT rl.is_packaging AND rl.option_id IS NULL AND ki.category <> 'packaging'`,
      [card.id],
    );
    const lines: RecipeLineInput[] = rows.map((r: any) => ({
      name: r.name,
      qtyBase: Number(r.qty_base),
      baseUnit: r.base_unit,
      food:
        r.nutrition_confirmed && r.kcal !== null
          ? {
              kcal: Number(r.kcal),
              proteinG: Number(r.protein_g),
              carbsG: Number(r.carbs_g),
              fatG: Number(r.fat_g),
              fibreG: Number(r.fibre_g),
              sodiumMg: Number(r.sodium_mg),
            }
          : null,
      pieceGrams:
        r.nutrition_piece_grams !== null
          ? Number(r.nutrition_piece_grams)
          : r.piece_grams !== null
            ? Number(r.piece_grams)
            : null,
    }));
    return { lines, yieldServings: card.yield_servings as number };
  }

  private async save(
    m: EntityManager,
    itemId: string,
    n: Nutrients & { servingGrams: number | null },
    method: 'recipe' | 'ai_estimate',
    confidence: number,
    mappedShare: number | null,
  ) {
    const [item] = await m.query(`SELECT tags FROM menu_items WHERE id = $1`, [
      itemId,
    ]);
    await m.query(
      `INSERT INTO menu_item_nutrition (menu_item_id, kcal, protein_g, carbs_g, fat_g, fibre_g, sodium_mg, serving_grams,
              method, confidence, mapped_share, badges, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (menu_item_id) DO UPDATE SET kcal = EXCLUDED.kcal, protein_g = EXCLUDED.protein_g,
              carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g, fibre_g = EXCLUDED.fibre_g,
              sodium_mg = EXCLUDED.sodium_mg, serving_grams = EXCLUDED.serving_grams, method = EXCLUDED.method,
              confidence = EXCLUDED.confidence, mapped_share = EXCLUDED.mapped_share, badges = EXCLUDED.badges,
              computed_at = now(), updated_at = now()`,
      [
        itemId,
        n.kcal,
        n.proteinG,
        n.carbsG,
        n.fatG,
        n.fibreG,
        n.sodiumMg,
        n.servingGrams,
        method,
        confidence,
        mappedShare,
        badges(n, item?.tags ?? []),
      ],
    );
  }

  /**
   * From the recipe when it can be; a recipe-based row that no longer can
   * is removed (an AI estimate stays until the recipe takes over).
   */
  async compute(m: EntityManager, itemId: string) {
    const recipe = await this.recipeLines(m, itemId);
    const r = recipe ? fromRecipe(recipe.lines, recipe.yieldServings) : null;
    if (r?.usable) {
      await this.save(
        m,
        itemId,
        { ...r.perServing, servingGrams: r.servingGrams },
        'recipe',
        RECIPE_CONFIDENCE,
        r.mappedShare,
      );
      return { method: 'recipe' as const, recipe: r };
    }
    await m.query(
      `DELETE FROM menu_item_nutrition WHERE menu_item_id = $1 AND method = 'recipe'`,
      [itemId],
    );
    return { method: null, recipe: r };
  }

  private async ownItem(v: VendorRef, itemId: string) {
    const [item] = await this.dataSource.query(
      `SELECT mi.id, mi.name, mi.description, mi.tags, mi.serves, c.name AS category
         FROM menu_items mi JOIN menu_categories c ON c.id = mi.category_id
        WHERE mi.id = $1 AND mi.brand_id = $2`,
      [itemId, v.brandId],
    );
    if (!item) throw kitchenNotFound('Item');
    return item;
  }

  private async stored(itemId: string) {
    return this.dataSource
      .getRepository(MenuItemNutrition)
      .findOne({ where: { menuItemId: itemId } });
  }

  private shape(n: MenuItemNutrition | null) {
    if (!n) return null;
    return {
      perServing: {
        kcal: Math.round(n.kcal),
        proteinG: n.proteinG,
        carbsG: n.carbsG,
        fatG: n.fatG,
        fibreG: n.fibreG,
        sodiumMg: Math.round(n.sodiumMg),
      },
      servingGrams: n.servingGrams,
      method: n.method,
      confidence: n.confidence,
      lowConfidence: n.method === 'ai_estimate',
      label: nutritionLabel(n.method),
      mappedShare: n.mappedShare,
      badges: n.badges,
      hidden: n.hidden,
      computedAt: n.computedAt,
    };
  }

  /** GET /items/:itemId/nutrition (recomputed from the recipe first). */
  async view(v: VendorRef, itemId: string) {
    await this.ownItem(v, itemId);
    const c = await this.compute(this.dataSource.manager, itemId);
    return {
      itemId,
      nutrition: this.shape(await this.stored(itemId)),
      recipe: c.recipe
        ? {
            mappedShare: c.recipe.mappedShare,
            needed: MIN_MAPPED_SHARE,
            usable: c.recipe.usable,
            unmapped: c.recipe.unmapped,
          }
        : null,
    };
  }

  /** POST /items/:itemId/nutrition/estimate — the recipe if it can, else an AI estimate (low confidence). */
  async estimate(v: VendorRef, itemId: string) {
    const item = await this.ownItem(v, itemId);
    const c = await this.compute(this.dataSource.manager, itemId);
    if (c.method === 'recipe') return this.view(v, itemId);
    if (!this.ai.usable('nutrition')) throw aiUnavailable(MANUAL, 'disabled');
    const sizes = await this.dataSource.query(
      `SELECT name FROM item_variants WHERE item_id = $1 ORDER BY sort`,
      [itemId],
    );
    const out = await this.ai.json({
      feature: 'nutrition',
      promptId: 'nutrition_estimate',
      input: {
        name: item.name,
        description: item.description,
        category: item.category,
        serves: item.serves,
        sizes: sizes.map((s: { name: string }) => s.name),
        tags: item.tags,
        ingredients: c.recipe ? c.recipe.unmapped : [],
      },
      schema: ESTIMATE_SCHEMA,
      dto: EstimateAnswer,
      check: (a) => {
        const atwater = 4 * a.proteinG + 4 * a.carbsG + 9 * a.fatG;
        return Math.abs(atwater - a.kcal) > Math.max(60, a.kcal * 0.25)
          ? [`kcal ${a.kcal} doesn't fit the macros (≈ ${Math.round(atwater)})`]
          : [];
      },
      actor: { businessId: v.businessId, userId: v.ownerUserId },
      cacheSeconds: 7 * 86_400,
      temperature: 0.2,
    });
    if (!out.ok) throw this.ai.failure(out, MANUAL);
    const a = out.data;
    await this.save(
      this.dataSource.manager,
      itemId,
      {
        ...round({
          kcal: a.kcal,
          proteinG: a.proteinG,
          carbsG: a.carbsG,
          fatG: a.fatG,
          fibreG: a.fibreG,
          sodiumMg: a.sodiumMg,
        }),
        servingGrams: Math.round(a.servingGrams),
      },
      'ai_estimate',
      Math.min(a.confidence, ESTIMATE_MAX_CONFIDENCE),
      c.recipe?.mappedShare ?? null,
    );
    return this.view(v, itemId);
  }

  async hide(v: VendorRef, itemId: string, hidden: boolean) {
    await this.ownItem(v, itemId);
    const res = await this.dataSource.query(
      `UPDATE menu_item_nutrition SET hidden = $2, updated_at = now() WHERE menu_item_id = $1 RETURNING id`,
      [itemId, hidden],
    );
    if (!returned(res).length)
      throw new ConflictException({
        code: ErrorCode.NUTRITION_UNAVAILABLE,
        message: 'This dish has no nutrition yet.',
      });
    return this.view(v, itemId);
  }

  /** GET /nutrition/items — every dish, with its nutrition (or why not). */
  async list(v: VendorRef, q: PaginationQueryDto) {
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM menu_items WHERE brand_id = $1`,
      [v.brandId],
    );
    const rows = await this.dataSource.query(
      `SELECT mi.id, mi.name, mi.is_active, n.kcal, n.protein_g, n.method, n.confidence, n.badges, n.hidden,
              EXISTS (SELECT 1 FROM recipe_cards rc WHERE rc.menu_item_id = mi.id) AS has_recipe
         FROM menu_items mi LEFT JOIN menu_item_nutrition n ON n.menu_item_id = mi.id
        WHERE mi.brand_id = $1 ORDER BY mi.sort, mi.name LIMIT $2 OFFSET $3`,
      [v.brandId, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return paged(
      rows.map((r: any) => ({
        itemId: r.id,
        name: r.name,
        isActive: r.is_active,
        hasRecipe: r.has_recipe,
        kcal: r.kcal === null ? null : Math.round(Number(r.kcal)),
        proteinG: r.protein_g === null ? null : Number(r.protein_g),
        method: r.method,
        label: r.method ? nutritionLabel(r.method) : null,
        badges: r.badges ?? [],
        hidden: r.hidden ?? false,
      })),
      total,
      q,
    );
  }

  /** Recompute every dish of a kitchen (after a mapping change). */
  async recomputeBrand(m: EntityManager, brandId: string) {
    const items: Array<{ id: string }> = await m.query(
      `SELECT DISTINCT mi.id FROM menu_items mi JOIN recipe_cards rc ON rc.menu_item_id = mi.id WHERE mi.brand_id = $1`,
      [brandId],
    );
    let recipe = 0;
    for (const i of items) if ((await this.compute(m, i.id)).method) recipe++;
    return { items: items.length, recipe };
  }

  /** Nightly: every dish with a recipe card (idempotent: a full recompute). */
  async nightly() {
    const brands: Array<{ brand_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT mi.brand_id FROM recipe_cards rc JOIN menu_items mi ON mi.id = rc.menu_item_id`,
    );
    let items = 0;
    for (const b of brands)
      items += (await this.recomputeBrand(this.dataSource.manager, b.brand_id))
        .items;
    return { kitchens: brands.length, items };
  }
}
