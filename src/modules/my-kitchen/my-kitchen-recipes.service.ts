import { Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
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
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  likeEscape,
  VISIBLE_PRODUCT_SQL,
  PRODUCT_FROM_SQL,
} from '../shopping/common/catalog-sql';
import { effectivePack, pricePerUnit } from '../shopping/common/pack';
import { AiService } from '../ai/ai.service';
import { PantryItem } from './entities/pantry-item.entity';
import { MissingToBagDto } from './dto/my-kitchen.dto';
import { PantryService } from './pantry.service';
import {
  EXPIRING_DAYS,
  PantryInput,
  rankLibrary,
  STAPLES,
} from './recipe-library';

class PantryRecipeAnswer {
  @IsString() @Length(2, 60) title!: string;
  @IsOptional() @IsString() @MaxLength(60) titleUr?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  @IsUUID('all', { each: true })
  uses!: string[];
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  missing!: string[];
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  steps!: string[];
  @IsInt() @Min(5) @Max(180) minutes!: number;
  @IsInt() @Min(1) @Max(12) servings!: number;
  @IsString() @MaxLength(200) why!: string;
}
export class PantryRecipesAnswer {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PantryRecipeAnswer)
  recipes!: PantryRecipeAnswer[];
}
const RECIPES_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          titleUr: { type: 'string' },
          uses: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          minutes: { type: 'integer' },
          servings: { type: 'integer' },
          why: { type: 'string' },
        },
        required: [
          'title',
          'uses',
          'missing',
          'steps',
          'minutes',
          'servings',
          'why',
        ],
      },
    },
  },
  required: ['recipes'],
};

/** A pantry's AI suggestions are reused for this long (same pantry, same answer). */
export const PANTRY_CACHE_SECONDS = 6 * 3600;

/**
 * "What can I cook?" and "what's missing, cheapest per kg?" (Chunk 5, P11).
 * Suggestions prefer what expires soonest — pantry_recipes@1 when AI is on,
 * otherwise the recipe library (pure ranking) — and mark what is missing.
 * Missing-to-bag finds Shopping grocery products for those names, sorted by
 * price per kg / l / piece; nothing is added to the bag without the person.
 */
