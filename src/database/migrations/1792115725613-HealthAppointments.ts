import { MigrationInterface, QueryRunner } from 'typeorm';

export class HealthAppointments1792115725613 implements MigrationInterface {
  name = 'HealthAppointments1792115725613';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."family_relation" AS ENUM('spouse', 'child', 'parent', 'sibling', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "family_members" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "full_name" character varying(120) NOT NULL, "relation" "public"."family_relation" NOT NULL, "gender" "public"."person_gender", "date_of_birth" date, "phone" character varying(16), CONSTRAINT "PK_186da7c7fcbf23775fdd888a747" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c231eb9b3541714418b7ec2c79" ON "family_members" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_payment_method" AS ENUM('pay_at_clinic', 'transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_payment_status" AS ENUM('unpaid', 'awaiting_transfer', 'proof_submitted', 'paid', 'void', 'refund_due', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_actor" AS ENUM('patient', 'doctor', 'system', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "appointments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(12) NOT NULL, "patient_user_id" uuid NOT NULL, "family_member_id" uuid, "patient_snapshot" jsonb NOT NULL, "doctor_id" uuid NOT NULL, "location_id" uuid NOT NULL, "kind" "public"."practice_location_kind" NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."appointment_status" NOT NULL DEFAULT 'booked', "reason" text, "symptoms" text array NOT NULL, "fee" integer NOT NULL, "payment_method" "public"."appointment_payment_method" NOT NULL, "payment_status" "public"."appointment_payment_status" NOT NULL, "payment_ref" character varying(100), "payment_proof_url" character varying(500), "payment_rejected_reason" text, "pay_by" TIMESTAMP WITH TIME ZONE, "paid_at" TIMESTAMP WITH TIME ZONE, "payment_account_snapshot" jsonb, "refund_ref" character varying(100), "refunded_at" TIMESTAMP WITH TIME ZONE, "rescheduled_from_id" uuid, "checked_in_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" "public"."appointment_actor", "cancel_reason" text, "late_cancel" boolean NOT NULL DEFAULT false, "video_room" uuid, "reminded_24h_at" TIMESTAMP WITH TIME ZONE, "reminded_1h_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_appointments_times" CHECK ("ends_at" > "starts_at" AND "fee" >= 0), CONSTRAINT "EX_appointments_doctor_time" EXCLUDE USING gist ("doctor_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE (("status" = ANY (ARRAY['booked'::"appointment_status", 'checked_in'::"appointment_status", 'in_consultation'::"appointment_status"]))), CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6592e0bcbe8343a8846c56caa3" ON "appointments" ("status", "pay_by") `,
    );
    // "My appointments", newest first (TypeORM cannot express DESC).
    await queryRunner.query(
      `CREATE INDEX "IDX_appointments_patient_starts" ON "appointments" ("patient_user_id", "starts_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_61b21de264d840939821359faf" ON "appointments" ("doctor_id", "starts_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d838dde2371446d33c990332cb" ON "appointments" ("code") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_event_kind" AS ENUM('status', 'payment', 'note')`,
    );
    await queryRunner.query(
      `CREATE TABLE "appointment_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "appointment_id" uuid NOT NULL, "kind" "public"."appointment_event_kind" NOT NULL, "from_state" character varying(30), "to_state" character varying(30), "actor_user_id" uuid, "actor_role" "public"."appointment_actor" NOT NULL, "note" text, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "PK_9b970104a71b4db9267479372d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da59fabca6945ba4adc7ddb70d" ON "appointment_events" ("appointment_id", "at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "family_members" ADD CONSTRAINT "FK_081fe336d41be74c68b81e8b6d7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_8cd86f8376020c81f7b3a65f48d" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_199daf24ce907e801d0dc9b27a3" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_4cf26c3f972d014df5c68d503d2" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_24dcc9d49a334fdb948cd5efed3" FOREIGN KEY ("location_id") REFERENCES "practice_locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_74a514c97efe18c24526b1bd17a" FOREIGN KEY ("rescheduled_from_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_events" ADD CONSTRAINT "FK_6306c4f9ae774089d8671f1f159" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointment_events" DROP CONSTRAINT "FK_6306c4f9ae774089d8671f1f159"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_74a514c97efe18c24526b1bd17a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_24dcc9d49a334fdb948cd5efed3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_4cf26c3f972d014df5c68d503d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_199daf24ce907e801d0dc9b27a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_8cd86f8376020c81f7b3a65f48d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "family_members" DROP CONSTRAINT "FK_081fe336d41be74c68b81e8b6d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da59fabca6945ba4adc7ddb70d"`,
    );
    await queryRunner.query(`DROP TABLE "appointment_events"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_event_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d838dde2371446d33c990332cb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_61b21de264d840939821359faf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_appointments_patient_starts"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6592e0bcbe8343a8846c56caa3"`,
    );
    await queryRunner.query(`DROP TABLE "appointments"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_actor"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_payment_status"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_payment_method"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c231eb9b3541714418b7ec2c79"`,
    );
    await queryRunner.query(`DROP TABLE "family_members"`);
    await queryRunner.query(`DROP TYPE "public"."family_relation"`);
  }
}
