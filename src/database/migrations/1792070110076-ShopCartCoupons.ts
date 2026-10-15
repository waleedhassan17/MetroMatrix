import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShopCartCoupons1792070110076 implements MigrationInterface {
  name = 'ShopCartCoupons1792070110076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wishlist_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "product_id" uuid NOT NULL, CONSTRAINT "PK_0bd52924a97cda208ed2a07bd69" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_177397e044732e7e9c0215cd5b" ON "wishlist_items" ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b8ce7bf02c0fc4aa3faffceb9" ON "wishlist_items" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e0584a3664156caa678765afad" ON "wishlist_items" ("user_id", "product_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."coupon_type" AS ENUM('percent', 'fixed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "coupons" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_id" uuid NOT NULL, "code" character varying(20) NOT NULL, "type" "public"."coupon_type" NOT NULL, "value" integer NOT NULL, "min_order" integer NOT NULL DEFAULT '0', "max_discount" integer, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "usage_limit" integer, "per_user_limit" integer NOT NULL DEFAULT '1', "used_count" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "CHK_coupons_amounts" CHECK ("min_order" >= 0 AND "per_user_limit" >= 1), CONSTRAINT "CHK_coupons_usage" CHECK ("used_count" >= 0 AND ("usage_limit" IS NULL OR "used_count" <= "usage_limit")), CONSTRAINT "CHK_coupons_window" CHECK ("ends_at" > "starts_at"), CONSTRAINT "CHK_coupons_value" CHECK ("value" > 0 AND ("type" <> 'percent' OR "value" <= 100)), CONSTRAINT "PK_d7ea8864a0150183770f3e9a8cb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2693338dbaafac8f0d3dac3b6f" ON "coupons" ("store_id", "code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "coupon_redemptions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "coupon_id" uuid NOT NULL, "user_id" uuid NOT NULL, "store_order_id" uuid NOT NULL, "discount" integer NOT NULL, CONSTRAINT "PK_5086813ea980d21dbeb190ed0a7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b5e7cd26a25dec9ae7afa947cf" ON "coupon_redemptions" ("store_order_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd4cda7c82246e92c50453fda3" ON "coupon_redemptions" ("coupon_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "carts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, CONSTRAINT "PK_b5f695a59f5ebb50af3c8160816" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2ec1c94a977b940d85a4f498ae" ON "carts" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cart_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cart_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "quantity" integer NOT NULL, "price_at_add" integer NOT NULL, CONSTRAINT "CHK_cart_items_quantity" CHECK ("quantity" BETWEEN 1 AND 20), CONSTRAINT "PK_6fccf5ec03c172d27a28a82928b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ede780fc2b865d1d1323e59803" ON "cart_items" ("variant_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d1a62275445322e93824d33dbf" ON "cart_items" ("cart_id", "variant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "wishlist_items" ADD CONSTRAINT "FK_549f44d8b756e2690deb099f83b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wishlist_items" ADD CONSTRAINT "FK_177397e044732e7e9c0215cd5b7" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" ADD CONSTRAINT "FK_541e70be595a5839bcd23756257" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_9df1b9bc48e3eea5da3762f8e56" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_986f8dd830915cf2835f89709df" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "carts" ADD CONSTRAINT "FK_2ec1c94a977b940d85a4f498aea" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD CONSTRAINT "FK_6385a745d9e12a89b859bb25623" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD CONSTRAINT "FK_ede780fc2b865d1d1323e598038" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cart_items" DROP CONSTRAINT "FK_ede780fc2b865d1d1323e598038"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" DROP CONSTRAINT "FK_6385a745d9e12a89b859bb25623"`,
    );
    await queryRunner.query(
      `ALTER TABLE "carts" DROP CONSTRAINT "FK_2ec1c94a977b940d85a4f498aea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_986f8dd830915cf2835f89709df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_9df1b9bc48e3eea5da3762f8e56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupons" DROP CONSTRAINT "FK_541e70be595a5839bcd23756257"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wishlist_items" DROP CONSTRAINT "FK_177397e044732e7e9c0215cd5b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wishlist_items" DROP CONSTRAINT "FK_549f44d8b756e2690deb099f83b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d1a62275445322e93824d33dbf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ede780fc2b865d1d1323e59803"`,
    );
    await queryRunner.query(`DROP TABLE "cart_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ec1c94a977b940d85a4f498ae"`,
    );
    await queryRunner.query(`DROP TABLE "carts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd4cda7c82246e92c50453fda3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5e7cd26a25dec9ae7afa947cf"`,
    );
    await queryRunner.query(`DROP TABLE "coupon_redemptions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2693338dbaafac8f0d3dac3b6f"`,
    );
    await queryRunner.query(`DROP TABLE "coupons"`);
    await queryRunner.query(`DROP TYPE "public"."coupon_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e0584a3664156caa678765afad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b8ce7bf02c0fc4aa3faffceb9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_177397e044732e7e9c0215cd5b"`,
    );
    await queryRunner.query(`DROP TABLE "wishlist_items"`);
  }
}
