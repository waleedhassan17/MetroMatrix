import { MigrationInterface, QueryRunner } from 'typeorm';

export class HealthConsultation1792117650775 implements MigrationInterface {
  name = 'HealthConsultation1792117650775';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "prescriptions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "appointment_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "patient_user_id" uuid NOT NULL, "family_member_id" uuid, "diagnosis" text NOT NULL, "advice" text, "follow_up_in_days" smallint, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_097b2cc2f2b7e56825468188503" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f4cb6dbd129969e21ece4c445" ON "prescriptions" ("doctor_id", "issued_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_deafc41510d674a1c1b50f66cb" ON "prescriptions" ("patient_user_id", "issued_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_94491da15bc982f3435690fc96" ON "prescriptions" ("appointment_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."medicine_timing" AS ENUM('before_meal', 'after_meal', 'with_meal', 'bedtime', 'as_needed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "prescription_medicines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "prescription_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "strength" character varying(40), "form" "public"."medicine_form" NOT NULL, "dose_pattern" character varying(20) NOT NULL, "timing" "public"."medicine_timing" NOT NULL, "duration_days" smallint, "instructions" text, "sort" smallint NOT NULL DEFAULT '0', CONSTRAINT "PK_a3aa7e0b9a01f51047385ead5ee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f061070bf349709370c1cb1329" ON "prescription_medicines" ("prescription_id", "sort") `,
    );
    await queryRunner.query(
      `CREATE TABLE "prescription_tests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "prescription_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "instructions" text, "sort" smallint NOT NULL DEFAULT '0', CONSTRAINT "PK_21f2837eee8dcae386cfc3a9d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5789d289074995e2fa7b104e5f" ON "prescription_tests" ("prescription_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "doctor_medicine_favourites" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "doctor_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "strength" character varying(40), "form" "public"."medicine_form" NOT NULL, "dose_pattern" character varying(20) NOT NULL, "timing" "public"."medicine_timing" NOT NULL, "use_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_64f0a5a1367a9e6a02429f70376" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e9fc73eacf145d78a5d3ac470" ON "doctor_medicine_favourites" ("doctor_id", "use_count") `,
    );
    // One favourite per medicine per doctor, case-insensitive; ON CONFLICT targets this expression.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_doctor_medicine_favourites" ON "doctor_medicine_favourites" ("doctor_id", lower("name"), coalesce("strength", ''), "form")`,
    );
    await queryRunner.query(
      `CREATE TABLE "medical_notes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "appointment_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "text" text NOT NULL, "files" jsonb NOT NULL, CONSTRAINT "PK_2c2f273f76f8de7392f07d930c4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4367d2b4e60768679bebaaa709" ON "medical_notes" ("doctor_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6603972a6e15ae8b9c8a3d4cef" ON "medical_notes" ("appointment_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_94491da15bc982f3435690fc96e" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_2d6a1941bd705056030c2b9e07d" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_590b6ea45a2274d7ac29f7ffdde" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_122a1c822cdc89c63ff27ecf23c" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_medicines" ADD CONSTRAINT "FK_ec23f4d56cf520bda640dfb8bf1" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_tests" ADD CONSTRAINT "FK_5789d289074995e2fa7b104e5f9" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_medicine_favourites" ADD CONSTRAINT "FK_548dd71761035e598b87dffa2c8" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_notes" ADD CONSTRAINT "FK_6603972a6e15ae8b9c8a3d4cef1" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_notes" ADD CONSTRAINT "FK_4367d2b4e60768679bebaaa7096" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "medical_notes" DROP CONSTRAINT "FK_4367d2b4e60768679bebaaa7096"`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_notes" DROP CONSTRAINT "FK_6603972a6e15ae8b9c8a3d4cef1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_medicine_favourites" DROP CONSTRAINT "FK_548dd71761035e598b87dffa2c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_tests" DROP CONSTRAINT "FK_5789d289074995e2fa7b104e5f9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_medicines" DROP CONSTRAINT "FK_ec23f4d56cf520bda640dfb8bf1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_122a1c822cdc89c63ff27ecf23c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_590b6ea45a2274d7ac29f7ffdde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_2d6a1941bd705056030c2b9e07d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_94491da15bc982f3435690fc96e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6603972a6e15ae8b9c8a3d4cef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4367d2b4e60768679bebaaa709"`,
    );
    await queryRunner.query(`DROP TABLE "medical_notes"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e9fc73eacf145d78a5d3ac470"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_doctor_medicine_favourites"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_medicine_favourites"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5789d289074995e2fa7b104e5f"`,
    );
    await queryRunner.query(`DROP TABLE "prescription_tests"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f061070bf349709370c1cb1329"`,
    );
    await queryRunner.query(`DROP TABLE "prescription_medicines"`);
    await queryRunner.query(`DROP TYPE "public"."medicine_timing"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_94491da15bc982f3435690fc96"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_deafc41510d674a1c1b50f66cb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f4cb6dbd129969e21ece4c445"`,
    );
    await queryRunner.query(`DROP TABLE "prescriptions"`);
  }
}
