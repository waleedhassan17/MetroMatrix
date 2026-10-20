import { MigrationInterface, QueryRunner } from 'typeorm';

export class MyKitchenPantryPacks1792483108671 implements MigrationInterface {
  name = 'MyKitchenPantryPacks1792483108671';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."pantry_status" AS ENUM('active', 'used', 'expired', 'discarded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pantry_source" AS ENUM('manual', 'order', 'voice')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pantry_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "canonical" character varying(60), "qty" numeric(10,3) NOT NULL, "unit" character varying(8) NOT NULL, "expires_on" date, "status" "public"."pantry_status" NOT NULL DEFAULT 'active', "source" "public"."pantry_source" NOT NULL DEFAULT 'manual', "store_order_item_id" uuid, "notes" character varying(200), "reminded" smallint NOT NULL DEFAULT '0', "closed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_pantry_items_qty" CHECK ("qty" > 0), CONSTRAINT "PK_bb63c18ae1bc99152edd69c4a61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_pantry_items_order_item" ON "pantry_items" ("store_order_item_id") WHERE "store_order_item_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c34c7fd2346c381cdf75644b6f" ON "pantry_items" ("user_id", "status", "expires_on") `,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD "pack_qty" numeric(10,3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD "pack_unit" character varying(8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD "pack_qty" numeric(10,3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD "pack_unit" character varying(8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD CONSTRAINT "CHK_product_variants_pack" CHECK (("pack_qty" IS NULL) = ("pack_unit" IS NULL) AND ("pack_qty" IS NULL OR "pack_qty" > 0) AND ("pack_unit" IS NULL OR "pack_unit" IN ('g', 'kg', 'ml', 'l', 'piece', 'dozen')))`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "CHK_products_pack" CHECK (("pack_qty" IS NULL) = ("pack_unit" IS NULL) AND ("pack_qty" IS NULL OR "pack_qty" > 0) AND ("pack_unit" IS NULL OR "pack_unit" IN ('g', 'kg', 'ml', 'l', 'piece', 'dozen')))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pantry_items" ADD CONSTRAINT "FK_ec53d8efe916b7c27605c885148" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pantry_items" DROP CONSTRAINT "FK_ec53d8efe916b7c27605c885148"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "CHK_products_pack"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT "CHK_product_variants_pack"`,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "pack_unit"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "pack_qty"`);
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN "pack_unit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN "pack_qty"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c34c7fd2346c381cdf75644b6f"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_pantry_items_order_item"`);
    await queryRunner.query(`DROP TABLE "pantry_items"`);
    await queryRunner.query(`DROP TYPE "public"."pantry_source"`);
    await queryRunner.query(`DROP TYPE "public"."pantry_status"`);
  }
}
