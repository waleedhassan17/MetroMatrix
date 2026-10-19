import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { paged } from '../../common/pagination/pagination';
import { returned } from '../../common/db/parallel';
import type { VendorRef } from '../food/vendor/food-vendor.service';
import { kitchenNotFound } from '../kitchen/common/errors';
import { NutritionFood } from './entities/nutrition-food.entity';
import { FoodsQueryDto, MapIngredientDto } from './dto/nutrition.dto';
import { ItemNutritionService } from './item-nutrition.service';
import { NON_FOOD_CANONICALS } from '../../database/seeds/nutrition/nutrition-foods.data';

/** A name match this close (pg_trgm word similarity) is offered when no alias matches. */
const NAME_MATCH = 0.5;

export const foodView = (f: NutritionFood) => ({
  id: f.id,
  key: f.key,
  name: f.name,
  nameUr: f.nameUr,
  group: f.foodGroup,
  per100g: {
    kcal: f.kcal,
    proteinG: f.proteinG,
    carbsG: f.carbsG,
    fatG: f.fatG,
    fibreG: f.fibreG,
    sodiumMg: f.sodiumMg,
  },
  pieceGrams: f.pieceGrams,
  source: f.source,
  fdcId: f.fdcId,
  note: f.note,
});

/**
 * Ingredient → reference food. Suggested automatically (the kitchen's
 * canonical name through ingredient_aliases, else a close name), and used
 * for nutrition only once the vendor confirms it.
 */
