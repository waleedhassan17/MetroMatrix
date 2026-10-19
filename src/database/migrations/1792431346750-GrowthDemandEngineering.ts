import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrowthDemandEngineering1792431346750 implements MigrationInterface {
  name = 'GrowthDemandEngineering1792431346750';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."experiment_status" AS ENUM('active', 'completed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "menu_experiments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "menu_item_id" uuid NOT NULL, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "status" "public"."experiment_status" NOT NULL DEFAULT 'active', "notes" character varying(300), "result" jsonb, "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_menu_experiments_dates" CHECK ("ends_on" >= "starts_on"), CONSTRAINT "PK_3c1aa221186ee7b19797e4efaa6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c5226212c280a717b969f5f0af" ON "menu_experiments" ("branch_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_menu_experiments_active_item" ON "menu_experiments" ("menu_item_id") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."search_kind" AS ENUM('home', 'list', 'search')`,
    );
    await queryRunner.query(
      `CREATE TABLE "search_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "kind" "public"."search_kind" NOT NULL, "geohash6" character varying(6) NOT NULL, "city" citext, "query_norm" character varying(60), "cuisine_id" uuid, "results_count" smallint NOT NULL, "open_results_count" smallint NOT NULL, "hour" smallint NOT NULL, "weekday" smallint NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_search_events_numbers" CHECK ("hour" BETWEEN 0 AND 23 AND "weekday" BETWEEN 0 AND 6 AND "results_count" >= 0 AND "open_results_count" BETWEEN 0 AND "results_count"), CONSTRAINT "PK_c933651b7dda11e9107d4898f16" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2d12764b19ade79adf6a2e14b" ON "search_events" ("city", "at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_866cfd200ca80a75ac4fa6499d" ON "search_events" ("at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."demand_dimension" AS ENUM('all', 'cuisine', 'query')`,
    );
    await queryRunner.query(
      `CREATE TABLE "demand_cells" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "week" date NOT NULL, "city" citext NOT NULL, "geohash6" character varying(6) NOT NULL, "dimension" "public"."demand_dimension" NOT NULL, "cuisine_id" uuid, "query_norm" character varying(60), "hour" smallint, "searches" integer NOT NULL, "zero_results" integer NOT NULL, "closed_results" integer NOT NULL, "orders" integer NOT NULL DEFAULT '0', "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_d695010ae1d681aacc1c26a9dff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_403793555daca2c58e2780f32f" ON "demand_cells" ("city", "week", "dimension") `,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_experiments" ADD CONSTRAINT "FK_2f295add39f13fd55867fa0b1bc" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_experiments" ADD CONSTRAINT "FK_a26e7d68bc67bf3e5d3bcd747af" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menu_experiments" DROP CONSTRAINT "FK_a26e7d68bc67bf3e5d3bcd747af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_experiments" DROP CONSTRAINT "FK_2f295add39f13fd55867fa0b1bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_403793555daca2c58e2780f32f"`,
    );
    await queryRunner.query(`DROP TABLE "demand_cells"`);
    await queryRunner.query(`DROP TYPE "public"."demand_dimension"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_866cfd200ca80a75ac4fa6499d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2d12764b19ade79adf6a2e14b"`,
    );
    await queryRunner.query(`DROP TABLE "search_events"`);
    await queryRunner.query(`DROP TYPE "public"."search_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_menu_experiments_active_item"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5226212c280a717b969f5f0af"`,
    );
    await queryRunner.query(`DROP TABLE "menu_experiments"`);
    await queryRunner.query(`DROP TYPE "public"."experiment_status"`);
  }
}
