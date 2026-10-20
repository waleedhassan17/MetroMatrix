import { BadRequestException, Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { addDays, todayIn } from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { MenuService } from '../../food/menu/menu.service';
import { MediaService } from '../../media/media.service';
import { MediaStorage } from '../../media/media-storage';
import { AiService } from '../../ai/ai.service';
import { aiUnavailable } from '../../ai/ai-errors';
import { CostingService } from '../costing/costing.service';
import { RecipesService } from '../recipes/recipes.service';
import { kitchenNotFound } from '../common/errors';
import { display, round4, toBase } from '../stock/units';
import { isUrduScript, menuTextProblems } from './text-rules';
import { bundlePrice, COMBO_MIN_ORDERS, topPairs } from './combos';
import { decodeImage, measure, photoTips } from './photo-metrics';
import { CreateSpecialDto, PhotoCheckDto } from '../dto/assistant.dto';

// ── The answers the model must give (validated before use) ──

export class DescribeAnswer {
  @IsString() @Length(40, 160) en!: string;
  @IsString() @Length(20, 160) ur!: string;
}
export const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: { en: { type: 'string' }, ur: { type: 'string' } },
  required: ['en', 'ur'],
};

class SpecialLineAnswer {
  @IsUUID() ingredientId!: string;
  @IsNumber() @Min(0.001) @Max(100000) qty!: number;
  @IsIn(['g', 'kg', 'ml', 'l', 'piece', 'dozen']) unit!: string;
}
class SpecialIdeaAnswer {
  @IsString() @Length(2, 60) name!: string;
  @IsString() @Length(10, 160) description!: string;
  @IsInt() @Min(1) @Max(50) servings!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => SpecialLineAnswer)
  lines!: SpecialLineAnswer[];
  @IsString() @MaxLength(200) why!: string;
}
export class SpecialsAnswer {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => SpecialIdeaAnswer)
  ideas!: SpecialIdeaAnswer[];
}
export const SPECIALS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          servings: { type: 'integer' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ingredientId: { type: 'string' },
                qty: { type: 'number' },
                unit: {
                  type: 'string',
                  enum: ['g', 'kg', 'ml', 'l', 'piece', 'dozen'],
                },
              },
              required: ['ingredientId', 'qty', 'unit'],
            },
          },
          why: { type: 'string' },
        },
        required: ['name', 'description', 'servings', 'lines', 'why'],
      },
    },
  },
  required: ['ideas'],
};

class ComboNameAnswer {
  @IsString() @MaxLength(80) key!: string;
  @IsString() @Length(2, 40) name!: string;
  @IsString() @Length(5, 120) description!: string;
}
export class CombosAnswer {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ComboNameAnswer)
  combos!: ComboNameAnswer[];
}
export const COMBOS_SCHEMA = {
  type: 'object',
  properties: {
    combos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['key', 'name', 'description'],
      },
    },
  },
  required: ['combos'],
};

export class PhotoTipsAnswer {
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  tips!: string[];
  @IsBoolean() looksLikeFood!: boolean;
  @IsOptional() @IsBoolean() matchesDish?: boolean | null;
}
export const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    tips: { type: 'array', items: { type: 'string' } },
    looksLikeFood: { type: 'boolean' },
    matchesDish: { type: 'boolean', nullable: true },
  },
  required: ['tips', 'looksLikeFood'],
};

/** The menu text rules, in English and in Urdu script. */
export const describeCheck = (a: DescribeAnswer) => [
  ...menuTextProblems('en', a.en),
  ...menuTextProblems('ur', a.ur),
  ...(isUrduScript(a.ur)
    ? []
    : ['ur: write it in Urdu script, not Roman Urdu']),
];
export const specialsCheck = (a: SpecialsAnswer) =>
  a.ideas.flatMap((x, i) =>
    menuTextProblems(`ideas.${i}.description`, x.description),
  );
export const combosCheck = (a: CombosAnswer) =>
  a.combos.flatMap((c) =>
    menuTextProblems(c.key, `${c.name} ${c.description}`),
  );

const DESCRIBE_MANUAL =
  'Write the description yourself on the dish screen (at most 160 characters, no health claims).';
const SPECIALS_MANUAL =
  'Check the expiring ingredients in Stock and plan a special yourself — "Create dish" saves it as inactive.';