@Injectable()
export class NutritionMappingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly items: ItemNutritionService,
  ) {}

  async foods(q: FoodsQueryDto) {
    const qb = this.dataSource
      .getRepository(NutritionFood)
      .createQueryBuilder('f')
      .where('f.is_active');
    if (q.q)
      qb.andWhere(
        `(f.name ILIKE :like OR f.name_ur = :q OR :q = ANY(f.canonicals) OR word_similarity(:q, f.name) >= 0.4)`,
        { like: `%${q.q.replace(/[%_\\]/g, '\\$&')}%`, q: q.q.toLowerCase() },
      );
    const [rows, total] = await qb
      .orderBy('f.name', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(rows.map(foodView), total, q);
  }

  /** Suggestions for a kitchen's ingredients: alias → canonical → food, else the closest name. */
  private async suggestions(branchId: string) {
    const rows: Array<{
      id: string;
      food_id: string | null;
      via: string | null;
      score: number | null;
      non_food: boolean;
    }> = await this.dataSource.query(
      `SELECT ki.id,
              coalesce(byalias.id, byname.id) AS food_id,
              CASE WHEN byalias.id IS NOT NULL THEN 'alias' WHEN byname.id IS NOT NULL THEN 'name' END AS via,
              byname.score,
              (ki.category = 'packaging' OR canon.canonical = ANY($2::text[])) AS non_food
         FROM kitchen_ingredients ki
         LEFT JOIN LATERAL (
           SELECT ia.canonical FROM ingredient_aliases ia
            WHERE lower(ia.alias) = lower(ki.name) OR (ki.name_ur IS NOT NULL AND ia.alias = ki.name_ur)
            LIMIT 1) canon ON true
         LEFT JOIN LATERAL (
           SELECT nf.id FROM nutrition_foods nf
            WHERE nf.is_active AND (canon.canonical = ANY(nf.canonicals) OR lower(ki.name) = ANY(nf.canonicals))
            LIMIT 1) byalias ON true
         LEFT JOIN LATERAL (
           SELECT nf.id, word_similarity(lower(ki.name), lower(nf.name)) AS score FROM nutrition_foods nf
            WHERE nf.is_active AND byalias.id IS NULL
            ORDER BY word_similarity(lower(ki.name), lower(nf.name)) DESC, length(nf.name) LIMIT 1) byname
           ON byname.score >= ${NAME_MATCH}
        WHERE ki.branch_id = $1 AND ki.is_active`,
      [branchId, NON_FOOD_CANONICALS],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** GET /nutrition/mapping — each ingredient: confirmed food, or a suggestion. */
  async mapping(v: VendorRef) {
    const [ings, sugg] = await Promise.all([
      this.dataSource.query(
        `SELECT ki.id, ki.name, ki.name_ur, ki.base_unit, ki.category, ki.nutrition_food_id, ki.nutrition_confirmed,
                ki.nutrition_piece_grams
           FROM kitchen_ingredients ki WHERE ki.branch_id = $1 AND ki.is_active ORDER BY ki.name`,
        [v.branchId],
      ),
      this.suggestions(v.branchId),
    ]);
    const ids = [
      ...new Set(
        [
          ...ings.map((i: any) => i.nutrition_food_id),
          ...[...sugg.values()].map((s) => s.food_id),
        ].filter(Boolean),
      ),
    ] as string[];
    const foods = ids.length
      ? await this.dataSource
          .getRepository(NutritionFood)
          .findBy({ id: In(ids) })
      : [];
    const byId = new Map(foods.map((f) => [f.id, foodView(f)]));
    const items = ings.map((i: any) => {
      const s = sugg.get(i.id);
      const nonFood = s?.non_food ?? i.category === 'packaging';
      return {
        ingredientId: i.id,
        name: i.name,
        nameUr: i.name_ur,
        baseUnit: i.base_unit,
        status: i.nutrition_confirmed
          ? 'confirmed'
          : nonFood
            ? 'not_food'
            : s?.food_id
              ? 'suggested'
              : 'unmapped',
        food:
          i.nutrition_confirmed && i.nutrition_food_id
            ? (byId.get(i.nutrition_food_id) ?? null)
            : null,
        suggestion:
          !i.nutrition_confirmed && !nonFood && s?.food_id
            ? {
                food: byId.get(s.food_id),
                via: s.via,
                score: s.score === null ? null : Number(s.score),
              }
            : null,
        pieceGrams:
          i.nutrition_piece_grams === null
            ? null
            : Number(i.nutrition_piece_grams),
      };
    });
    const count = (st: string) =>
      items.filter((x: any) => x.status === st).length;
    return {
      items,
      summary: {
        confirmed: count('confirmed'),
        suggested: count('suggested'),
        unmapped: count('unmapped'),
        notFood: count('not_food'),
      },
    };
  }

  /** PUT /nutrition/mapping/:ingredientId — confirm a food (null clears it). Recomputes the kitchen's dishes. */
  async map(v: VendorRef, ingredientId: string, dto: MapIngredientDto) {
    const [ing] = await this.dataSource.query(
      `SELECT id FROM kitchen_ingredients WHERE id = $1 AND branch_id = $2`,
      [ingredientId, v.branchId],
    );
    if (!ing) throw kitchenNotFound('Ingredient');
    if (dto.nutritionFoodId) {
      const f = await this.dataSource
        .getRepository(NutritionFood)
        .findOne({ where: { id: dto.nutritionFoodId, isActive: true } });
      if (!f) throw kitchenNotFound('Nutrition food');
    }
    await this.dataSource.query(
      `UPDATE kitchen_ingredients SET nutrition_food_id = $2, nutrition_confirmed = $3,
              nutrition_piece_grams = $4, updated_at = now() WHERE id = $1`,
      [
        ingredientId,
        dto.nutritionFoodId ?? null,
        !!dto.nutritionFoodId,
        dto.pieceGrams ?? null,
      ],
    );
    const recomputed = await this.items.recomputeBrand(
      this.dataSource.manager,
      v.brandId,
    );
    return { ...(await this.mapping(v)), recomputed };
  }

  /** POST /nutrition/mapping/accept-suggestions — confirm every suggestion at once. */
  async acceptAll(v: VendorRef) {
    const sugg = await this.suggestions(v.branchId);
    let accepted = 0;
    for (const [id, s] of sugg) {
      if (!s.food_id || s.non_food) continue;
      const res = await this.dataSource.query(
        `UPDATE kitchen_ingredients SET nutrition_food_id = $2, nutrition_confirmed = true, updated_at = now()
          WHERE id = $1 AND NOT nutrition_confirmed RETURNING id`,
        [id, s.food_id],
      );
      accepted += returned(res).length;
    }
    const recomputed = await this.items.recomputeBrand(
      this.dataSource.manager,
      v.brandId,
    );
    return { accepted, recomputed, ...(await this.mapping(v)) };
  }
}
