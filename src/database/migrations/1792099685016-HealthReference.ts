import { MigrationInterface, QueryRunner } from 'typeorm';

export class HealthReference1792099685016 implements MigrationInterface {
  name = 'HealthReference1792099685016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Exclusion constraints on (uuid, tstzrange) need btree_gist (appointments, P3).
    // pg_trgm was created by ShopProducts; IF NOT EXISTS keeps this order-independent.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE TABLE "specialties" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(80) NOT NULL, "name_ur" character varying(120) NOT NULL, "slug" citext NOT NULL, "icon" character varying(40), "description" text, "keywords" text array NOT NULL, "sort" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_ba01cec5aa8ac48778a1d097e98" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6678765a8dcfa5597a6cdf71eb" ON "specialties" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3affe5ce491f6d5fb835582710" ON "specialties" ("is_active", "sort") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."medicine_form" AS ENUM('tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "medicines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "strength" character varying(40) NOT NULL, "form" "public"."medicine_form" NOT NULL, CONSTRAINT "PK_77b93851766f7ab93f71f44b18b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_77071fe66d2b69cabdbad7585c" ON "medicines" ("name", "strength", "form") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conditions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(100) NOT NULL, "name_ur" character varying(140), "slug" citext NOT NULL, "aliases" text array NOT NULL, "is_common" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_3938bdf2933c08ac7af7e0e15e7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d928c50bd8eee2db83364a1105" ON "conditions" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_06f680b827e60b9696a81165dc" ON "conditions" ("is_common") `,
    );
    await queryRunner.query(
      `CREATE TABLE "condition_specialties" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "condition_id" uuid NOT NULL, "specialty_id" uuid NOT NULL, "rank" smallint NOT NULL DEFAULT '1', CONSTRAINT "PK_d8f1764eacf61dfc83af7c7ba83" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c7d9a7b11d600995738acc486" ON "condition_specialties" ("specialty_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_25f8fa723bc92b34bed1d1bbe7" ON "condition_specialties" ("condition_id", "specialty_id") `,
    );
    // Medicine autocomplete is prefix/typo matching on the name.
    await queryRunner.query(
      `CREATE INDEX "IDX_medicines_name_trgm" ON "medicines" USING gin ("name" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `ALTER TABLE "condition_specialties" ADD CONSTRAINT "FK_5ffe819dd2aa4c4f94a6568fbfb" FOREIGN KEY ("condition_id") REFERENCES "conditions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "condition_specialties" ADD CONSTRAINT "FK_5c7d9a7b11d600995738acc4867" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_medicines_name_trgm"`);
    await queryRunner.query(
      `ALTER TABLE "condition_specialties" DROP CONSTRAINT "FK_5c7d9a7b11d600995738acc4867"`,
    );
    await queryRunner.query(
      `ALTER TABLE "condition_specialties" DROP CONSTRAINT "FK_5ffe819dd2aa4c4f94a6568fbfb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25f8fa723bc92b34bed1d1bbe7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c7d9a7b11d600995738acc486"`,
    );
    await queryRunner.query(`DROP TABLE "condition_specialties"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_06f680b827e60b9696a81165dc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d928c50bd8eee2db83364a1105"`,
    );
    await queryRunner.query(`DROP TABLE "conditions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77071fe66d2b69cabdbad7585c"`,
    );
    await queryRunner.query(`DROP TABLE "medicines"`);
    await queryRunner.query(`DROP TYPE "public"."medicine_form"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3affe5ce491f6d5fb835582710"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6678765a8dcfa5597a6cdf71eb"`,
    );
    await queryRunner.query(`DROP TABLE "specialties"`);
  }
}
