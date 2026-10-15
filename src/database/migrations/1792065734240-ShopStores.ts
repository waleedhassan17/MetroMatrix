import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShopStores1792065734240 implements MigrationInterface {
  name = 'ShopStores1792065734240';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stores" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid NOT NULL, "slug" citext NOT NULL, "tagline" character varying(120), "about" text, "logo_url" character varying(500), "cover_url" character varying(500), "brand_color" character varying(7) NOT NULL, "on_brand_color" character varying(7) NOT NULL, "socials" jsonb NOT NULL, "return_window_days" integer NOT NULL DEFAULT '7', "cod_enabled" boolean NOT NULL DEFAULT true, "cod_limit" integer NOT NULL DEFAULT '10000', "shipping_flat_fee" integer NOT NULL DEFAULT '150', "free_shipping_over" integer, "delivery_cities" text array NOT NULL, "dispatch_days_min" integer NOT NULL DEFAULT '1', "dispatch_days_max" integer NOT NULL DEFAULT '3', "is_paused" boolean NOT NULL DEFAULT false, "pause_message" character varying(200), "rating_avg" numeric(3,2) NOT NULL DEFAULT '0', "rating_count" integer NOT NULL DEFAULT '0', "is_featured" boolean NOT NULL DEFAULT false, "low_stock_digest_on" date, CONSTRAINT "CHK_stores_dispatch" CHECK ("dispatch_days_min" >= 0 AND "dispatch_days_min" <= "dispatch_days_max"), CONSTRAINT "CHK_stores_money" CHECK ("cod_limit" >= 0 AND "shipping_flat_fee" >= 0 AND ("free_shipping_over" IS NULL OR "free_shipping_over" > 0)), CONSTRAINT "CHK_stores_return_window" CHECK ("return_window_days" BETWEEN 0 AND 30), CONSTRAINT "PK_7aa6e7d71fa7acdd7ca43d7c9cb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7dd84ec09542fd1f9d7c406216" ON "stores" ("business_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_790b2968701a6ff5ff38323776" ON "stores" ("slug") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_payment_account_kind" AS ENUM('raast', 'jazzcash', 'easypaisa', 'bank')`,
    );
    await queryRunner.query(
      `CREATE TABLE "store_payment_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_id" uuid NOT NULL, "kind" "public"."store_payment_account_kind" NOT NULL, "account_title" character varying(80) NOT NULL, "account_number" character varying(34) NOT NULL, "bank_name" character varying(80), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_97cccf17fb3429fe04b972afeba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_752efece0760031cbac11cdf2b" ON "store_payment_accounts" ("store_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_14d9f92551e5937b8f407d8fc5" ON "store_payment_accounts" ("store_id", "account_number") `,
    );
    await queryRunner.query(
      `CREATE TABLE "store_collections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_id" uuid NOT NULL, "name" character varying(60) NOT NULL, "slug" citext NOT NULL, "sort" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_89aea3de465f54c27e0facc0b14" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01dedb71a6ce4cedc90ff87a19" ON "store_collections" ("store_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f3eee7fd4095f8899a74fdf2c4" ON "store_collections" ("store_id", "slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE "shop_categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "parent_id" uuid, "name" character varying(60) NOT NULL, "slug" citext NOT NULL, "icon" character varying(40), "sort" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c36f605b619acb802bb464361f2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_63c2f2cb9b193c61d0cf8e8c19" ON "shop_categories" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de0855e98733b1791509f81a45" ON "shop_categories" ("parent_id", "sort") `,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" ADD CONSTRAINT "FK_7dd84ec09542fd1f9d7c4062167" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_payment_accounts" ADD CONSTRAINT "FK_752efece0760031cbac11cdf2ba" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_collections" ADD CONSTRAINT "FK_4afabb7f23cf168ac807a5f58b3" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shop_categories" ADD CONSTRAINT "FK_5ce7c4eb8a0aa553b7a44e61c93" FOREIGN KEY ("parent_id") REFERENCES "shop_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shop_categories" DROP CONSTRAINT "FK_5ce7c4eb8a0aa553b7a44e61c93"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_collections" DROP CONSTRAINT "FK_4afabb7f23cf168ac807a5f58b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_payment_accounts" DROP CONSTRAINT "FK_752efece0760031cbac11cdf2ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" DROP CONSTRAINT "FK_7dd84ec09542fd1f9d7c4062167"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de0855e98733b1791509f81a45"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_63c2f2cb9b193c61d0cf8e8c19"`,
    );
    await queryRunner.query(`DROP TABLE "shop_categories"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3eee7fd4095f8899a74fdf2c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01dedb71a6ce4cedc90ff87a19"`,
    );
    await queryRunner.query(`DROP TABLE "store_collections"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_14d9f92551e5937b8f407d8fc5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_752efece0760031cbac11cdf2b"`,
    );
    await queryRunner.query(`DROP TABLE "store_payment_accounts"`);
    await queryRunner.query(`DROP TYPE "public"."store_payment_account_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_790b2968701a6ff5ff38323776"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7dd84ec09542fd1f9d7c406216"`,
    );
    await queryRunner.query(`DROP TABLE "stores"`);
  }
}
