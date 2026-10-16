import { MigrationInterface, QueryRunner } from 'typeorm';

export class HealthDoctorsPractice1792100568027 implements MigrationInterface {
  name = 'HealthDoctorsPractice1792100568027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."doctor_title" AS ENUM('dr', 'prof', 'assoc_prof', 'asst_prof')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."person_gender" AS ENUM('male', 'female', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "doctors" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid NOT NULL, "title" "public"."doctor_title" NOT NULL DEFAULT 'dr', "full_name" character varying(120) NOT NULL, "gender" "public"."person_gender", "photo_url" character varying(500), "pmdc_number" citext NOT NULL, "pmdc_verified_at" TIMESTAMP WITH TIME ZONE, "pmdc_verified_by" uuid, "primary_specialty_id" uuid, "practicing_since" smallint, "about" text, "languages" text array NOT NULL, "booking_window_days" smallint NOT NULL DEFAULT '14', "min_notice_minutes" integer NOT NULL DEFAULT '60', "cancel_cutoff_minutes" integer NOT NULL DEFAULT '120', "video_prepay_required" boolean NOT NULL DEFAULT false, "is_listed" boolean NOT NULL DEFAULT false, "is_accepting" boolean NOT NULL DEFAULT true, "unlisted_reason" text, "rating_avg" numeric(3,2) NOT NULL DEFAULT '0', "rating_count" integer NOT NULL DEFAULT '0', "satisfaction_pct" smallint, "avg_wait_minutes" smallint, "avg_consult_minutes" smallint, "patients_served" integer NOT NULL DEFAULT '0', "completed_30d" integer NOT NULL DEFAULT '0', "is_top_booked" boolean NOT NULL DEFAULT false, "next_available_at" TIMESTAMP WITH TIME ZONE, "daily_digest_on" date, "search" tsvector, CONSTRAINT "CHK_doctors_booking_rules" CHECK ("booking_window_days" BETWEEN 1 AND 30 AND "min_notice_minutes" >= 0 AND "cancel_cutoff_minutes" >= 0), CONSTRAINT "PK_8207e7889b50ee3695c2b8154ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac91a1e11846a208be729f80b8" ON "doctors" ("is_listed", "primary_specialty_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6da2a6034d459adcde9cfaf727" ON "doctors" ("pmdc_number") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_505bc183c670ce648ed2887ecb" ON "doctors" ("business_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."practice_location_kind" AS ENUM('clinic', 'video')`,
    );
    await queryRunner.query(
      `CREATE TABLE "practice_locations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "kind" "public"."practice_location_kind" NOT NULL, "name" character varying(140) NOT NULL, "address_line" character varying(255), "area" character varying(80), "city" character varying(60), "lat" numeric(9,6), "lng" numeric(9,6), "phone" character varying(16), "timezone" character varying(60) NOT NULL DEFAULT 'Asia/Karachi', "fee" integer NOT NULL, "slot_minutes" smallint NOT NULL DEFAULT '15', "instructions" text, "is_active" boolean NOT NULL DEFAULT true, "next_available_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_practice_locations_rules" CHECK ("fee" >= 0 AND "slot_minutes" BETWEEN 10 AND 60), CONSTRAINT "PK_2727163104229e3fd2123b9cc6c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_practice_locations_one_video" ON "practice_locations" ("doctor_id") WHERE "kind" = 'video' AND "is_active"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2ec087e9512639299f4ff2ff2" ON "practice_locations" ("city", "is_active") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_457a3e2f05c51599e9d366d505" ON "practice_locations" ("doctor_id", "is_active") `,
    );
    await queryRunner.query(
      `CREATE TABLE "weekly_schedules" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "location_id" uuid NOT NULL, "weekday" smallint NOT NULL, "start_time" TIME NOT NULL, "end_time" TIME NOT NULL, CONSTRAINT "CHK_weekly_schedules_range" CHECK ("weekday" BETWEEN 0 AND 6 AND "end_time" > "start_time"), CONSTRAINT "PK_c14aa04ae270430a6eb8444108c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2689460c428c6399977cffa9b" ON "weekly_schedules" ("location_id", "weekday") `,
    );
    await queryRunner.query(
      `CREATE TABLE "time_off" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "location_id" uuid, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "reason" character varying(200), CONSTRAINT "CHK_time_off_range" CHECK ("ends_at" > "starts_at"), CONSTRAINT "PK_e80a790cc96026d0f557a78f83d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2637d83ace38e50baf9fc9387" ON "time_off" ("doctor_id", "starts_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."doctor_payment_account_kind" AS ENUM('raast', 'jazzcash', 'easypaisa', 'bank')`,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_payment_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "kind" "public"."doctor_payment_account_kind" NOT NULL, "account_title" character varying(80) NOT NULL, "account_number" character varying(34) NOT NULL, "bank_name" character varying(80), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_4b58f7ad484908ff76872ce0aa6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9ed049ee12b85828725880162c" ON "doctor_payment_accounts" ("doctor_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e91249151f0dbd4c7c0d11e2d5" ON "doctor_payment_accounts" ("doctor_id", "account_number") `,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_specialties" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "specialty_id" uuid NOT NULL, CONSTRAINT "PK_28e3c8a89299955a87ece809dbe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa46305c77b7a2db967573a469" ON "doctor_specialties" ("specialty_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b9661cc766435ab56169b3fbe5" ON "doctor_specialties" ("doctor_id", "specialty_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_qualifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "degree" character varying(80) NOT NULL, "institute" character varying(160) NOT NULL, "year" smallint, "sort" smallint NOT NULL DEFAULT '0', CONSTRAINT "PK_abb58dade9756456c16ad63650f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55c0f80b7c4924bfe36bb4c2e8" ON "doctor_qualifications" ("doctor_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_experiences" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "designation" character varying(120) NOT NULL, "institute" character varying(160) NOT NULL, "from_year" smallint NOT NULL, "to_year" smallint, "sort" smallint NOT NULL DEFAULT '0', CONSTRAINT "CHK_doctor_experiences_years" CHECK ("to_year" IS NULL OR "to_year" >= "from_year"), CONSTRAINT "PK_566bd0332347118d996b90407aa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e75638715ac1d3a45e25e0b857" ON "doctor_experiences" ("doctor_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_services" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "sort" smallint NOT NULL DEFAULT '0', CONSTRAINT "PK_576dd4346e554b2ba3f27878be8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13ea50e201e77a7cc5ebbb66e7" ON "doctor_services" ("doctor_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_conditions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "condition_id" uuid NOT NULL, CONSTRAINT "PK_313e710d1b5889f26fcdcd16118" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0459e8ef8e19450209298babc4" ON "doctor_conditions" ("condition_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a3e693c3e88f8989b2fcc74b24" ON "doctor_conditions" ("doctor_id", "condition_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "businesses" ADD "pmdc_number" citext`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_businesses_pmdc_number" ON "businesses" ("pmdc_number") WHERE "pmdc_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD CONSTRAINT "FK_505bc183c670ce648ed2887ecbe" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD CONSTRAINT "FK_d6fb39303d62f40b210c4789c95" FOREIGN KEY ("pmdc_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD CONSTRAINT "FK_c76c4ccb5eef69eb536ad285f03" FOREIGN KEY ("primary_specialty_id") REFERENCES "specialties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_locations" ADD CONSTRAINT "FK_08a67ab7dc004ff94ff28d742a8" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "weekly_schedules" ADD CONSTRAINT "FK_03d2dc17e67f04a0cbf0a6c1c98" FOREIGN KEY ("location_id") REFERENCES "practice_locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "time_off" ADD CONSTRAINT "FK_50f8597e70e2fa96ed3c3a3ae70" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "time_off" ADD CONSTRAINT "FK_b26ae5dc419a68fd176740ec223" FOREIGN KEY ("location_id") REFERENCES "practice_locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_payment_accounts" ADD CONSTRAINT "FK_9ed049ee12b85828725880162c3" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_specialties" ADD CONSTRAINT "FK_a8c31ec7ac7398ea78c231d7bd8" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_specialties" ADD CONSTRAINT "FK_fa46305c77b7a2db967573a4695" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_qualifications" ADD CONSTRAINT "FK_7f2488f7cc6fa8642f35e138720" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_experiences" ADD CONSTRAINT "FK_656251b0b3568c46f763e6e7581" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_services" ADD CONSTRAINT "FK_7332c5a1ffea02df1ef5c16c552" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_conditions" ADD CONSTRAINT "FK_45d6fc2bc01d717cf480a803f2b" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_conditions" ADD CONSTRAINT "FK_0459e8ef8e19450209298babc46" FOREIGN KEY ("condition_id") REFERENCES "conditions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Search: names and Urdu with the simple config, specialties/conditions/
    // services with english (stemmed). The vector spans tables, so a function
    // the services call keeps it current (not a generated column/trigger).
    await queryRunner.query(
      `CREATE INDEX "IDX_doctors_search" ON "doctors" USING gin ("search")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_doctors_full_name_trgm" ON "doctors" USING gin ("full_name" gin_trgm_ops)`,
    );
    await queryRunner.query(`
          CREATE OR REPLACE FUNCTION doctor_search_refresh(target uuid) RETURNS void
          LANGUAGE sql AS $fn$
            WITH spec AS (
              SELECT s.name, s.name_ur, array_to_string(s.keywords, ' ') AS kw
                FROM specialties s
               WHERE s.id = (SELECT primary_specialty_id FROM doctors WHERE id = target)
                  OR s.id IN (SELECT specialty_id FROM doctor_specialties WHERE doctor_id = target)
            ), cond AS (
              SELECT c.name, coalesce(c.name_ur, '') AS name_ur, array_to_string(c.aliases, ' ') AS al
                FROM doctor_conditions dc JOIN conditions c ON c.id = dc.condition_id
               WHERE dc.doctor_id = target
            )
            UPDATE doctors d SET search =
                 setweight(to_tsvector('simple', coalesce(d.full_name, '')), 'A')
              || setweight(to_tsvector('english', coalesce((SELECT string_agg(name || ' ' || kw, ' ') FROM spec), '')), 'B')
              || setweight(to_tsvector('simple', coalesce((SELECT string_agg(name_ur, ' ') FROM spec), '')), 'B')
              || setweight(to_tsvector('english', coalesce((SELECT string_agg(name || ' ' || al, ' ') FROM cond), '')), 'C')
              || setweight(to_tsvector('simple', coalesce((SELECT string_agg(name_ur, ' ') FROM cond), '')), 'C')
              || setweight(to_tsvector('english', coalesce((SELECT string_agg(name, ' ') FROM doctor_services WHERE doctor_id = target), '')), 'D')
             WHERE d.id = target
          $fn$`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS doctor_search_refresh(uuid)`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_doctors_full_name_trgm"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_doctors_search"`);
    await queryRunner.query(
      `ALTER TABLE "doctor_conditions" DROP CONSTRAINT "FK_0459e8ef8e19450209298babc46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_conditions" DROP CONSTRAINT "FK_45d6fc2bc01d717cf480a803f2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_services" DROP CONSTRAINT "FK_7332c5a1ffea02df1ef5c16c552"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_experiences" DROP CONSTRAINT "FK_656251b0b3568c46f763e6e7581"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_qualifications" DROP CONSTRAINT "FK_7f2488f7cc6fa8642f35e138720"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_specialties" DROP CONSTRAINT "FK_fa46305c77b7a2db967573a4695"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_specialties" DROP CONSTRAINT "FK_a8c31ec7ac7398ea78c231d7bd8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_payment_accounts" DROP CONSTRAINT "FK_9ed049ee12b85828725880162c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "time_off" DROP CONSTRAINT "FK_b26ae5dc419a68fd176740ec223"`,
    );
    await queryRunner.query(
      `ALTER TABLE "time_off" DROP CONSTRAINT "FK_50f8597e70e2fa96ed3c3a3ae70"`,
    );
    await queryRunner.query(
      `ALTER TABLE "weekly_schedules" DROP CONSTRAINT "FK_03d2dc17e67f04a0cbf0a6c1c98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_locations" DROP CONSTRAINT "FK_08a67ab7dc004ff94ff28d742a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT "FK_c76c4ccb5eef69eb536ad285f03"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT "FK_d6fb39303d62f40b210c4789c95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP CONSTRAINT "FK_505bc183c670ce648ed2887ecbe"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_businesses_pmdc_number"`);
    await queryRunner.query(
      `ALTER TABLE "businesses" DROP COLUMN "pmdc_number"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a3e693c3e88f8989b2fcc74b24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0459e8ef8e19450209298babc4"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_conditions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13ea50e201e77a7cc5ebbb66e7"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_services"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e75638715ac1d3a45e25e0b857"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_experiences"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55c0f80b7c4924bfe36bb4c2e8"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_qualifications"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9661cc766435ab56169b3fbe5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa46305c77b7a2db967573a469"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_specialties"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e91249151f0dbd4c7c0d11e2d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9ed049ee12b85828725880162c"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_payment_accounts"`);
    await queryRunner.query(`DROP TYPE "public"."doctor_payment_account_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2637d83ace38e50baf9fc9387"`,
    );
    await queryRunner.query(`DROP TABLE "time_off"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2689460c428c6399977cffa9b"`,
    );
    await queryRunner.query(`DROP TABLE "weekly_schedules"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_457a3e2f05c51599e9d366d505"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2ec087e9512639299f4ff2ff2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_practice_locations_one_video"`,
    );
    await queryRunner.query(`DROP TABLE "practice_locations"`);
    await queryRunner.query(`DROP TYPE "public"."practice_location_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_505bc183c670ce648ed2887ecb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6da2a6034d459adcde9cfaf727"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac91a1e11846a208be729f80b8"`,
    );
    await queryRunner.query(`DROP TABLE "doctors"`);
    await queryRunner.query(`DROP TYPE "public"."person_gender"`);
    await queryRunner.query(`DROP TYPE "public"."doctor_title"`);
  }
}
