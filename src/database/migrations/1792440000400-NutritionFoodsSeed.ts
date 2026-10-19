import { MigrationInterface, QueryRunner } from 'typeorm';
import { NUTRITION_FOODS } from '../seeds/nutrition/nutrition-foods.data';

/**
 * The reference foods (USDA FoodData Central SR Legacy, public domain), from
 * the committed data file scripts/build-nutrition-seed.mjs generates. Keyed
 * by `key`, so a rerun leaves staff edits alone.
 */
export class NutritionFoodsSeed1792440000400 implements MigrationInterface {
  name = 'NutritionFoodsSeed1792440000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const f = NUTRITION_FOODS;
    await queryRunner.query(
      `INSERT INTO nutrition_foods (key, name, name_ur, canonicals, food_group, source, fdc_id, usda_description,
              kcal, protein_g, carbs_g, fat_g, fibre_g, sodium_mg, piece_grams, note)
       SELECT k, n, u, coalesce(string_to_array(c, '|'), '{}'), g, 'usda_sr_legacy', fdc, d, kc, p, cb, ft, fb, na, pg, nt
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[],
                     $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::numeric[],
                     $14::numeric[], $15::text[])
              AS t(k, n, u, c, g, fdc, d, kc, p, cb, ft, fb, na, pg, nt)
       ON CONFLICT (key) DO NOTHING`,
      [
        f.map((x) => x.key),
        f.map((x) => x.name.slice(0, 200)),
        f.map((x) => x.nameUr),
        f.map((x) => (x.canonicals.length ? x.canonicals.join('|') : null)),
        f.map((x) => x.group.slice(0, 80)),
        f.map((x) => x.fdcId),
        f.map((x) => x.usdaDescription),
        f.map((x) => x.kcal),
        f.map((x) => x.proteinG),
        f.map((x) => x.carbsG),
        f.map((x) => x.fatG),
        f.map((x) => x.fibreG),
        f.map((x) => x.sodiumMg),
        f.map((x) => x.pieceGrams),
        f.map((x) => x.note),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM nutrition_foods WHERE source = 'usda_sr_legacy' AND key = ANY($1::text[])`,
      [NUTRITION_FOODS.map((x) => x.key)],
    );
  }
}
