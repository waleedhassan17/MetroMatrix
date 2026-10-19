import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenAssistant1792438647589 implements MigrationInterface {
  name = 'KitchenAssistant1792438647589';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."review_insight_method" AS ENUM('ai', 'lexicon')`,
    );
    await queryRunner.query(
      `CREATE TABLE "review_insights" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "brand_id" uuid NOT NULL, "period_start" date NOT NULL, "period_end" date NOT NULL, "review_count" integer NOT NULL, "themes" jsonb NOT NULL, "method" "public"."review_insight_method" NOT NULL, "headline" character varying(160), "covered_until" TIMESTAMP WITH TIME ZONE NOT NULL, "pushed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_4c8a9865092cf90dc992569048e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_review_insights_brand_day" ON "review_insights" ("brand_id", "period_end") `,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "description_ur" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_insights" ADD CONSTRAINT "FK_79f2c8734590dfc2f748729245d" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_insights" DROP CONSTRAINT "FK_79f2c8734590dfc2f748729245d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" DROP COLUMN "description_ur"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_review_insights_brand_day"`,
    );
    await queryRunner.query(`DROP TABLE "review_insights"`);
    await queryRunner.query(`DROP TYPE "public"."review_insight_method"`);
  }
}
