import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminRecoveryCodes1792019525088 implements MigrationInterface {
  name = 'AdminRecoveryCodes1792019525088';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_recovery_codes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "code_hash" character varying(64) NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ca2c62f376c0ac5b15361af76ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_480f1156c3c936984487eca1dc" ON "admin_recovery_codes" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "FK_480f1156c3c936984487eca1dcc" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin_recovery_codes" DROP CONSTRAINT "FK_480f1156c3c936984487eca1dcc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_480f1156c3c936984487eca1dc"`,
    );
    await queryRunner.query(`DROP TABLE "admin_recovery_codes"`);
  }
}
