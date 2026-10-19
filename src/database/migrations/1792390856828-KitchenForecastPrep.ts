import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenForecastPrep1792390856828 implements MigrationInterface {
  name = 'KitchenForecastPrep1792390856828';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."forecast_method" AS ENUM('learning', 'weekday_avg', 'weighted')`,
    );
    await queryRunner.query(
      `CREATE TABLE "demand_forecasts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "menu_item_id" uuid NOT NULL, "for_date" date NOT NULL, "expected" numeric(8,1) NOT NULL, "low" numeric(8,1) NOT NULL, "high" numeric(8,1) NOT NULL, "method" "public"."forecast_method" NOT NULL, "adjusted" integer, "basis" jsonb NOT NULL DEFAULT '{}', "generated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_6410fe07a31f79cb3a44dcada7f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_60c20bf1aef99f36cc0516a0db" ON "demand_forecasts" ("branch_id", "for_date") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cdd014c74a4bcde41713c5fe39" ON "demand_forecasts" ("branch_id", "menu_item_id", "for_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "forecast_accuracy" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "for_date" date NOT NULL, "mape" numeric(6,1), "items_count" integer NOT NULL, CONSTRAINT "PK_2320bfd01b6673a684ffe23d289" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4edd85c468bdda2843c5f393f0" ON "forecast_accuracy" ("branch_id", "for_date") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."calendar_kind" AS ENUM('ramadan', 'eid', 'public_holiday', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "calendar_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" "public"."calendar_kind" NOT NULL, "name" character varying(120) NOT NULL, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "city" citext, CONSTRAINT "CHK_calendar_events_dates" CHECK ("ends_on" >= "starts_on"), CONSTRAINT "PK_faf5391d232322a87cdd1c6f30c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e2442ee99176a7b65ccefc10d" ON "calendar_events" ("starts_on", "ends_on") `,
    );
    await queryRunner.query(
      `CREATE TABLE "prep_time_stats" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "hour_bucket" smallint NOT NULL, "size_bucket" character varying(4) NOT NULL, "p50_minutes" smallint NOT NULL, "p75_minutes" smallint NOT NULL, "samples" integer NOT NULL, CONSTRAINT "PK_25942914f43b36ba4e6aac85ba5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1e35be941cdd92e1d5576f8423" ON "prep_time_stats" ("branch_id", "hour_bucket", "size_bucket") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."branch_pause_reason" AS ENUM('gas', 'electricity', 'weather', 'staff', 'stock', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD "pause_reason" "public"."branch_pause_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD "auto_resume_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "demand_forecasts" ADD CONSTRAINT "FK_df402a2a8310fc2b46a4dab6ed7" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "demand_forecasts" ADD CONSTRAINT "FK_31675011f826231397f375888fd" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "forecast_accuracy" ADD CONSTRAINT "FK_a1d00be25103290a9a766dd2b40" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prep_time_stats" ADD CONSTRAINT "FK_4c28cb0058b4ef3a5385565c96e" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prep_time_stats" DROP CONSTRAINT "FK_4c28cb0058b4ef3a5385565c96e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "forecast_accuracy" DROP CONSTRAINT "FK_a1d00be25103290a9a766dd2b40"`,
    );
    await queryRunner.query(
      `ALTER TABLE "demand_forecasts" DROP CONSTRAINT "FK_31675011f826231397f375888fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "demand_forecasts" DROP CONSTRAINT "FK_df402a2a8310fc2b46a4dab6ed7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP COLUMN "auto_resume_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP COLUMN "pause_reason"`,
    );
    await queryRunner.query(`DROP TYPE "public"."branch_pause_reason"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e35be941cdd92e1d5576f8423"`,
    );
    await queryRunner.query(`DROP TABLE "prep_time_stats"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e2442ee99176a7b65ccefc10d"`,
    );
    await queryRunner.query(`DROP TABLE "calendar_events"`);
    await queryRunner.query(`DROP TYPE "public"."calendar_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4edd85c468bdda2843c5f393f0"`,
    );
    await queryRunner.query(`DROP TABLE "forecast_accuracy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cdd014c74a4bcde41713c5fe39"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_60c20bf1aef99f36cc0516a0db"`,
    );
    await queryRunner.query(`DROP TABLE "demand_forecasts"`);
    await queryRunner.query(`DROP TYPE "public"."forecast_method"`);
  }
}
