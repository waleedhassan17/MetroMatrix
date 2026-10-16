import { MigrationInterface, QueryRunner } from 'typeorm';

export class HealthRecordsReviews1792147097731 implements MigrationInterface {
  name = 'HealthRecordsReviews1792147097731';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "doctor_reviews" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "appointment_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "patient_user_id" uuid NOT NULL, "kind" "public"."practice_location_kind" NOT NULL, "overall" smallint NOT NULL, "diagnosis" smallint, "staff" smallint, "environment" smallint, "would_recommend" boolean NOT NULL, "tags" text array NOT NULL DEFAULT '{}', "comment" text, "is_anonymous" boolean NOT NULL DEFAULT false, "author_name" character varying(80) NOT NULL, "reply" text, "replied_at" TIMESTAMP WITH TIME ZONE, "hidden_at" TIMESTAMP WITH TIME ZONE, "hidden_reason" text, "hidden_by_user_id" uuid, CONSTRAINT "CHK_doctor_reviews_scores" CHECK ("overall" BETWEEN 1 AND 5 AND ("diagnosis" IS NULL OR "diagnosis" BETWEEN 1 AND 5) AND ("staff" IS NULL OR "staff" BETWEEN 1 AND 5) AND ("environment" IS NULL OR "environment" BETWEEN 1 AND 5)), CONSTRAINT "PK_f0335ada748eaa9095e27288a97" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_86205005f7de08a666cbf318e1" ON "doctor_reviews" ("patient_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2daac8c646d1f732926151d230" ON "doctor_reviews" ("doctor_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c734e2cb2754e4a6e2651ca73d" ON "doctor_reviews" ("appointment_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."health_record_kind" AS ENUM('lab_report', 'imaging', 'prescription', 'discharge_summary', 'vaccination', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "health_records" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "family_member_id" uuid, "title" character varying(120) NOT NULL, "kind" "public"."health_record_kind" NOT NULL, "record_date" date, "notes" text, "file_url" character varying(500) NOT NULL, "file_public_id" character varying(255) NOT NULL, "mime" character varying(80), CONSTRAINT "PK_adbd60dda85d616da89ba3f8270" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccdaa0573058fa491532c304ce" ON "health_records" ("family_member_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3605bb0d243888880967ee31be" ON "health_records" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "appointment_attachments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "appointment_id" uuid NOT NULL, "record_id" uuid NOT NULL, CONSTRAINT "PK_4bf2ebc9072a99be7e68b81b45a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e481691f9f1d9d57f5e4415173" ON "appointment_attachments" ("record_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3e7533df7d0600f28ba1c76c0a" ON "appointment_attachments" ("appointment_id", "record_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_reviews" ADD CONSTRAINT "FK_c734e2cb2754e4a6e2651ca73d8" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_reviews" ADD CONSTRAINT "FK_38dc65a98266f746f273b5418f8" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_reviews" ADD CONSTRAINT "FK_86205005f7de08a666cbf318e1c" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_records" ADD CONSTRAINT "FK_afd88b801861562a26fea4ba780" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_records" ADD CONSTRAINT "FK_ccdaa0573058fa491532c304cef" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" ADD CONSTRAINT "FK_47aa5c2ec104c31216eee797220" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" ADD CONSTRAINT "FK_e481691f9f1d9d57f5e44151737" FOREIGN KEY ("record_id") REFERENCES "health_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" DROP CONSTRAINT "FK_e481691f9f1d9d57f5e44151737"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" DROP CONSTRAINT "FK_47aa5c2ec104c31216eee797220"`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_records" DROP CONSTRAINT "FK_ccdaa0573058fa491532c304cef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_records" DROP CONSTRAINT "FK_afd88b801861562a26fea4ba780"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_reviews" DROP CONSTRAINT "FK_86205005f7de08a666cbf318e1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_reviews" DROP CONSTRAINT "FK_38dc65a98266f746f273b5418f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_reviews" DROP CONSTRAINT "FK_c734e2cb2754e4a6e2651ca73d8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e7533df7d0600f28ba1c76c0a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e481691f9f1d9d57f5e4415173"`,
    );
    await queryRunner.query(`DROP TABLE "appointment_attachments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3605bb0d243888880967ee31be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccdaa0573058fa491532c304ce"`,
    );
    await queryRunner.query(`DROP TABLE "health_records"`);
    await queryRunner.query(`DROP TYPE "public"."health_record_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c734e2cb2754e4a6e2651ca73d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2daac8c646d1f732926151d230"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_86205005f7de08a666cbf318e1"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_reviews"`);
  }
}
