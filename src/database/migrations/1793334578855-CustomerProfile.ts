import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerProfile1793334578855 implements MigrationInterface {
  name = 'CustomerProfile1793334578855';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "date_of_birth" date`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "gender" "public"."person_gender"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "street_address" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "city" character varying(60)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "postal_code" character varying(12)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "profile_skippable" boolean NOT NULL DEFAULT false`,
    );
    // Customers who signed up before the profile existed are asked once
    // and may skip; only customers created from now on must complete it.
    await queryRunner.query(
      `UPDATE "users" SET "profile_skippable" = true WHERE "role" = 'customer'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "profile_skippable"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "postal_code"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "city"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "street_address"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "gender"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "date_of_birth"`);
  }
}
