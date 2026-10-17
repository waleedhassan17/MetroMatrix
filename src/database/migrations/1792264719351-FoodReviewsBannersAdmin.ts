import { MigrationInterface, QueryRunner } from 'typeorm';

export class FoodReviewsBannersAdmin1792264719351 implements MigrationInterface {
  name = 'FoodReviewsBannersAdmin1792264719351';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "food_reviews" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "brand_id" uuid NOT NULL, "user_id" uuid NOT NULL, "food_rating" smallint NOT NULL, "delivery_rating" smallint, "tags" text array NOT NULL DEFAULT '{}', "text" character varying(1000), "photos" text array NOT NULL DEFAULT '{}', "vendor_reply" character varying(1000), "replied_at" TIMESTAMP WITH TIME ZONE, "is_hidden" boolean NOT NULL DEFAULT false, "hidden_reason" character varying(300), CONSTRAINT "CHK_food_reviews_ratings" CHECK ("food_rating" BETWEEN 1 AND 5 AND ("delivery_rating" IS NULL OR "delivery_rating" BETWEEN 1 AND 5)), CONSTRAINT "PK_ac20968ee78f19bed54aed925bf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1bcc73dcc42fc3b9e2021a3471" ON "food_reviews" ("brand_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_29404596d62fd4d30afc053f94" ON "food_reviews" ("order_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_banner_target" AS ENUM('vendor', 'cuisine', 'search')`,
    );
    await queryRunner.query(
      `CREATE TABLE "food_banners" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "image_url" character varying(500) NOT NULL, "title" character varying(80) NOT NULL, "subtitle" character varying(160), "target_type" "public"."food_banner_target" NOT NULL, "target_id" uuid, "target_query" character varying(80), "city" character varying(60), "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE, "sort" smallint NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_80bd665e4badcb337957a418e4d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0548b1694a3eedf33e76381fc6" ON "food_banners" ("is_active", "starts_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD "portions_reset_on" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_reviews" ADD CONSTRAINT "FK_29404596d62fd4d30afc053f94b" FOREIGN KEY ("order_id") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_reviews" ADD CONSTRAINT "FK_432227cc2266cdd116cee9b026f" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_reviews" ADD CONSTRAINT "FK_a8d0e3d94d96554da49f3f3d8af" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "food_reviews" DROP CONSTRAINT "FK_a8d0e3d94d96554da49f3f3d8af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_reviews" DROP CONSTRAINT "FK_432227cc2266cdd116cee9b026f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_reviews" DROP CONSTRAINT "FK_29404596d62fd4d30afc053f94b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP COLUMN "portions_reset_on"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0548b1694a3eedf33e76381fc6"`,
    );
    await queryRunner.query(`DROP TABLE "food_banners"`);
    await queryRunner.query(`DROP TYPE "public"."food_banner_target"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_29404596d62fd4d30afc053f94"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1bcc73dcc42fc3b9e2021a3471"`,
    );
    await queryRunner.query(`DROP TABLE "food_reviews"`);
  }
}
