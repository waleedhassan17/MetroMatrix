import { MigrationInterface, QueryRunner } from 'typeorm';

/** food_item_search_refresh, with or without the Urdu name (FoodMenu defined it without). */
const itemSearchFn = (withUrdu: boolean) => `
  CREATE OR REPLACE FUNCTION food_item_search_refresh(target uuid) RETURNS void
  LANGUAGE sql AS $fn$
    UPDATE menu_items i SET search =
         setweight(to_tsvector('simple', coalesce(i.name, '')), 'A')
      || setweight(to_tsvector('english', coalesce(i.name, '')), 'A')${
        withUrdu
          ? `
      || setweight(to_tsvector('simple', coalesce(i.name_ur, '')), 'A')`
          : ''
      }
      || setweight(to_tsvector('simple', coalesce(array_to_string(i.tags, ' '), '')), 'B')
      || setweight(to_tsvector('english', coalesce((SELECT c.name FROM menu_categories c WHERE c.id = i.category_id), '')), 'B')
      || setweight(to_tsvector('english', coalesce(i.description, '')), 'C')
     WHERE i.id = target
  $fn$`;

export class AiFoundation1792362343230 implements MigrationInterface {
  name = 'AiFoundation1792362343230';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ingredient_aliases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "alias" citext NOT NULL, "canonical" character varying(80) NOT NULL, "lang" character varying(6) NOT NULL, CONSTRAINT "CHK_ingredient_aliases_lang" CHECK ("lang" IN ('en', 'ur', 'roman')), CONSTRAINT "PK_f4e0ad573581546adcbf551d912" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fd0312bb4cc0bbe2377d82c7ec" ON "ingredient_aliases" ("alias") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3d4d1c14337dda3cc895357d5" ON "ingredient_aliases" ("canonical") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."voice_log_status" AS ENUM('proposed', 'unclear', 'unavailable')`,
    );
    await queryRunner.query(
      `CREATE TABLE "voice_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid, "user_id" uuid NOT NULL, "context" character varying(20) NOT NULL, "language_hint" character varying(4) NOT NULL, "audio_url" character varying(500), "audio_seconds" integer NOT NULL DEFAULT '0', "transcript" text, "language" character varying(8), "intent" character varying(40), "slots" jsonb, "confidence" numeric(3,2), "source" character varying(8), "status" "public"."voice_log_status" NOT NULL, "audio_deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c88bc930653b4c23de462cf55e5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e0c984492176bd9d9d337795e5" ON "voice_logs" ("business_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_voice_logs_audio_pending" ON "voice_logs" ("created_at") WHERE "audio_url" IS NOT NULL AND "audio_deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ce3849716bf933802ffe4099c" ON "voice_logs" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ai_usage_status" AS ENUM('ok', 'invalid', 'timeout', 'quota', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_usage" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid, "user_id" uuid, "feature" character varying(40) NOT NULL, "prompt_id" character varying(60) NOT NULL, "prompt_version" smallint NOT NULL, "tokens_in" integer NOT NULL DEFAULT '0', "tokens_out" integer NOT NULL DEFAULT '0', "latency_ms" integer NOT NULL DEFAULT '0', "status" "public"."ai_usage_status" NOT NULL, "cached" boolean NOT NULL DEFAULT false, "audio_seconds" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_3dddab3a15520a9c3eba859195d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d7eb088ba13fe812e9c48176d" ON "ai_usage" ("feature", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cab503a498dbd6abfe51db43ad" ON "ai_usage" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_227aa9b052e02846c70682ca5b" ON "ai_usage" ("business_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_cache" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cache_key" character varying(64) NOT NULL, "prompt_id" character varying(60) NOT NULL, "prompt_version" smallint NOT NULL, "output" jsonb NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_30b792e08262273016a05f34517" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_312f8b7d101835c1e0423b4cf8" ON "ai_cache" ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9f59baef086138cc08e67be58c" ON "ai_cache" ("cache_key") `,
    );
    await queryRunner.query(
      `ALTER TABLE "menu_items" ADD "name_ur" character varying(120)`,
    );
    // Search finds a dish by its Urdu name too.
    await queryRunner.query(itemSearchFn(true));
    await queryRunner.query(
      `ALTER TABLE "voice_logs" ADD CONSTRAINT "FK_99d8ca85578820809755326a6b2" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_usage" ADD CONSTRAINT "FK_d4305fb5b2364d21c192cbe588a" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_usage" ADD CONSTRAINT "FK_1b342fd5b20e5ffca652770404d" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_usage" DROP CONSTRAINT "FK_1b342fd5b20e5ffca652770404d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_usage" DROP CONSTRAINT "FK_d4305fb5b2364d21c192cbe588a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "voice_logs" DROP CONSTRAINT "FK_99d8ca85578820809755326a6b2"`,
    );
    await queryRunner.query(itemSearchFn(false));
    await queryRunner.query(`ALTER TABLE "menu_items" DROP COLUMN "name_ur"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f59baef086138cc08e67be58c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_312f8b7d101835c1e0423b4cf8"`,
    );
    await queryRunner.query(`DROP TABLE "ai_cache"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_227aa9b052e02846c70682ca5b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cab503a498dbd6abfe51db43ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d7eb088ba13fe812e9c48176d"`,
    );
    await queryRunner.query(`DROP TABLE "ai_usage"`);
    await queryRunner.query(`DROP TYPE "public"."ai_usage_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ce3849716bf933802ffe4099c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_voice_logs_audio_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e0c984492176bd9d9d337795e5"`,
    );
    await queryRunner.query(`DROP TABLE "voice_logs"`);
    await queryRunner.query(`DROP TYPE "public"."voice_log_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3d4d1c14337dda3cc895357d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd0312bb4cc0bbe2377d82c7ec"`,
    );
    await queryRunner.query(`DROP TABLE "ingredient_aliases"`);
  }
}
