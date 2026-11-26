import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A break after each patient per location, and when a doctor was first
 * listed (a doctor the server later unlists keeps their practice app).
 */
export class DoctorPracticeRules1793560000000 implements MigrationInterface {
  name = 'DoctorPracticeRules1793560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "practice_locations" ADD "buffer_minutes" smallint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_locations" ADD CONSTRAINT "CHK_practice_locations_buffer" CHECK ("buffer_minutes" BETWEEN 0 AND 60)`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD "first_listed_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Listed now, or seen patients before: listed at some point.
    await queryRunner.query(
      `UPDATE "doctors" d SET "first_listed_at" = coalesce(
         (SELECT min(a.created_at) FROM "appointments" a WHERE a.doctor_id = d.id), now())
        WHERE d."is_listed" OR EXISTS (SELECT 1 FROM "appointments" a WHERE a.doctor_id = d.id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "doctors" DROP COLUMN "first_listed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_locations" DROP CONSTRAINT "CHK_practice_locations_buffer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_locations" DROP COLUMN "buffer_minutes"`,
    );
  }
}