/** Ingredients expiring within this many days feed the specials. */
export const SPECIALS_EXPIRY_DAYS = 3;
/** Orders looked at for combos. */
export const COMBO_DAYS = 60;
const SOLD = `('accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'picked_up')`;

const r1 = (n: number) => Math.round(n * 10) / 10;
/** A price from cost and the food cost target, rounded up to Rs 10. */
export const priceForTarget = (cost: number, targetPct: number) =>
  Math.max(10, Math.ceil(cost / (targetPct / 100) / 10) * 10);

/**
 * The menu assistant (Chunk 5, P9). Every answer is a **draft**: describe
 * returns text to save with the ordinary dish PATCH, specials return
 * recipe-backed ideas to create as an inactive dish, combos come from real
 * orders (the AI only names them), and the photo check measures the image
 * itself and adds AI tips when it can. Nothing here saves on its own except
 * the explicit "create this special" call.
 */
@Injectable()
export class MenuAssistantService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly costing: CostingService,
    private readonly recipes: RecipesService,
    private readonly menu: MenuService,
    private readonly media: MediaService,
    private readonly storage: MediaStorage,
  ) {}

  private actor(v: VendorRef) {
    return { businessId: v.businessId, userId: v.ownerUserId };
  }

  private async cuisines(v: VendorRef): Promise<string[]> {
    return (
      await this.dataSource.query(
        `SELECT c.name FROM food_brands fb JOIN cuisines c ON c.id = ANY(fb.cuisine_ids) WHERE fb.id = $1 ORDER BY c.name`,
        [v.brandId],
      )
    ).map((r: { name: string }) => r.name);
  }

  // ── Describe ──

  async describe(v: VendorRef, itemId: string) {
    const [item] = await this.dataSource.query(
      `SELECT mi.id, mi.name, mi.name_ur, mi.description, mi.description_ur, mi.tags, c.name AS category
         FROM menu_items mi JOIN menu_categories c ON c.id = mi.category_id
        WHERE mi.id = $1 AND mi.brand_id = $2`,
      [itemId, v.brandId],
    );
    if (!item) throw kitchenNotFound('Item');
    if (!this.ai.usable('menu_assistant'))
      throw aiUnavailable(DESCRIBE_MANUAL, 'disabled');
    const [sizes, ingredients, cuisines] = await Promise.all([
      this.dataSource.query(
        `SELECT name FROM item_variants WHERE item_id = $1 ORDER BY sort, name`,
        [itemId],
      ),
      this.dataSource.query(
        `SELECT DISTINCT ki.name FROM recipe_cards rc JOIN recipe_lines rl ON rl.recipe_card_id = rc.id AND NOT rl.is_packaging
           JOIN kitchen_ingredients ki ON ki.id = rl.ingredient_id
          WHERE rc.menu_item_id = $1 ORDER BY ki.name`,
        [itemId],
      ),
      this.cuisines(v),
    ]);
    const out = await this.ai.json({
      feature: 'menu_assistant',
      promptId: 'describe',
      input: {
        name: item.name,
        nameUr: item.name_ur,
        category: item.category,
        cuisines,
        sizes: sizes.map((s: { name: string }) => s.name),
        tags: item.tags,
        description: item.description,
        ingredients: ingredients.map((i: { name: string }) => i.name),
      },
      schema: DESCRIBE_SCHEMA,
      dto: DescribeAnswer,
      check: describeCheck,
      actor: this.actor(v),
      cacheSeconds: 86_400,
      temperature: 0.6,
    });
    if (!out.ok) throw this.ai.failure(out, DESCRIBE_MANUAL);
    const draft = { description: out.data.en, descriptionUr: out.data.ur };
    return {
      itemId,
      name: item.name,
      draft,
      current: {
        description: item.description,
        descriptionUr: item.description_ur,
      },
      cached: out.cached,
      /** Nothing is saved until the vendor sends this (after editing). */
      save: {
        method: 'PATCH',
        path: `/food/vendor/menu/items/${itemId}`,
        body: draft,
      },
    };
  }

  // ── Specials ──

  async specials(v: VendorRef, now = new Date()) {
    const [b] = await this.dataSource.query(
      `SELECT timezone, target_food_cost_pct FROM branches WHERE id = $1`,
      [v.branchId],
    );
    const today = todayIn(b.timezone, now);
    const until = addDays(today, SPECIALS_EXPIRY_DAYS);
    const ings: Array<{
      id: string;
      name: string;
      base_unit: 'g' | 'ml' | 'piece';
      custom_units: [];
      avg_cost: string;
      on_hand: string;
      expires_on: string | null;
      expiring_qty: string;
    }> = await this.dataSource.query(
      `SELECT ki.id, ki.name, ki.base_unit, ki.custom_units, ki.avg_cost, ki.on_hand,
              to_char(min(sb.expires_on), 'YYYY-MM-DD') AS expires_on,
              coalesce(sum(sb.qty_remaining) FILTER (WHERE sb.expires_on IS NOT NULL), 0) AS expiring_qty
         FROM kitchen_ingredients ki
         LEFT JOIN stock_batches sb ON sb.ingredient_id = ki.id AND sb.qty_remaining > 0
              AND sb.expires_on >= $2::date AND sb.expires_on <= $3::date
        WHERE ki.branch_id = $1 AND ki.is_active
        GROUP BY ki.id ORDER BY ki.name`,
      [v.branchId, today, until],
    );
    const expiring = ings.filter((i) => i.expires_on);
    const base = {
      days: SPECIALS_EXPIRY_DAYS,
      targetFoodCostPct: b.target_food_cost_pct,
      expiring: expiring.map((i) => ({
        ingredientId: i.id,
        name: i.name,
        expiresOn: i.expires_on,
        expiringQty: display(Number(i.expiring_qty), i.base_unit),
      })),
    };
    if (!expiring.length)
      return {
        ...base,
        ideas: [],
        dropped: 0,
        message: `Nothing expires in the next ${SPECIALS_EXPIRY_DAYS} days.`,
      };
    if (!this.ai.usable('specials'))
      throw aiUnavailable(SPECIALS_MANUAL, 'disabled');
    const [cuisines, dishes] = await Promise.all([
      this.cuisines(v),
      this.dataSource.query(
        `SELECT name FROM menu_items WHERE brand_id = $1 ORDER BY sold_30d DESC LIMIT 60`,
        [v.brandId],
      ),
    ]);
    const out = await this.ai.json({
      feature: 'specials',
      promptId: 'specials',
      input: {
        expiring: expiring.map((i) => ({
          id: i.id,
          name: i.name,
          onHand: display(Number(i.expiring_qty), i.base_unit),
          expiresOn: i.expires_on,
        })),
        pantry: ings
          .filter((i) => !i.expires_on && Number(i.on_hand) > 0)
          .slice(0, 80)
          .map((i) => ({ id: i.id, name: i.name })),
        cuisines,
        existingDishes: dishes.map((d: { name: string }) => d.name),
        targetFoodCostPct: b.target_food_cost_pct,
      },
      schema: SPECIALS_SCHEMA,
      dto: SpecialsAnswer,
      check: specialsCheck,
      actor: this.actor(v),
      temperature: 0.7,
    });
    if (!out.ok) throw this.ai.failure(out, SPECIALS_MANUAL);
    const byId = new Map(ings.map((i) => [i.id, i]));
    const ideas = [];
    let dropped = 0;
    for (const idea of out.data.ideas) {
      // Only the kitchen's own ingredients, in units they can be counted in,
      // and at least one that is expiring — anything else is dropped.
      let cost = 0;
      let ok = idea.lines.every((l) => byId.has(l.ingredientId));
      const lines = [];
      if (ok)
        for (const l of idea.lines) {
          const ing = byId.get(l.ingredientId)!;
          let qtyBase: number;
          try {
            qtyBase = toBase(l.qty, l.unit, {
              baseUnit: ing.base_unit,
              customUnits: ing.custom_units,
            });
          } catch {
            ok = false;
            break;
          }
          cost += qtyBase * Number(ing.avg_cost);
          lines.push({
            ingredientId: ing.id,
            name: ing.name,
            qty: l.qty,
            unit: l.unit,
            expiring: !!ing.expires_on,
          });
        }
      if (!ok || !lines.some((l) => l.expiring)) {
        dropped++;
        continue;
      }
      const perServing = round4(cost / idea.servings);
      const price = priceForTarget(perServing, b.target_food_cost_pct);
      const body = {
        name: idea.name,
        description: idea.description,
        basePrice: price,
        servings: idea.servings,
        lines: lines.map(({ ingredientId, qty, unit }) => ({
          ingredientId,
          qty,
          unit,
        })),
      };
      ideas.push({
        name: idea.name,
        description: idea.description,
        servings: idea.servings,
        why: idea.why,
        lines,
        uses: lines.filter((l) => l.expiring).map((l) => l.name),
        costPerServing: Math.round(perServing),
        suggestedPrice: price,
        foodCostPct: r1((perServing / price) * 100),
        /** One tap: an inactive dish with this recipe card (POST it). */
        create: {
          method: 'POST',
          path: '/food/vendor/kitchen/ai/specials/create',
          body,
        },
      });
    }
    if (!ideas.length) throw aiUnavailable(SPECIALS_MANUAL, 'invalid');
    return { ...base, ideas, dropped };
  }

  /** "Create as item (inactive)": the dish and its recipe card, in one go. */
  async createSpecial(v: VendorRef, dto: CreateSpecialDto) {
    let categoryId = dto.categoryId;
    if (!categoryId) {
      const [c] = await this.dataSource.query(
        `SELECT id FROM menu_categories WHERE brand_id = $1 ORDER BY is_active DESC, sort, name LIMIT 1`,
        [v.brandId],
      );
      if (!c)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Add a menu category first.',
          details: { fields: { categoryId: ['No menu category yet.'] } },
        });
      categoryId = c.id as string;
    }
    // The ingredients must be this kitchen's before anything is written.
    const ids = [...new Set(dto.lines.map((l) => l.ingredientId))];
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM kitchen_ingredients WHERE branch_id = $1 AND id = ANY($2::uuid[])`,
      [v.branchId, ids],
    );
    if (n !== ids.length) throw kitchenNotFound('Ingredient');
    const item = await this.menu.createItem(v, {
      categoryId,
      name: dto.name,
      description: dto.description,
      basePrice: dto.basePrice,
      isActive: false,
    });
    const recipe = await this.recipes.put(v, item.id, undefined, {
      yieldServings: dto.servings,
      notes: 'Created from a menu-assistant special.',
      lines: dto.lines,
    });
    return { item, recipe };
  }

  // ── Combos ──

  async combos(v: VendorRef, now = new Date()) {
    const since = new Date(now.getTime() - COMBO_DAYS * 86_400_000);
    const rows: Array<{ items: string[] }> = await this.dataSource.query(
      `SELECT array_agg(DISTINCT oi.item_id::text) AS items
         FROM food_orders o JOIN food_order_items oi ON oi.order_id = o.id
         JOIN menu_items mi ON mi.id = oi.item_id AND mi.is_active
        WHERE o.brand_id = $1 AND o.created_at >= $2 AND o.status IN ${SOLD}
        GROUP BY o.id`,
      [v.brandId, since],
    );
    const pairs = topPairs(rows.map((r) => r.items));
    const base = {
      days: COMBO_DAYS,
      orders: rows.length,
      minTogether: COMBO_MIN_ORDERS,
    };
    if (!pairs.length)
      return {
        ...base,
        combos: [],
        message: `No two dishes were ordered together ${COMBO_MIN_ORDERS}+ times in the last ${COMBO_DAYS} days.`,
      };
    const ids = [...new Set(pairs.flatMap((p) => p.items))];
    const [items, costs] = await Promise.all([
      this.dataSource.query(
        `SELECT id, name, base_price, category_id FROM menu_items WHERE id = ANY($1::uuid[])`,
        [ids],
      ),
      this.costing.rows(this.dataSource.manager, v, ids, now),
    ]);
    const item = new Map<
      string,
      { id: string; name: string; base_price: number; category_id: string }
    >(items.map((i: { id: string }) => [i.id, i]));
    const costOf = (id: string) =>
      costs.find((c) => c.itemId === id && c.variantId === null)?.cost ??
      costs.find((c) => c.itemId === id)?.cost ??
      null;
    const combos = pairs.map((p, i) => {
      const [a, b] = p.items.map((id) => item.get(id)!);
      const prices = [a.base_price, b.base_price];
      const price = bundlePrice(prices);
      const ca = costOf(a.id);
      const cb = costOf(b.id);
      const cost = ca !== null && cb !== null ? Math.round(ca + cb) : null;
      return {
        key: `c${i + 1}`,
        items: [a, b].map((x) => ({
          itemId: x.id,
          name: x.name,
          price: x.base_price,
        })),
        together: p.together,
        supportPct: p.supportPct,
        lift: p.lift,
        price: prices[0] + prices[1],
        bundlePrice: price,
        cost,
        margin: cost !== null ? price - cost : null,
        foodCostPct: cost !== null ? r1((cost / price) * 100) : null,
        name: `${a.name} + ${b.name}`.slice(0, 60),
        description: null as string | null,
        named: 'rules' as 'rules' | 'ai',
        categoryId: a.category_id,
      };
    });
    if (this.ai.usable('combos')) {
      const out = await this.ai.json({
        feature: 'combos',
        promptId: 'combos',
        input: {
          combos: combos.map((c) => ({
            key: c.key,
            items: c.items.map((x) => x.name),
          })),
          cuisines: await this.cuisines(v),
        },
        schema: COMBOS_SCHEMA,
        dto: CombosAnswer,
        check: combosCheck,
        actor: this.actor(v),
        cacheSeconds: 86_400,
        temperature: 0.7,
      });
      // AI only words them; without it the dish names stand.
      if (out.ok)
        for (const named of out.data.combos) {
          const c = combos.find((x) => x.key === named.key);
          if (!c) continue;
          c.name = named.name;
          c.description = named.description;
          c.named = 'ai';
        }
    }
    return {
      ...base,
      combos: combos.map(({ categoryId, ...c }) => ({
        ...c,
        /** A suggestion: create it as a deal dish if you like it. */
        draft: {
          method: 'POST',
          path: '/food/vendor/menu/items',
          body: {
            categoryId,
            name: c.name.slice(0, 120),
            description:
              c.description ?? `${c.items[0].name} with ${c.items[1].name}.`,
            basePrice: c.bundlePrice,
            isDeal: true,
            isActive: false,
          },
        },
      })),
    };
  }

  // ── Photo check ──

  async photoCheck(v: VendorRef, dto: PhotoCheckDto) {
    this.media.assertOwnedAsset(
      v.ownerUserId,
      'menu_item',
      dto.imageUrl,
      undefined,
      'imageUrl',
    );
    let dish: string | null = null;
    if (dto.itemId) {
      const [it] = await this.dataSource.query(
        `SELECT name FROM menu_items WHERE id = $1 AND brand_id = $2`,
        [dto.itemId, v.brandId],
      );
      if (!it) throw kitchenNotFound('Item');
      dish = it.name;
    }
    const unreadable = (message: string) =>
      new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message,
        details: { fields: { imageUrl: [message] } },
      });
    const file = await this.storage.fetch(dto.imageUrl, 8_000_000);
    if (!file)
      throw unreadable('The photo couldn’t be read — upload it again.');
    if (file === 'too_large') throw unreadable('The photo is over 8 MB.');
    const img = decodeImage(file.bytes);
    if (!img)
      throw unreadable(
        'Check a JPG or PNG photo (HEIC and WebP can’t be measured).',
      );
    const metrics = measure(img);
    const verdict = photoTips(metrics);
    let ai: PhotoTipsAnswer | null = null;
    if (this.ai.usable('photo_check')) {
      const out = await this.ai.vision({
        feature: 'photo_check',
        promptId: 'photo_tips',
        input: { dish, metrics, problems: verdict.problems },
        imageUrls: [dto.imageUrl],
        schema: PHOTO_SCHEMA,
        dto: PhotoTipsAnswer,
        actor: this.actor(v),
        cacheSeconds: 86_400,
        temperature: 0.3,
      });
      if (out.ok) ai = out.data;
    }
    return {
      metrics,
      ...verdict,
      aiTips: ai?.tips ?? null,
      looksLikeFood: ai?.looksLikeFood ?? null,
      matchesDish: ai ? (ai.matchesDish ?? null) : null,
      source: ai ? 'measured+ai' : 'measured',
    };
  }
}
