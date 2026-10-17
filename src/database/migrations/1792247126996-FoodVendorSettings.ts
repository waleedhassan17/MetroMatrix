import { MigrationInterface, QueryRunner } from 'typeorm';

export class FoodVendorSettings1792247126996 implements MigrationInterface {
  name = 'FoodVendorSettings1792247126996';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."vendor_payment_account_kind" AS ENUM('raast', 'jazzcash', 'easypaisa', 'bank')`,
    );
    await queryRunner.query(
      `CREATE TABLE "vendor_payment_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid NOT NULL, "kind" "public"."vendor_payment_account_kind" NOT NULL, "account_title" character varying(80) NOT NULL, "account_number" character varying(34) NOT NULL, "bank_name" character varying(80), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_485440c41ef578a83c8d61a25ee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0c88548675e559d0d61b0028ce" ON "vendor_payment_accounts" ("business_id", "account_number") `,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_fee_bands" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "from_km" numeric(5,2) NOT NULL, "to_km" numeric(5,2) NOT NULL, "fee" integer NOT NULL, "min_order" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_delivery_fee_bands" CHECK ("to_km" > "from_km" AND "from_km" >= 0 AND "fee" >= 0 AND "min_order" >= 0), CONSTRAINT "PK_3483af104e97e2a4a5f81a7f05e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f9caa41f8c14b33c2234e57e4" ON "delivery_fee_bands" ("branch_id", "from_km") `,
    );
    await queryRunner.query(
      `CREATE TABLE "branch_hours" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "weekday" smallint NOT NULL, "opens_at" TIME NOT NULL, "closes_at" TIME NOT NULL, CONSTRAINT "CHK_branch_hours_weekday" CHECK ("weekday" BETWEEN 0 AND 6 AND "opens_at" <> "closes_at"), CONSTRAINT "PK_48ec38087f06c9b734f5773a7d0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9fa0eca7761b686083b7af8a57" ON "branch_hours" ("branch_id", "weekday") `,
    );
    await queryRunner.query(
      `CREATE TABLE "branch_closures" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "reason" character varying(200), CONSTRAINT "CHK_branch_closures_range" CHECK ("ends_at" > "starts_at"), CONSTRAINT "PK_0be629e889a91127a86776bbbe8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a10757d102b6c6fc132b506069" ON "branch_closures" ("branch_id", "ends_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cuisines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(60) NOT NULL, "slug" citext NOT NULL, "icon" character varying(40), "sort" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_22b98d435f9359f707c764953a5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_454d7d111836fd30f49a7a9ebb" ON "cuisines" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80f2e271394f5775fd5ac1f352" ON "cuisines" ("is_active", "sort") `,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_payment_accounts" ADD CONSTRAINT "FK_dd484b7922830cd300f9dd442d4" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_fee_bands" ADD CONSTRAINT "FK_1c380579f38c1bbfda12d4ab4f4" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_hours" ADD CONSTRAINT "FK_74d750935856713e75dec7aff72" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_closures" ADD CONSTRAINT "FK_9a7ef61a2b4c83b501dec9a0b15" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "branch_closures" DROP CONSTRAINT "FK_9a7ef61a2b4c83b501dec9a0b15"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branch_hours" DROP CONSTRAINT "FK_74d750935856713e75dec7aff72"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_fee_bands" DROP CONSTRAINT "FK_1c380579f38c1bbfda12d4ab4f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_payment_accounts" DROP CONSTRAINT "FK_dd484b7922830cd300f9dd442d4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80f2e271394f5775fd5ac1f352"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_454d7d111836fd30f49a7a9ebb"`,
    );
    await queryRunner.query(`DROP TABLE "cuisines"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a10757d102b6c6fc132b506069"`,
    );
    await queryRunner.query(`DROP TABLE "branch_closures"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9fa0eca7761b686083b7af8a57"`,
    );
    await queryRunner.query(`DROP TABLE "branch_hours"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f9caa41f8c14b33c2234e57e4"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_fee_bands"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c88548675e559d0d61b0028ce"`,
    );
    await queryRunner.query(`DROP TABLE "vendor_payment_accounts"`);
    await queryRunner.query(`DROP TYPE "public"."vendor_payment_account_kind"`);
  }
}
