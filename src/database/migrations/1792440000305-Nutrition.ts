import { MigrationInterface, QueryRunner } from 'typeorm';

export class Nutrition1792440000305 implements MigrationInterface {
  name = 'Nutrition1792440000305';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."nutrition_goal" AS ENUM('maintain', 'lose', 'gain')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."nutrition_sex" AS ENUM('male', 'female')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."nutrition_activity" AS ENUM('sedentary', 'light', 'moderate', 'active', 'very_active')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."nutrition_target_method" AS ENUM('mifflin_st_jeor', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TABLE "nutrition_profiles" ("user_id" uuid NOT NULL, "goal" "public"."nutrition_goal" NOT NULL, "sex" "public"."nutrition_sex", "age" smallint, "height_cm" numeric(5,1), "weight_kg" numeric(5,1), "activity" "public"."nutrition_activity", "target_kcal" integer NOT NULL, "target_method" "public"."nutrition_target_method" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_nutrition_profiles_numbers" CHECK (("age" IS NULL OR "age" BETWEEN 13 AND 100) AND ("height_cm" IS NULL OR "height_cm" BETWEEN 100 AND 250) AND ("weight_kg" IS NULL OR "weight_kg" BETWEEN 25 AND 300) AND "target_kcal" BETWEEN 800 AND 6000), CONSTRAINT "PK_b36ea85e1df5cf20ab0edf1462e" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."nutrition_source" AS ENUM('usda_sr_legacy', 'staff')`,
    );
    await queryRunner.query(
      `CREATE TABLE "nutrition_foods" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "key" character varying(64) NOT NULL, "name" character varying(200) NOT NULL, "name_ur" character varying(120), "canonicals" text array NOT NULL DEFAULT '{}', "food_group" character varying(80) NOT NULL, "source" "public"."nutrition_source" NOT NULL DEFAULT 'usda_sr_legacy', "fdc_id" integer, "usda_description" text, "kcal" numeric(6,1) NOT NULL, "protein_g" numeric(6,2) NOT NULL, "carbs_g" numeric(6,2) NOT NULL, "fat_g" numeric(6,2) NOT NULL, "fibre_g" numeric(6,2) NOT NULL, "sodium_mg" numeric(8,1) NOT NULL, "piece_grams" numeric(7,1), "note" character varying(300), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "CHK_nutrition_foods_values" CHECK ("kcal" >= 0 AND "kcal" <= 950 AND "protein_g" >= 0 AND "carbs_g" >= 0 AND "fat_g" >= 0 AND "fibre_g" >= 0 AND "sodium_mg" >= 0), CONSTRAINT "PK_1089708127d6138593382a5011c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_nutrition_foods_key" ON "nutrition_foods" ("key") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."nutrition_method" AS ENUM('recipe', 'ai_estimate')`,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_item_nutrition" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "menu_item_id" uuid NOT NULL, "kcal" numeric(7,1) NOT NULL, "protein_g" numeric(6,1) NOT NULL, "carbs_g" numeric(6,1) NOT NULL, "fat_g" numeric(6,1) NOT NULL, "fibre_g" numeric(6,1) NOT NULL, "sodium_mg" numeric(8,1) NOT NULL, "serving_grams" integer, "method" "public"."nutrition_method" NOT NULL, "confidence" numeric(3,2) NOT NULL, "mapped_share" numeric(4,3), "badges" text array NOT NULL DEFAULT '{}', "hidden" boolean NOT NULL DEFAULT false, "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "CHK_menu_item_nutrition_confidence" CHECK ("confidence" BETWEEN 0 AND 1), CONSTRAINT "PK_97e8ec2989a59a22e64471fb60a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_menu_item_nutrition_item" ON "menu_item_nutrition" ("menu_item_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" ADD "nutrition_food_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" ADD "nutrition_confirmed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" ADD "nutrition_piece_grams" numeric(7,1)`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" ADD CONSTRAINT "FK_b36ea85e1df5cf20ab0edf1462e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_nutrition" ADD CONSTRAINT "FK_6f9b4e7d1dbfa8ba7bcf5653209" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" ADD CONSTRAINT "FK_acf60ce5616500c9fa7857a497f" FOREIGN KEY ("nutrition_food_id") REFERENCES "nutrition_foods"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" DROP CONSTRAINT "FK_acf60ce5616500c9fa7857a497f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_item_nutrition" DROP CONSTRAINT "FK_6f9b4e7d1dbfa8ba7bcf5653209"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" DROP CONSTRAINT "FK_b36ea85e1df5cf20ab0edf1462e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" DROP COLUMN "nutrition_piece_grams"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" DROP COLUMN "nutrition_confirmed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" DROP COLUMN "nutrition_food_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_menu_item_nutrition_item"`,
    );
    await queryRunner.query(`DROP TABLE "menu_item_nutrition"`);
    await queryRunner.query(`DROP TYPE "public"."nutrition_method"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_nutrition_foods_key"`);
    await queryRunner.query(`DROP TABLE "nutrition_foods"`);
    await queryRunner.query(`DROP TYPE "public"."nutrition_source"`);
    await queryRunner.query(`DROP TABLE "nutrition_profiles"`);
    await queryRunner.query(`DROP TYPE "public"."nutrition_target_method"`);
    await queryRunner.query(`DROP TYPE "public"."nutrition_activity"`);
    await queryRunner.query(`DROP TYPE "public"."nutrition_sex"`);
    await queryRunner.query(`DROP TYPE "public"."nutrition_goal"`);
  }
}
