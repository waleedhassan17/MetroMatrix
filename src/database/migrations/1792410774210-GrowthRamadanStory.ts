import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrowthRamadanStory1792410774210 implements MigrationInterface {
  name = 'GrowthRamadanStory1792410774210';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."hygiene_status" AS ENUM('self_declared', 'verified')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."hygiene_method" AS ENUM('visit', 'video_call')`,
    );
    await queryRunner.query(
      `CREATE TABLE "kitchen_stories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "brand_id" uuid NOT NULL, "story" text, "cook_name" character varying(80), "video_url" text, "photos" jsonb NOT NULL DEFAULT '[]', "hygiene_checklist" jsonb, "hygiene_status" "public"."hygiene_status", "declared_at" TIMESTAMP WITH TIME ZONE, "verified_by" uuid, "verified_at" TIMESTAMP WITH TIME ZONE, "verified_method" "public"."hygiene_method", "verified_note" character varying(300), CONSTRAINT "PK_5f98185456308ccda8fe94febfc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kitchen_stories_hygiene" ON "kitchen_stories" ("hygiene_status", "declared_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_kitchen_stories_brand" ON "kitchen_stories" ("brand_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ramadan_settings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "sehri_from" TIME, "sehri_to" TIME, "iftar_from" TIME, "iftar_to" TIME, "iftar_preorder_only" boolean NOT NULL DEFAULT false, "notes" character varying(300), CONSTRAINT "CHK_ramadan_settings_windows" CHECK (("sehri_from" IS NULL) = ("sehri_to" IS NULL) AND ("iftar_from" IS NULL) = ("iftar_to" IS NULL)), CONSTRAINT "PK_820094452fbf1d8644221fada93" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ramadan_settings_branch" ON "ramadan_settings" ("branch_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" ADD "signature_removed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" ADD "signature_removed_reason" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_stories" ADD CONSTRAINT "FK_d164ef1ccf602c3f507f7cf076d" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ramadan_settings" ADD CONSTRAINT "FK_8af0b52d8c0e5e04ca5ac6fe0e6" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ramadan_settings" DROP CONSTRAINT "FK_8af0b52d8c0e5e04ca5ac6fe0e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_stories" DROP CONSTRAINT "FK_d164ef1ccf602c3f507f7cf076d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" DROP COLUMN "signature_removed_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recipe_cards" DROP COLUMN "signature_removed_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_ramadan_settings_branch"`);
    await queryRunner.query(`DROP TABLE "ramadan_settings"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_kitchen_stories_brand"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kitchen_stories_hygiene"`,
    );
    await queryRunner.query(`DROP TABLE "kitchen_stories"`);
    await queryRunner.query(`DROP TYPE "public"."hygiene_method"`);
    await queryRunner.query(`DROP TYPE "public"."hygiene_status"`);
  }
}
