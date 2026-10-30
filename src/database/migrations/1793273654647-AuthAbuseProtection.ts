import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthAbuseProtection1793273654647 implements MigrationInterface {
  name = 'AuthAbuseProtection1793273654647';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "signin_failures" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "signin_failures_since" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totp_failures" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totp_failures_since" TIMESTAMP WITH TIME ZONE`,
    );
    // users.totp_last_step comes from AdminPermissions1793260319959.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "totp_failures_since"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totp_failures"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "signin_failures_since"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "signin_failures"`,
    );
  }
}