@Injectable()
export class MyKitchenRecipesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly pantry: PantryService,
  ) {}

  private async items(user: AuthenticatedUser, now: Date) {
    const rows = await this.dataSource
      .getRepository(PantryItem)
      .createQueryBuilder('p')
      .where(`p.user_id = :u AND p.status = 'active'`, { u: user.id })
      .orderBy('p.expiresOn', 'ASC', 'NULLS LAST')
      .addOrderBy('p.name', 'ASC')
      .take(60)
      .getMany();
    return rows.map((r) => this.pantry.view(r, now));
  }

  private extras(title: string, missing: string[]) {
    return {
      notCooking: {
        label: 'Not cooking today? Order it',
        path: `/food/search?q=${encodeURIComponent(title)}`,
      },
      missingToBag: missing.length
        ? {
            method: 'POST',
            path: '/my-kitchen/missing-to-bag',
            body: { items: missing.map((name) => ({ name })) },
          }
        : null,
    };
  }

  async suggest(user: AuthenticatedUser, now = new Date()) {
    const pantry = await this.items(user, now);
    if (!pantry.length)
      return {
        source: 'library',
        recipes: [],
        message: 'Add what you have at home to get recipe ideas.',
      };
    const byId = new Map(pantry.map((p) => [p.id, p]));
    const use = (id: string) => {
      const p = byId.get(id)!;
      return {
        pantryItemId: p.id,
        name: p.name,
        expiresOn: p.expiresOn,
        expiring: p.expiring,
      };
    };
    let aiNote: string | null = null;
    if (this.ai.usable('pantry_recipes')) {
      const out = await this.ai.json({
        feature: 'pantry_recipes',
        promptId: 'pantry_recipes',
        input: {
          pantry: pantry.map((p) => ({
            id: p.id,
            name: p.name,
            expiresInDays: p.daysLeft,
          })),
        },
        schema: RECIPES_SCHEMA,
        dto: PantryRecipesAnswer,
        check: (a) =>
          a.recipes.flatMap((r, i) =>
            r.uses
              .filter((id) => !byId.has(id))
              .map((id) => `recipes.${i}.uses: ${id} is not in the pantry`),
          ),
        actor: { businessId: null, userId: user.id },
        cacheSeconds: PANTRY_CACHE_SECONDS,
        temperature: 0.6,
      });
      if (out.ok) {
        const recipes = out.data.recipes
          .map((r) => {
            const uses = [...new Set(r.uses)].map(use);
            const missing = r.missing.filter(
              (m) => !STAPLES.has(m.toLowerCase()),
            );
            return {
              key: null,
              title: r.title,
              titleUr: r.titleUr ?? null,
              uses,
              missing,
              steps: r.steps,
              minutes: r.minutes,
              servings: r.servings,
              why: r.why,
              expiringUsed: uses.filter((u) => u.expiring).length,
              ...this.extras(r.title, missing),
            };
          })
          // What expires first, first — whatever order the model gave.
          .sort(
            (a, b) =>
              b.expiringUsed - a.expiringUsed ||
              a.missing.length - b.missing.length,
          );
        return { source: 'ai', recipes, cached: out.cached };
      }
      aiNote =
        out.reason === 'quota'
          ? 'AI allowance used — ideas from the recipe book.'
          : null;
    }
    const input: PantryInput[] = pantry.map((p) => ({
      id: p.id,
      name: p.name,
      canonical: p.canonical,
      daysLeft: p.daysLeft,
    }));
    return {
      source: 'library',
      ...(aiNote ? { note: aiNote } : {}),
      recipes: rankLibrary(input).map((x) => ({
        key: x.recipe.key,
        title: x.recipe.title,
        titleUr: x.recipe.titleUr,
        uses: x.uses.map((u) => use(u.id)),
        missing: x.missing,
        steps: x.recipe.steps,
        minutes: x.recipe.minutes,
        servings: x.recipe.servings,
        why: x.expiring
          ? `Uses ${x.uses
              .filter((u) => u.daysLeft !== null && u.daysLeft <= EXPIRING_DAYS)
              .map((u) => u.name)
              .join(
                ', ',
              )} before ${x.expiring === 1 ? 'it expires' : 'they expire'}.`
          : `Uses ${x.uses.map((u) => u.name).join(', ')} from your pantry.`,
        expiringUsed: x.expiring,
        ...this.extras(x.recipe.title, x.missing),
      })),
    };
  }

  /**
   * For each missing name: grocery products that match it (its canonical
   * name and aliases), in stock, sorted by price per kg / l / piece (packs
   * without a size last), with whether the store delivers to your city.
   */
  async missingToBag(user: AuthenticatedUser, dto: MissingToBagDto) {
    let city = dto.city ?? null;
    if (!city) {
      const [a] = await this.dataSource.query(
        `SELECT city FROM addresses WHERE user_id = $1 AND is_default LIMIT 1`,
        [user.id],
      );
      city = a?.city ?? null;
    }
    const out = [];
    for (const item of dto.items) {
      const canonical = await this.pantry.canonicalOf(
        this.dataSource.manager,
        item.name,
      );
      const names: string[] = canonical
        ? (
            await this.dataSource.query(
              `SELECT alias FROM ingredient_aliases WHERE canonical = $1 AND lang <> 'ur'`,
              [canonical],
            )
          ).map((r: { alias: string }) => r.alias)
        : [item.name];
      const likes = [
        ...new Set(
          [item.name, ...names].map((n) => `%${likeEscape(n.toLowerCase())}%`),
        ),
      ];
      const rows = await this.dataSource.query(
        `SELECT p.id AS product_id, p.name, p.base_price, p.sale_price, p.pack_qty, p.pack_unit,
                v.id AS variant_id, v.option1, v.option2, v.price_delta, v.pack_qty AS v_pack_qty, v.pack_unit AS v_pack_unit,
                s.id AS store_id, b.name AS store_name, s.slug AS store_slug, s.delivery_cities,
                s.dispatch_days_min, s.dispatch_days_max
           ${PRODUCT_FROM_SQL}
           JOIN product_variants v ON v.product_id = p.id AND v.is_active AND v.stock > 0
           JOIN shop_categories c ON c.id = p.category_id LEFT JOIN shop_categories root ON root.id = c.parent_id
          WHERE ${VISIBLE_PRODUCT_SQL} AND (c.slug = 'grocery' OR root.slug = 'grocery')
            AND (lower(p.name) LIKE ANY($1::text[]) OR word_similarity($2, p.name) >= 0.5)
          LIMIT 60`,
        [likes, canonical ?? item.name],
      );
      const options = rows
        .map((r: any) => {
          const price = (r.sale_price ?? r.base_price) + r.price_delta;
          const pack = effectivePack(
            { packQty: r.pack_qty, packUnit: r.pack_unit },
            { packQty: r.v_pack_qty, packUnit: r.v_pack_unit },
          );
          const cities: string[] = r.delivery_cities ?? [];
          return {
            productId: r.product_id,
            variantId: r.variant_id,
            name: r.name,
            variant: [r.option1, r.option2].filter(Boolean).join(' / ') || null,
            price,
            pack,
            pricePer: pricePerUnit(price, pack),
            store: {
              id: r.store_id,
              name: r.store_name,
              slug: r.store_slug,
              deliversToYou:
                !cities.length ||
                (!!city &&
                  cities.some((c) => c.toLowerCase() === city!.toLowerCase())),
              dispatchDays: {
                min: r.dispatch_days_min,
                max: r.dispatch_days_max,
              },
            },
            addToBag: {
              method: 'POST',
              path: '/shop/cart/items',
              body: { variantId: r.variant_id, quantity: 1 },
            },
          };
        })
        .sort(
          (a: any, b: any) =>
            (a.pricePer === null ? 1 : 0) - (b.pricePer === null ? 1 : 0) ||
            (a.pricePer && b.pricePer && a.pricePer.per === b.pricePer.per
              ? a.pricePer.price - b.pricePer.price
              : 0) ||
            a.price - b.price,
        )
        .slice(0, 5);
      out.push({ name: item.name, canonical, options });
    }
    return { city, items: out };
  }
}
