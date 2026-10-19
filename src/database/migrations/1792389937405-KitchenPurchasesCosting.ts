import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenPurchasesCosting1792389937405 implements MigrationInterface {
  name = 'KitchenPurchasesCosting1792389937405';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reference_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" citext NOT NULL, "unit" character varying(30) NOT NULL, "base_unit" "public"."ingredient_base_unit" NOT NULL, "factor" numeric(12,3) NOT NULL, "canonical" character varying(80), CONSTRAINT "CHK_reference_items_factor" CHECK ("factor" > 0), CONSTRAINT "PK_d39bf88754f07505ec4bf1e87cc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_06653be09f325d003b1f1e6ff8" ON "reference_items" ("name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "reference_prices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "item_id" uuid NOT NULL, "city" citext NOT NULL, "week_ending" date NOT NULL, "price" numeric(10,2) NOT NULL, CONSTRAINT "CHK_reference_prices_price" CHECK ("price" > 0), CONSTRAINT "PK_2fdb828c44f8b93db806a6ccf6f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_787e560c104f39363f8d985bce" ON "reference_prices" ("city", "week_ending") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_df3ffd7ab63f2307ee1223fc8c" ON "reference_prices" ("item_id", "city", "week_ending") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."waste_reason" AS ENUM('expired', 'spoiled', 'overcooked', 'returned', 'leftover', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "waste_entries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "ingredient_id" uuid, "menu_item_id" uuid, "qty" numeric(12,3) NOT NULL, "unit" character varying(20) NOT NULL, "reason" "public"."waste_reason" NOT NULL, "cost" integer, "note" character varying(300), "logged_by" uuid, CONSTRAINT "CHK_waste_entries_qty" CHECK ("qty" > 0), CONSTRAINT "CHK_waste_entries_target" CHECK (("ingredient_id" IS NULL) <> ("menu_item_id" IS NULL)), CONSTRAINT "PK_542ac1b227b29946fcd8d4f802c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2f53571b90a8b6abe3226edf0" ON "waste_entries" ("branch_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "suppliers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "name" citext NOT NULL, "phone" character varying(20), "notes" character varying(500), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b70ac51766a9e3144f778cfe81e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_27fe3d9053459df8b365f605eb" ON "suppliers" ("branch_id", "name") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."purchase_source" AS ENUM('manual', 'voice', 'receipt_scan')`,
    );
    await queryRunner.query(
      `CREATE TABLE "purchases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "supplier_id" uuid, "purchased_at" TIMESTAMP WITH TIME ZONE NOT NULL, "total" integer NOT NULL, "receipt_url" character varying(500), "source" "public"."purchase_source" NOT NULL DEFAULT 'manual', "note" character varying(300), "created_by" uuid, CONSTRAINT "CHK_purchases_total" CHECK ("total" >= 0), CONSTRAINT "PK_1d55032f37a34c6eceacbbca6b8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2163731904f63f0a2b04889f04" ON "purchases" ("branch_id", "purchased_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "purchase_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "purchase_id" uuid NOT NULL, "ingredient_id" uuid NOT NULL, "qty" numeric(12,3) NOT NULL, "unit" character varying(20) NOT NULL, "qty_base" numeric(14,3) NOT NULL, "total_price" integer NOT NULL, "unit_cost" numeric(12,4) NOT NULL, "expires_on" date, "batch_id" uuid, CONSTRAINT "CHK_purchase_lines_numbers" CHECK ("qty" > 0 AND "qty_base" > 0 AND "total_price" >= 0), CONSTRAINT "PK_82dbfeeccbf8830ed076014dedd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea852214ab2bf051dcadd21952" ON "purchase_lines" ("ingredient_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e276100ffe00bb5b1facefe127" ON "purchase_lines" ("purchase_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "item_cost_snapshots" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "menu_item_id" uuid NOT NULL, "variant_key" character varying(36) NOT NULL DEFAULT '-', "week_start" date NOT NULL, "cost" numeric(10,2) NOT NULL, "price" integer NOT NULL, "food_cost_pct" numeric(5,1) NOT NULL, CONSTRAINT "PK_7063e5cd55679a9e5b542f7cbb7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d980cdd4205927c4e2ad08ac81" ON "item_cost_snapshots" ("branch_id", "week_start") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_item_cost_snapshots" ON "item_cost_snapshots" ("menu_item_id", "variant_key", "week_start") `,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD "target_food_cost_pct" smallint NOT NULL DEFAULT '35'`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD "require_packing_photo" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" ADD "reference_item_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."kitchen_alert_kind" RENAME TO "kitchen_alert_kind_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."kitchen_alert_kind" AS ENUM('sold_out_stock', 'back_in_stock', 'stock_negative', 'expiring', 'expired', 'food_cost_high', 'price_above_reference')`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_alerts" ALTER COLUMN "kind" TYPE "public"."kitchen_alert_kind" USING "kind"::"text"::"public"."kitchen_alert_kind"`,
    );
    await queryRunner.query(`DROP TYPE "public"."kitchen_alert_kind_old"`);
    await queryRunner.query(
      `ALTER TABLE "branches" ADD CONSTRAINT "CHK_branches_food_cost_target" CHECK ("target_food_cost_pct" BETWEEN 5 AND 95)`,
    );
    await queryRunner.query(
      `ALTER TABLE "reference_prices" ADD CONSTRAINT "FK_b08a14866413cc788e8f76918c0" FOREIGN KEY ("item_id") REFERENCES "reference_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" ADD CONSTRAINT "FK_faed01b0177749adeb55fe08baf" FOREIGN KEY ("reference_item_id") REFERENCES "reference_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" ADD CONSTRAINT "FK_d80b3fb0cc92da0747e9300def1" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" ADD CONSTRAINT "FK_909278463a14964b1d0a78ed024" FOREIGN KEY ("ingredient_id") REFERENCES "kitchen_ingredients"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" ADD CONSTRAINT "FK_8c0a9f740af3bf4bcee09a88a87" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" ADD CONSTRAINT "FK_1a4a53679a4437dc68e71979277" FOREIGN KEY ("logged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" ADD CONSTRAINT "FK_ce35fd787e09aecdb311aaff66c" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" ADD CONSTRAINT "FK_6b06d2cb149e7461d298eda9002" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" ADD CONSTRAINT "FK_d5fec047f705d5b510c19379b95" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" ADD CONSTRAINT "FK_70ebb313de49b0256d21b1527d4" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_lines" ADD CONSTRAINT "FK_e276100ffe00bb5b1facefe127f" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_lines" ADD CONSTRAINT "FK_9dc730309f4e2d172bdb447dd0d" FOREIGN KEY ("ingredient_id") REFERENCES "kitchen_ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_lines" ADD CONSTRAINT "FK_1869a412a004baf5410c6c47dd5" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_cost_snapshots" ADD CONSTRAINT "FK_9f030c2721158b975abfefedac3" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_cost_snapshots" DROP CONSTRAINT "FK_9f030c2721158b975abfefedac3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_lines" DROP CONSTRAINT "FK_1869a412a004baf5410c6c47dd5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_lines" DROP CONSTRAINT "FK_9dc730309f4e2d172bdb447dd0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_lines" DROP CONSTRAINT "FK_e276100ffe00bb5b1facefe127f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" DROP CONSTRAINT "FK_70ebb313de49b0256d21b1527d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" DROP CONSTRAINT "FK_d5fec047f705d5b510c19379b95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" DROP CONSTRAINT "FK_6b06d2cb149e7461d298eda9002"`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" DROP CONSTRAINT "FK_ce35fd787e09aecdb311aaff66c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" DROP CONSTRAINT "FK_1a4a53679a4437dc68e71979277"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" DROP CONSTRAINT "FK_8c0a9f740af3bf4bcee09a88a87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" DROP CONSTRAINT "FK_909278463a14964b1d0a78ed024"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_entries" DROP CONSTRAINT "FK_d80b3fb0cc92da0747e9300def1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" DROP CONSTRAINT "FK_faed01b0177749adeb55fe08baf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reference_prices" DROP CONSTRAINT "FK_b08a14866413cc788e8f76918c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP CONSTRAINT "CHK_branches_food_cost_target"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."kitchen_alert_kind_old" AS ENUM('sold_out_stock', 'back_in_stock', 'stock_negative', 'expiring', 'expired')`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_alerts" ALTER COLUMN "kind" TYPE "public"."kitchen_alert_kind_old" USING "kind"::"text"::"public"."kitchen_alert_kind_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."kitchen_alert_kind"`);
    await queryRunner.query(
      `ALTER TYPE "public"."kitchen_alert_kind_old" RENAME TO "kitchen_alert_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_ingredients" DROP COLUMN "reference_item_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP COLUMN "require_packing_photo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP COLUMN "target_food_cost_pct"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_item_cost_snapshots"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d980cdd4205927c4e2ad08ac81"`,
    );
    await queryRunner.query(`DROP TABLE "item_cost_snapshots"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e276100ffe00bb5b1facefe127"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea852214ab2bf051dcadd21952"`,
    );
    await queryRunner.query(`DROP TABLE "purchase_lines"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2163731904f63f0a2b04889f04"`,
    );
    await queryRunner.query(`DROP TABLE "purchases"`);
    await queryRunner.query(`DROP TYPE "public"."purchase_source"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27fe3d9053459df8b365f605eb"`,
    );
    await queryRunner.query(`DROP TABLE "suppliers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2f53571b90a8b6abe3226edf0"`,
    );
    await queryRunner.query(`DROP TABLE "waste_entries"`);
    await queryRunner.query(`DROP TYPE "public"."waste_reason"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df3ffd7ab63f2307ee1223fc8c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_787e560c104f39363f8d985bce"`,
    );
    await queryRunner.query(`DROP TABLE "reference_prices"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_06653be09f325d003b1f1e6ff8"`,
    );
    await queryRunner.query(`DROP TABLE "reference_items"`);
  }
}
