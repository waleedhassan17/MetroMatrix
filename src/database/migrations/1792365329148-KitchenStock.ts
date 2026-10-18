import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenStock1792365329148 implements MigrationInterface {
  name = 'KitchenStock1792365329148';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."ingredient_category" AS ENUM('meat', 'vegetable', 'dairy', 'spice', 'grain', 'oil', 'bakery', 'beverage', 'packaging', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ingredient_base_unit" AS ENUM('g', 'ml', 'piece')`,
    );
    await queryRunner.query(
      `CREATE TABLE "kitchen_ingredients" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "name" citext NOT NULL, "name_ur" character varying(80), "category" "public"."ingredient_category" NOT NULL DEFAULT 'other', "base_unit" "public"."ingredient_base_unit" NOT NULL, "custom_units" jsonb NOT NULL DEFAULT '[]', "par_level" numeric(14,3), "on_hand" numeric(14,3) NOT NULL DEFAULT '0', "avg_cost" numeric(12,4) NOT NULL DEFAULT '0', "last_cost" numeric(12,4), "is_active" boolean NOT NULL DEFAULT true, "negative_alerted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_kitchen_ingredients_numbers" CHECK ("avg_cost" >= 0 AND ("par_level" IS NULL OR "par_level" >= 0)), CONSTRAINT "PK_17962627fb8e369b6ae55100f95" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3aa5a70780e891c804c53e4072" ON "kitchen_ingredients" ("branch_id", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_batches" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ingredient_id" uuid NOT NULL, "qty_received" numeric(14,3) NOT NULL, "qty_remaining" numeric(14,3) NOT NULL, "unit_cost" numeric(12,4) NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_on" date, "purchase_line_id" uuid, "expiry_alerted" smallint NOT NULL DEFAULT '0', CONSTRAINT "CHK_stock_batches_numbers" CHECK ("qty_remaining" >= 0 AND "qty_received" > 0 AND "unit_cost" >= 0), CONSTRAINT "PK_85b4f081f5a5c69009675db8b1f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_batches_expiry" ON "stock_batches" ("expires_on") WHERE "qty_remaining" > 0 AND "expires_on" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_batches_fifo" ON "stock_batches" ("ingredient_id", "received_at") WHERE "qty_remaining" > 0`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."stock_movement_reason" AS ENUM('purchase', 'order', 'order_cancel', 'waste', 'count_adjust', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_movements" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ingredient_id" uuid NOT NULL, "batch_id" uuid, "delta" numeric(14,3) NOT NULL, "reason" "public"."stock_movement_reason" NOT NULL, "ref_type" character varying(20), "ref_id" uuid, "actor_user_id" uuid, "balance_after" numeric(14,3) NOT NULL, "unit_cost" numeric(12,4) NOT NULL, "note" character varying(300), CONSTRAINT "PK_57a26b190618550d8e65fb860e7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9df9bfe506b56aad20feb11a3d" ON "stock_movements" ("ref_type", "ref_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9de64b96a7b441d6f8f9133f02" ON "stock_movements" ("ingredient_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "recipe_cards" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "menu_item_id" uuid NOT NULL, "variant_id" uuid, "yield_servings" smallint NOT NULL DEFAULT '1', "notes" text, "is_signature" boolean NOT NULL DEFAULT false, "signature_by" character varying(120), "signature_since" date, CONSTRAINT "CHK_recipe_cards_yield" CHECK ("yield_servings" BETWEEN 1 AND 500), CONSTRAINT "PK_53b22c22bb112a62af431cc6635" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_recipe_cards_variant" ON "recipe_cards" ("menu_item_id", "variant_id") WHERE "variant_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_recipe_cards_item" ON "recipe_cards" ("menu_item_id") WHERE "variant_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "recipe_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "recipe_card_id" uuid NOT NULL, "ingredient_id" uuid NOT NULL, "qty" numeric(12,3) NOT NULL, "unit" character varying(20) NOT NULL, "qty_base" numeric(14,3) NOT NULL, "option_id" uuid, "is_packaging" boolean NOT NULL DEFAULT false, "sort" smallint NOT NULL DEFAULT '0', CONSTRAINT "CHK_recipe_lines_qty" CHECK ("qty" > 0 AND "qty_base" > 0), CONSTRAINT "PK_d70661d0014410bbbc3ef5429f6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c839293d78db4ae733d75f502f" ON "recipe_lines" ("ingredient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad819125935b9376116a10b9ce" ON "recipe_lines" ("recipe_card_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."kitchen_alert_kind" AS ENUM('sold_out_stock', 'back_in_stock', 'stock_negative', 'expiring', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "kitchen_alerts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "kind" "public"."kitchen_alert_kind" NOT NULL, "title" character varying(120) NOT NULL, "body" character varying(300) NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "sent_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9f4d9542ea603a18e03a6c34fa5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_94c163b79c60a60e38d293a92a" ON "kitchen_alerts" ("branch_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kitchen_alerts_pending" ON "kitchen_alerts" ("created_at") WHERE "sent_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD "stock_deducted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD "stock_restored_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" ADD "auto_reason" character varying(12)`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" ADD CONSTRAINT "CHK_branch_item_overrides_auto_reason" CHECK ("auto_reason" IS NULL OR "auto_reason" = 'stock')`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" ADD CONSTRAINT "FK_a9a957195c2565775c316c30aee" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_batches" ADD CONSTRAINT "FK_62fd19db1a0882fd797ef5df8d7" FOREIGN KEY ("ingredient_id") REFERENCES "kitchen_ingredients"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_990da5f8a5976f2d02cf60fbdcb" FOREIGN KEY ("ingredient_id") REFERENCES "kitchen_ingredients"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_64c67f927d872a7e19700ab6637" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_43e94fb359de024e27ac96c08e9" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" ADD CONSTRAINT "FK_d09a43ed1f56a014a22f05e44e0" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" ADD CONSTRAINT "FK_fce9b2fd3ff08f25f3e1475d091" FOREIGN KEY ("variant_id") REFERENCES "item_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_lines" ADD CONSTRAINT "FK_4b78ae9b87157d5042a9b1cebc0" FOREIGN KEY ("recipe_card_id") REFERENCES "recipe_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_lines" ADD CONSTRAINT "FK_c839293d78db4ae733d75f502f5" FOREIGN KEY ("ingredient_id") REFERENCES "kitchen_ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_lines" ADD CONSTRAINT "FK_83be51e65e54a71c0135de76fbe" FOREIGN KEY ("option_id") REFERENCES "options"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_alerts" ADD CONSTRAINT "FK_368c30f26eda0a4863852c08292" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kitchen_alerts" DROP CONSTRAINT "FK_368c30f26eda0a4863852c08292"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_lines" DROP CONSTRAINT "FK_83be51e65e54a71c0135de76fbe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_lines" DROP CONSTRAINT "FK_c839293d78db4ae733d75f502f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_lines" DROP CONSTRAINT "FK_4b78ae9b87157d5042a9b1cebc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" DROP CONSTRAINT "FK_fce9b2fd3ff08f25f3e1475d091"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" DROP CONSTRAINT "FK_d09a43ed1f56a014a22f05e44e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_43e94fb359de024e27ac96c08e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_64c67f927d872a7e19700ab6637"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_990da5f8a5976f2d02cf60fbdcb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_batches" DROP CONSTRAINT "FK_62fd19db1a0882fd797ef5df8d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" DROP CONSTRAINT "FK_a9a957195c2565775c316c30aee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" DROP CONSTRAINT "CHK_branch_item_overrides_auto_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_item_overrides" DROP COLUMN "auto_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP COLUMN "stock_restored_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP COLUMN "stock_deducted_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_kitchen_alerts_pending"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_94c163b79c60a60e38d293a92a"`,
    );
    await queryRunner.query(`DROP TABLE "kitchen_alerts"`);
    await queryRunner.query(`DROP TYPE "public"."kitchen_alert_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad819125935b9376116a10b9ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c839293d78db4ae733d75f502f"`,
    );
    await queryRunner.query(`DROP TABLE "recipe_lines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_recipe_cards_item"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_recipe_cards_variant"`);
    await queryRunner.query(`DROP TABLE "recipe_cards"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9de64b96a7b441d6f8f9133f02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9df9bfe506b56aad20feb11a3d"`,
    );
    await queryRunner.query(`DROP TABLE "stock_movements"`);
    await queryRunner.query(`DROP TYPE "public"."stock_movement_reason"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_batches_fifo"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_batches_expiry"`);
    await queryRunner.query(`DROP TABLE "stock_batches"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3aa5a70780e891c804c53e4072"`,
    );
    await queryRunner.query(`DROP TABLE "kitchen_ingredients"`);
    await queryRunner.query(`DROP TYPE "public"."ingredient_base_unit"`);
    await queryRunner.query(`DROP TYPE "public"."ingredient_category"`);
  }
}
