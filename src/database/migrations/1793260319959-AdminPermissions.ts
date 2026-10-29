import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Super admin, S1–S3: per-admin permissions (a jsonb array on the users row,
 * so AccessTokenValidator gets them with the row it already loads), the
 * forced password change, and the last spent TOTP step (no code replays).
 * Additive with defaults: existing rows get `[]`, false and NULL.
 */

export class AdminPermissions1793260319959 implements MigrationInterface {
  name = 'AdminPermissions1793260319959';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "admin_permissions" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "must_change_password" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "totp_last_step" bigint`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_admin_permissions_admin_only" CHECK ("role" = 'admin' OR "admin_permissions" = '[]'::jsonb)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_admin_permissions_known" CHECK ("admin_permissions" <@ '["approvePartners","manageUsers","manageShopping","manageHealthcare","manageFood","manageKitchen","manageContent","viewAnalytics","broadcast","viewAudit","manageSettings"]'::jsonb)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_admin_permissions_array" CHECK (jsonb_typeof("admin_permissions") = 'array')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_admin_permissions_array"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_admin_permissions_known"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_admin_permissions_admin_only"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totp_last_step"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "must_change_password"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "admin_permissions"`,
    );
  }
}
