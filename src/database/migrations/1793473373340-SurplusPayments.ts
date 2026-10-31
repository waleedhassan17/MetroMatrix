import { MigrationInterface, QueryRunner } from 'typeorm';

export class SurplusPayments1793473373340 implements MigrationInterface {
  name = 'SurplusPayments1793473373340';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."surplus_payment_status" AS ENUM('unpaid', 'awaiting_transfer', 'proof_submitted', 'paid', 'void', 'refund_due')`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" ADD "payment_status" "public"."surplus_payment_status" NOT NULL DEFAULT 'unpaid'`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" ADD "pay_by" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" ADD "payment_ref" character varying(60)`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" ADD "payment_proof_url" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" ADD "payment_rejected_reason" character varying(300)`,
    );
    // Reservations made before payments were tracked: what their status already says.
    await queryRunner.query(`UPDATE "surplus_reservations" SET "payment_status" = CASE
            WHEN "status" = 'collected' THEN 'paid'
            WHEN "status" IN ('cancelled', 'no_show') THEN 'void'
            WHEN "payment_method" = 'transfer' THEN 'awaiting_transfer'
            ELSE 'unpaid' END::"public"."surplus_payment_status"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" DROP COLUMN "payment_rejected_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" DROP COLUMN "payment_proof_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" DROP COLUMN "payment_ref"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" DROP COLUMN "pay_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" DROP COLUMN "payment_status"`,
    );
    await queryRunner.query(`DROP TYPE "public"."surplus_payment_status"`);
  }
}
