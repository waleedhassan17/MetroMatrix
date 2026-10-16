import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns records and reviews with the Chunk 3 contract (docs/API_HEALTH.md):
 * - health_records: `kind` → `type` (lab_report | prescription | scan |
 *   discharge_summary | other) and one file → `files jsonb` (1–10 files);
 * - doctor_reviews: `would_recommend` → `recommend`, `comment` → `text`,
 *   `reply` → `doctor_reply`, `diagnosis` required, tags from the fixed set.
 * Hand-written so existing rows are converted, not dropped.
 */
export class HealthContractAlignment1792150000000 implements MigrationInterface {
  name = 'HealthContractAlignment1792150000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── health_records ──
    await q.query(
      `CREATE TYPE "public"."health_record_type" AS ENUM('lab_report', 'prescription', 'scan', 'discharge_summary', 'other')`,
    );
    await q.query(
      `ALTER TABLE "health_records" ADD "type" "public"."health_record_type"`,
    );
    await q.query(
      `UPDATE "health_records" SET "type" = (CASE "kind"::text WHEN 'imaging' THEN 'scan' WHEN 'vaccination' THEN 'other' ELSE "kind"::text END)::"public"."health_record_type"`,
    );
    await q.query(
      `ALTER TABLE "health_records" ALTER COLUMN "type" SET NOT NULL`,
    );
    await q.query(`ALTER TABLE "health_records" DROP COLUMN "kind"`);
    await q.query(`DROP TYPE "public"."health_record_kind"`);
    await q.query(`ALTER TABLE "health_records" ADD "files" jsonb`);
    await q.query(
      `UPDATE "health_records" SET "files" = jsonb_build_array(jsonb_build_object('url', "file_url", 'publicId', "file_public_id", 'mime', "mime"))`,
    );
    await q.query(
      `ALTER TABLE "health_records" ALTER COLUMN "files" SET NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "health_records" DROP COLUMN "file_url", DROP COLUMN "file_public_id", DROP COLUMN "mime"`,
    );

    // ── doctor_reviews ──
    await q.query(
      `ALTER TABLE "doctor_reviews" RENAME COLUMN "would_recommend" TO "recommend"`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" RENAME COLUMN "comment" TO "text"`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" RENAME COLUMN "reply" TO "doctor_reply"`,
    );
    await q.query(
      `UPDATE "doctor_reviews" SET "diagnosis" = "overall" WHERE "diagnosis" IS NULL`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" ALTER COLUMN "diagnosis" SET NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" DROP CONSTRAINT "CHK_doctor_reviews_scores"`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" ADD CONSTRAINT "CHK_doctor_reviews_scores" CHECK ("overall" BETWEEN 1 AND 5 AND "diagnosis" BETWEEN 1 AND 5 AND ("staff" IS NULL OR "staff" BETWEEN 1 AND 5) AND ("environment" IS NULL OR "environment" BETWEEN 1 AND 5))`,
    );
    // Old tag names map to the fixed set; concern tags are dropped.
    await q.query(
      `UPDATE "doctor_reviews" SET "tags" = ARRAY(
         SELECT DISTINCT CASE t WHEN 'explains_well' THEN 'explained_well' ELSE t END
           FROM unnest("tags") AS t
          WHERE (CASE t WHEN 'explains_well' THEN 'explained_well' ELSE t END) IN
                ('no_wait', 'great_experience', 'explained_well', 'friendly', 'on_time', 'clean_clinic', 'value_for_money'))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "doctor_reviews" DROP CONSTRAINT "CHK_doctor_reviews_scores"`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" ADD CONSTRAINT "CHK_doctor_reviews_scores" CHECK ("overall" BETWEEN 1 AND 5 AND ("diagnosis" IS NULL OR "diagnosis" BETWEEN 1 AND 5) AND ("staff" IS NULL OR "staff" BETWEEN 1 AND 5) AND ("environment" IS NULL OR "environment" BETWEEN 1 AND 5))`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" ALTER COLUMN "diagnosis" DROP NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" RENAME COLUMN "doctor_reply" TO "reply"`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" RENAME COLUMN "text" TO "comment"`,
    );
    await q.query(
      `ALTER TABLE "doctor_reviews" RENAME COLUMN "recommend" TO "would_recommend"`,
    );

    await q.query(
      `ALTER TABLE "health_records" ADD "file_url" character varying(500), ADD "file_public_id" character varying(255), ADD "mime" character varying(80)`,
    );
    await q.query(
      `UPDATE "health_records" SET "file_url" = "files"->0->>'url', "file_public_id" = "files"->0->>'publicId', "mime" = "files"->0->>'mime'`,
    );
    await q.query(
      `ALTER TABLE "health_records" ALTER COLUMN "file_url" SET NOT NULL, ALTER COLUMN "file_public_id" SET NOT NULL`,
    );
    await q.query(`ALTER TABLE "health_records" DROP COLUMN "files"`);
    await q.query(
      `CREATE TYPE "public"."health_record_kind" AS ENUM('lab_report', 'imaging', 'prescription', 'discharge_summary', 'vaccination', 'other')`,
    );
    await q.query(
      `ALTER TABLE "health_records" ADD "kind" "public"."health_record_kind"`,
    );
    await q.query(
      `UPDATE "health_records" SET "kind" = (CASE "type"::text WHEN 'scan' THEN 'imaging' ELSE "type"::text END)::"public"."health_record_kind"`,
    );
    await q.query(
      `ALTER TABLE "health_records" ALTER COLUMN "kind" SET NOT NULL`,
    );
    await q.query(`ALTER TABLE "health_records" DROP COLUMN "type"`);
    await q.query(`DROP TYPE "public"."health_record_type"`);
  }
}
