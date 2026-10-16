import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Health home's staff banners (health_banners) and an icon key on
 * conditions for the home's concern chips. The common conditions get their
 * icons here, in the specialties' vocabulary; admins edit them afterwards.
 */
const CONDITION_ICONS: Array<[slug: string, icon: string]> = [
  ['acne', 'sparkles'],
  ['hair-loss', 'skin'],
  ['fever', 'thermometer'],
  ['cough', 'lungs'],
  ['diabetes', 'drop'],
  ['hypertension', 'heart-pulse'],
  ['migraine', 'flash'],
  ['back-pain', 'physio'],
  ['depression', 'cloud'],
  ['pregnancy', 'female'],
  ['uti', 'kidney'],
  ['acidity', 'flame'],
  ['toothache', 'tooth'],
];

export class HealthBanners1792193644039 implements MigrationInterface {
  name = 'HealthBanners1792193644039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."health_banner_target" AS ENUM('specialty', 'condition', 'doctor', 'screen', 'none')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."health_banner_screen" AS ENUM('video_consultation', 'symptom_checker', 'emergency', 'records', 'available_today')`,
    );
    await queryRunner.query(
      `CREATE TABLE "health_banners" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "image_url" character varying(500) NOT NULL, "title" character varying(80) NOT NULL, "subtitle" character varying(140), "target_type" "public"."health_banner_target" NOT NULL DEFAULT 'none', "target_id" uuid, "target_screen" "public"."health_banner_screen", "city" character varying(80), "starts_at" TIMESTAMP WITH TIME ZONE, "ends_at" TIMESTAMP WITH TIME ZONE, "sort" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "CHK_health_banners_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"), CONSTRAINT "CHK_health_banners_target" CHECK (("target_type" = 'screen' AND "target_screen" IS NOT NULL AND "target_id" IS NULL) OR ("target_type" = 'none' AND "target_id" IS NULL AND "target_screen" IS NULL) OR ("target_type" IN ('specialty', 'condition', 'doctor') AND "target_id" IS NOT NULL AND "target_screen" IS NULL)), CONSTRAINT "PK_14a1c833abac7f3466a96102635" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f73a640ac36009096b1ee9b20b" ON "health_banners" ("is_active", "sort")`,
    );
    await queryRunner.query(
      `ALTER TABLE "conditions" ADD "icon" character varying(40)`,
    );
    for (const [slug, icon] of CONDITION_ICONS)
      await queryRunner.query(
        `UPDATE "conditions" SET "icon" = $2 WHERE "slug" = $1 AND "icon" IS NULL`,
        [slug, icon],
      );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conditions" DROP COLUMN "icon"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f73a640ac36009096b1ee9b20b"`,
    );
    await queryRunner.query(`DROP TABLE "health_banners"`);
    await queryRunner.query(`DROP TYPE "public"."health_banner_screen"`);
    await queryRunner.query(`DROP TYPE "public"."health_banner_target"`);
  }
}
