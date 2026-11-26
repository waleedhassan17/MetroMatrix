import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Walk-ins (a visit with no account: exactly one of patient_user_id and
 * walk_in_patient_id), where a visit came from, the follow-up it books, and
 * the follow-up reminder's mark. IDX_appointments_patient_starts is kept.
 */
export class DoctorVisitsByDoctor1795735210269 implements MigrationInterface {
  name = 'DoctorVisitsByDoctor1795735210269';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "walk_in_patients" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "phone" character varying(16), "gender" character varying(10), "age" smallint, CONSTRAINT "PK_998a0cd2cf4b7fb05c82949e290" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_940b783f4801f6587874d955d9" ON "walk_in_patients" ("doctor_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "walk_in_patient_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "source" character varying(10) NOT NULL DEFAULT 'app'`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "follow_up_of_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD "follow_up_reminded_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_8cd86f8376020c81f7b3a65f48d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ALTER COLUMN "patient_user_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_590b6ea45a2274d7ac29f7ffdde"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_deafc41510d674a1c1b50f66cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ALTER COLUMN "patient_user_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_deafc41510d674a1c1b50f66cb" ON "prescriptions" ("patient_user_id", "issued_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "CHK_appointments_person" CHECK (("patient_user_id" IS NULL) <> ("walk_in_patient_id" IS NULL) AND "source" IN ('app', 'walk_in'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "walk_in_patients" ADD CONSTRAINT "FK_86dbc87f3b1dce863156f68d4ea" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_8cd86f8376020c81f7b3a65f48d" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_19b59518ae8af9dd9addec81ddc" FOREIGN KEY ("walk_in_patient_id") REFERENCES "walk_in_patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_590b6ea45a2274d7ac29f7ffdde" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_590b6ea45a2274d7ac29f7ffdde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_19b59518ae8af9dd9addec81ddc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_8cd86f8376020c81f7b3a65f48d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "walk_in_patients" DROP CONSTRAINT "FK_86dbc87f3b1dce863156f68d4ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "CHK_appointments_person"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_deafc41510d674a1c1b50f66cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ALTER COLUMN "patient_user_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_deafc41510d674a1c1b50f66cb" ON "prescriptions" ("patient_user_id", "issued_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_590b6ea45a2274d7ac29f7ffdde" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ALTER COLUMN "patient_user_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_8cd86f8376020c81f7b3a65f48d" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP COLUMN "follow_up_reminded_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "follow_up_of_id"`,
    );
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "source"`);
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "walk_in_patient_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_940b783f4801f6587874d955d9"`,
    );
    await queryRunner.query(`DROP TABLE "walk_in_patients"`);
  }
}
