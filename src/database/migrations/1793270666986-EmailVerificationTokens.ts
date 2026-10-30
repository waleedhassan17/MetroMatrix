import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailVerificationTokens1793270666986 implements MigrationInterface {
  name = 'EmailVerificationTokens1793270666986';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "email_verification_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_417a095bbed21c2369a6a01ab9a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c20ed35f3d31d486aabcd0564d" ON "email_verification_tokens" ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae20ffb0adf01317028f9faa04" ON "email_verification_tokens" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "FK_fdcb77f72f529bf65c95d72a147" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_verification_tokens" DROP CONSTRAINT "FK_fdcb77f72f529bf65c95d72a147"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae20ffb0adf01317028f9faa04"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c20ed35f3d31d486aabcd0564d"`,
    );
    await queryRunner.query(`DROP TABLE "email_verification_tokens"`);
  }
}
