import { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordResetOtps1792018557445 implements MigrationInterface {
  name = 'PasswordResetOtps1792018557445';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "password_reset_otps" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "otp_hash" character varying(64) NOT NULL, "reset_token_hash" character varying(64), "attempts" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "verified_at" TIMESTAMP WITH TIME ZONE, "used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0b4f4c493a1ee383f93ff3a5017" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a714acddb3477ba3122e0ca044" ON "password_reset_otps" ("reset_token_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34b6c3fe22d9c5081c76bb279b" ON "password_reset_otps" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_otps" ADD CONSTRAINT "FK_a4a5ac367f438cfef8fa13e8023" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_reset_otps" DROP CONSTRAINT "FK_a4a5ac367f438cfef8fa13e8023"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34b6c3fe22d9c5081c76bb279b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a714acddb3477ba3122e0ca044"`,
    );
    await queryRunner.query(`DROP TABLE "password_reset_otps"`);
  }
}
