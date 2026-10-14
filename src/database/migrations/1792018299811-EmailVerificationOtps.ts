import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailVerificationOtps1792018299811 implements MigrationInterface {
  name = 'EmailVerificationOtps1792018299811';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "email_verification_otps" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "otp_hash" character varying(64) NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b8c838075d1f98c615fc385bdb6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14d311d2a2cdf34adfcecdddbf" ON "email_verification_otps" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verification_otps" ADD CONSTRAINT "FK_d3c8234c4dd8cf400df8d614c2b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_verification_otps" DROP CONSTRAINT "FK_d3c8234c4dd8cf400df8d614c2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_14d311d2a2cdf34adfcecdddbf"`,
    );
    await queryRunner.query(`DROP TABLE "email_verification_otps"`);
  }
}
