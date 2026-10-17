import { MigrationInterface, QueryRunner } from 'typeorm';

export class FoodVendorsPlans1792246220057 implements MigrationInterface {
  name = 'FoodVendorsPlans1792246220057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Geography columns (branch locations, rider positions) need PostGIS.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await queryRunner.query(
      `CREATE TABLE "business_plans" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid NOT NULL, "plan_key" character varying(40) NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, "overrides" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_461167914444abdd6e3aa36ea2c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d6dac97c9eb3d72ea096d9980b" ON "business_plans" ("business_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_brand_status" AS ENUM('active', 'paused')`,
    );
    await queryRunner.query(
      `CREATE TABLE "food_brands" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "slug" citext NOT NULL, "tagline" character varying(140), "logo_url" character varying(500), "cover_url" character varying(500), "brand_color" character varying(7) NOT NULL DEFAULT '#B4532A', "on_brand_color" character varying(7) NOT NULL DEFAULT '#FFFFFF', "cuisine_ids" uuid array NOT NULL DEFAULT '{}', "price_level" smallint NOT NULL DEFAULT '2', "is_home_kitchen" boolean NOT NULL DEFAULT false, "status" "public"."food_brand_status" NOT NULL DEFAULT 'active', "is_featured" boolean NOT NULL DEFAULT false, "rating_avg" numeric(3,2) NOT NULL DEFAULT '0', "rating_count" integer NOT NULL DEFAULT '0', "search" tsvector, CONSTRAINT "CHK_food_brands_price_level" CHECK ("price_level" BETWEEN 1 AND 3), CONSTRAINT "PK_5cf0da5659afb84c47cbe4500af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c040fe2fc6fcf05667d5617c24" ON "food_brands" ("slug") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9c3f19f51ada7079a866b31102" ON "food_brands" ("business_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_branch_status" AS ENUM('draft', 'active', 'suspended')`,
    );
    await queryRunner.query(
      `CREATE TABLE "branches" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid NOT NULL, "brand_id" uuid NOT NULL, "address_line" character varying(255), "area" character varying(80), "city" character varying(60), "geo" geography(Point,4326), "phone" character varying(16), "timezone" character varying(60) NOT NULL DEFAULT 'Asia/Karachi', "prep_minutes" smallint NOT NULL DEFAULT '20', "busy_until" TIMESTAMP WITH TIME ZONE, "busy_extra_minutes" smallint NOT NULL DEFAULT '0', "is_paused" boolean NOT NULL DEFAULT false, "pause_message" character varying(200), "accepts_delivery" boolean NOT NULL DEFAULT true, "accepts_pickup" boolean NOT NULL DEFAULT true, "accepts_cod" boolean NOT NULL DEFAULT true, "cod_limit" integer NOT NULL DEFAULT '10000', "transfer_confirm_before_prep" boolean NOT NULL DEFAULT true, "auto_reject_minutes" smallint NOT NULL DEFAULT '5', "max_radius_km" numeric(5,2) NOT NULL DEFAULT '5', "free_delivery_over" integer, "preorder_only" boolean NOT NULL DEFAULT false, "status" "public"."food_branch_status" NOT NULL DEFAULT 'draft', "went_live_at" TIMESTAMP WITH TIME ZONE, "food_safety_checked_at" TIMESTAMP WITH TIME ZONE, "food_safety_note" text, CONSTRAINT "CHK_branches_numbers" CHECK ("prep_minutes" BETWEEN 5 AND 180 AND "cod_limit" >= 0 AND "max_radius_km" > 0 AND "busy_extra_minutes" >= 0), CONSTRAINT "CHK_branches_auto_reject" CHECK ("auto_reject_minutes" BETWEEN 3 AND 10), CONSTRAINT "PK_7f37d3b42defea97f1df0d19535" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_032a75524f6808ca42f8665fe6" ON "branches" USING GiST ("geo") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_608e52a910eeaeee5248786ae4" ON "branches" ("brand_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b6ac028866ef85f79f04581ef2" ON "branches" ("business_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rider_vehicle" AS ENUM('bike', 'bicycle', 'car', 'on_foot')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rider_status" AS ENUM('active', 'inactive', 'on_leave', 'plan_locked')`,
    );
    await queryRunner.query(
      `CREATE TABLE "riders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "business_id" uuid NOT NULL, "full_name" character varying(80) NOT NULL, "phone" character varying(16), "vehicle" "public"."rider_vehicle" NOT NULL DEFAULT 'bike', "status" "public"."rider_status" NOT NULL DEFAULT 'active', "on_duty" boolean NOT NULL DEFAULT false, "last_geo" geography(Point,4326), "location_updated_at" TIMESTAMP WITH TIME ZONE, "active_order_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_6c17e67f760677500c29d68e689" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73b8a0585880ca44aa18f83164" ON "riders" ("business_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8d3d41e9ec12eff82b325fa8c0" ON "riders" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "business_plans" ADD CONSTRAINT "FK_d6dac97c9eb3d72ea096d9980b6" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" ADD CONSTRAINT "FK_9c3f19f51ada7079a866b311027" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD CONSTRAINT "FK_b6ac028866ef85f79f04581ef26" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD CONSTRAINT "FK_608e52a910eeaeee5248786ae4e" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "riders" ADD CONSTRAINT "FK_8d3d41e9ec12eff82b325fa8c07" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "riders" ADD CONSTRAINT "FK_728737308801ad4eb44bd4f236a" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Backfill: food businesses approved before Food existed get their one brand,
    // one branch (draft) and the community plan — the same rows the approval hook makes.
    await queryRunner.query(`INSERT INTO food_brands (business_id, name, slug, is_home_kitchen)
            SELECT id, name, slug, sub_type = 'home_kitchen' FROM businesses
             WHERE service_type = 'food' AND status IN ('approved', 'suspended')
            ON CONFLICT (business_id) DO NOTHING`);
    await queryRunner.query(`INSERT INTO branches (business_id, brand_id, address_line, city, phone, geo, accepts_pickup)
            SELECT b.id, fb.id, b.address_line, b.city, b.phone,
                   CASE WHEN b.lat IS NULL OR b.lng IS NULL THEN NULL
                        ELSE ST_SetSRID(ST_MakePoint(b.lng::float8, b.lat::float8), 4326)::geography END,
                   b.sub_type <> 'cloud_kitchen'
              FROM businesses b JOIN food_brands fb ON fb.business_id = b.id
            ON CONFLICT (business_id) DO NOTHING`);
    await queryRunner.query(`INSERT INTO business_plans (business_id, plan_key, started_at)
            SELECT id, 'community', now() FROM businesses
             WHERE service_type = 'food' AND status IN ('approved', 'suspended')
            ON CONFLICT (business_id) DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "riders" DROP CONSTRAINT "FK_728737308801ad4eb44bd4f236a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "riders" DROP CONSTRAINT "FK_8d3d41e9ec12eff82b325fa8c07"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP CONSTRAINT "FK_608e52a910eeaeee5248786ae4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP CONSTRAINT "FK_b6ac028866ef85f79f04581ef26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" DROP CONSTRAINT "FK_9c3f19f51ada7079a866b311027"`,
    );
    await queryRunner.query(
      `ALTER TABLE "business_plans" DROP CONSTRAINT "FK_d6dac97c9eb3d72ea096d9980b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d3d41e9ec12eff82b325fa8c0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73b8a0585880ca44aa18f83164"`,
    );
    await queryRunner.query(`DROP TABLE "riders"`);
    await queryRunner.query(`DROP TYPE "public"."rider_status"`);
    await queryRunner.query(`DROP TYPE "public"."rider_vehicle"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b6ac028866ef85f79f04581ef2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_608e52a910eeaeee5248786ae4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_032a75524f6808ca42f8665fe6"`,
    );
    await queryRunner.query(`DROP TABLE "branches"`);
    await queryRunner.query(`DROP TYPE "public"."food_branch_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c3f19f51ada7079a866b31102"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c040fe2fc6fcf05667d5617c24"`,
    );
    await queryRunner.query(`DROP TABLE "food_brands"`);
    await queryRunner.query(`DROP TYPE "public"."food_brand_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6dac97c9eb3d72ea096d9980b"`,
    );
    await queryRunner.query(`DROP TABLE "business_plans"`);
  }
}
