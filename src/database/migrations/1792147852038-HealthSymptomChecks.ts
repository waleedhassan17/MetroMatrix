import { MigrationInterface, QueryRunner } from 'typeorm';

export class HealthSymptomChecks1792147852038 implements MigrationInterface {
  name = 'HealthSymptomChecks1792147852038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."symptom_check_source" AS ENUM('red_flag', 'model', 'fallback')`,
    );
    await queryRunner.query(
      `CREATE TABLE "symptom_checks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "text" text, "source" "public"."symptom_check_source" NOT NULL, "emergency" boolean NOT NULL, "result" jsonb NOT NULL, CONSTRAINT "PK_2ad61c274b1cc294e4fb7980235" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7215ab8993e2ab8320a83cd096" ON "symptom_checks" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "symptom_checks" ADD CONSTRAINT "FK_72c5778ffa9a180492d691b5132" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "symptom_checks" DROP CONSTRAINT "FK_72c5778ffa9a180492d691b5132"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7215ab8993e2ab8320a83cd096"`,
    );
    await queryRunner.query(`DROP TABLE "symptom_checks"`);
    await queryRunner.query(`DROP TYPE "public"."symptom_check_source"`);
  }
}
