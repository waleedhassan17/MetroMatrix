import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chunk 2 P2: products, images, variants, inventory movements, banners.
 * Hand-added: pg_trgm, the search trigger, GIN indexes and the
 * NULLS NOT DISTINCT variant uniqueness (TypeORM cannot express them; the
 * entities declare them with synchronize: false).
 */

export class ShopProducts1792066087768 implements MigrationInterface {
  name = 'ShopProducts1792066087768';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "product_images" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "url" character varying(500) NOT NULL, "public_id" character varying(255) NOT NULL, "sort" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_1974264ea7265989af8392f63a1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_615b91e56e5886705baa0141c0" ON "product_images" ("product_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "product_variants" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "option1" character varying(40), "option2" character varying(40), "color_hex" character varying(7), "sku" character varying(64), "price_delta" integer NOT NULL DEFAULT '0', "stock" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "sort" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_product_variants_stock" CHECK ("stock" >= 0), CONSTRAINT "PK_281e3f2c55652d6a22c0aa59fd7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6343513e20e2deab45edfce131" ON "product_variants" ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived', 'removed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_id" uuid NOT NULL, "category_id" uuid NOT NULL, "collection_id" uuid, "name" character varying(140) NOT NULL, "slug" citext NOT NULL, "description" text NOT NULL, "base_price" integer NOT NULL, "sale_price" integer, "status" "public"."product_status" NOT NULL DEFAULT 'draft', "removed_reason" text, "tags" text array NOT NULL, "rating_avg" numeric(3,2) NOT NULL DEFAULT '0', "rating_count" integer NOT NULL DEFAULT '0', "sold_count" integer NOT NULL DEFAULT '0', "published_at" TIMESTAMP WITH TIME ZONE, "search" tsvector, CONSTRAINT "CHK_products_prices" CHECK ("base_price" > 0 AND ("sale_price" IS NULL OR ("sale_price" > 0 AND "sale_price" < "base_price"))), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a5f6868c96e0069e699f33e12" ON "products" ("category_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28c086ff9c9e8b62e9db742bba" ON "products" ("status", "published_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_128a4b88f2e65c74c79e7530e5" ON "products" ("store_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8d76dbd6ed3afa9111ec0dcce9" ON "products" ("store_id", "slug") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inventory_reason" AS ENUM('order', 'cancel', 'return_restock', 'manual', 'bulk')`,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_movements" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "variant_id" uuid NOT NULL, "delta" integer NOT NULL, "reason" "public"."inventory_reason" NOT NULL, "ref_type" character varying(32), "ref_id" uuid, "actor_user_id" uuid, "balance_after" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d7597827c1dcffae889db3ab873" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38e2f32be31de92b8cec259304" ON "inventory_movements" ("variant_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."shop_banner_target" AS ENUM('store', 'category', 'collection', 'product', 'none')`,
    );
    await queryRunner.query(
      `CREATE TABLE "shop_banners" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "image_url" character varying(500) NOT NULL, "title" character varying(80) NOT NULL, "subtitle" character varying(140), "target_type" "public"."shop_banner_target" NOT NULL DEFAULT 'none', "target_id" uuid, "starts_at" TIMESTAMP WITH TIME ZONE, "ends_at" TIMESTAMP WITH TIME ZONE, "sort" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_123e220f9279c5e24d84c99a1a1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a4ac8b6a696c8bc08637ebde1" ON "shop_banners" ("is_active", "sort") `,
    );
    await queryRunner.query(
      `ALTER TABLE "product_images" ADD CONSTRAINT "FK_4f166bb8c2bfcef2498d97b4068" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD CONSTRAINT "FK_6343513e20e2deab45edfce1316" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_68863607048a1abd43772b314ef" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY ("category_id") REFERENCES "shop_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_e6c272f6bc9b9182f4311a1de7e" FOREIGN KEY ("collection_id") REFERENCES "store_collections"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_1bb851d7c7ef2435fad91cae453" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── Search: weighted tsvector maintained by a trigger, trigram for typos ──
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION products_search_refresh() RETURNS trigger AS $$
            BEGIN
              NEW.search :=
                setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
                setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
              RETURN NEW;
            END
            $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
            CREATE TRIGGER products_search_refresh
            BEFORE INSERT OR UPDATE OF name, tags, description ON "products"
            FOR EACH ROW EXECUTE FUNCTION products_search_refresh()`);
    await queryRunner.query(
      `CREATE INDEX "IDX_products_search" ON "products" USING GIN ("search")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops)`,
    );
    // ── One row per option combination, "default" (both null) included ──
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_product_variants_options" ON "product_variants" ("product_id", "option1", "option2") NULLS NOT DISTINCT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_product_variants_options"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_search"`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS products_search_refresh ON "products"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS products_search_refresh()`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_1bb851d7c7ef2435fad91cae453"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_e6c272f6bc9b9182f4311a1de7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_9a5f6868c96e0069e699f33e124"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_68863607048a1abd43772b314ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT "FK_6343513e20e2deab45edfce1316"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_images" DROP CONSTRAINT "FK_4f166bb8c2bfcef2498d97b4068"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a4ac8b6a696c8bc08637ebde1"`,
    );
    await queryRunner.query(`DROP TABLE "shop_banners"`);
    await queryRunner.query(`DROP TYPE "public"."shop_banner_target"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38e2f32be31de92b8cec259304"`,
    );
    await queryRunner.query(`DROP TABLE "inventory_movements"`);
    await queryRunner.query(`DROP TYPE "public"."inventory_reason"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d76dbd6ed3afa9111ec0dcce9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_128a4b88f2e65c74c79e7530e5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28c086ff9c9e8b62e9db742bba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a5f6868c96e0069e699f33e12"`,
    );
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TYPE "public"."product_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6343513e20e2deab45edfce131"`,
    );
    await queryRunner.query(`DROP TABLE "product_variants"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_615b91e56e5886705baa0141c0"`,
    );
    await queryRunner.query(`DROP TABLE "product_images"`);
  }
}
