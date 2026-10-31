import { MigrationInterface, QueryRunner } from 'typeorm';

export class CateringSettings1793474791271 implements MigrationInterface {
  name = 'CateringSettings1793474791271';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "food_brands" ADD "catering_open" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" ADD "catering_min_guests" smallint NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" ADD "catering_lead_days" smallint NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" ADD CONSTRAINT "CHK_food_brands_catering" CHECK ("catering_min_guests" BETWEEN 1 AND 5000 AND "catering_lead_days" BETWEEN 1 AND 60)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "food_brands" DROP CONSTRAINT "CHK_food_brands_catering"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" DROP COLUMN "catering_lead_days"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" DROP COLUMN "catering_min_guests"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_brands" DROP COLUMN "catering_open"`,
    );
  }
}
