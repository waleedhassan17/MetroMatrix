import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrowthTiffin1792408650895 implements MigrationInterface {
  name = 'GrowthTiffin1792408650895';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_meal" AS ENUM('breakfast', 'lunch', 'dinner')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_period" AS ENUM('weekly', 'monthly')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_delivery_mode" AS ENUM('delivery', 'pickup', 'both')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tiffin_plans" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "brand_id" uuid NOT NULL, "branch_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "description" text, "meal" "public"."tiffin_meal" NOT NULL, "days_mask" smallint NOT NULL, "period" "public"."tiffin_period" NOT NULL, "price_per_period" integer NOT NULL, "delivery_mode" "public"."tiffin_delivery_mode" NOT NULL, "delivery_window_from" TIME NOT NULL, "delivery_window_to" TIME NOT NULL, "capacity" smallint NOT NULL, "skip_cutoff_hour" smallint NOT NULL DEFAULT '20', "rotation" jsonb NOT NULL DEFAULT '[]', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "CHK_tiffin_plans_numbers" CHECK ("days_mask" BETWEEN 1 AND 127 AND "price_per_period" > 0 AND "capacity" BETWEEN 1 AND 1000 AND "skip_cutoff_hour" BETWEEN 0 AND 23), CONSTRAINT "PK_383781acef55aea780cd090e236" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e65dfd908aa1d531f458bed1cb" ON "tiffin_plans" ("brand_id", "is_active") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_fulfilment" AS ENUM('delivery', 'pickup')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_status" AS ENUM('requested', 'active', 'paused', 'cancelled', 'ended', 'declined')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_payment_method" AS ENUM('cash_weekly', 'transfer_per_period')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_period_payment_status" AS ENUM('due', 'proof_submitted', 'paid')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tiffin_subscriptions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "plan_id" uuid NOT NULL, "user_id" uuid NOT NULL, "fulfilment" "public"."tiffin_fulfilment" NOT NULL, "address_snapshot" jsonb, "starts_on" date NOT NULL, "status" "public"."tiffin_status" NOT NULL DEFAULT 'requested', "current_period_start" date, "current_period_end" date, "payment_method" "public"."tiffin_payment_method" NOT NULL, "period_payment_status" "public"."tiffin_period_payment_status" NOT NULL DEFAULT 'due', "payment_ref" character varying(60), "payment_proof_url" character varying(500), "skips" date array NOT NULL DEFAULT '{}', "paused_until" date, "reason" character varying(300), "approved_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e72d742f0fa1d0c62bd0935e173" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a1c178c867f9ab976a8b57fed" ON "tiffin_subscriptions" ("plan_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_854baf2b1783cab31114e3ca82" ON "tiffin_subscriptions" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tiffin_subscriptions_live" ON "tiffin_subscriptions" ("plan_id", "user_id") WHERE "status" IN ('requested', 'active', 'paused')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tiffin_delivery_status" AS ENUM('scheduled', 'skipped', 'prepared', 'delivered', 'missed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tiffin_deliveries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "subscription_id" uuid NOT NULL, "date" date NOT NULL, "status" "public"."tiffin_delivery_status" NOT NULL, "food_order_id" uuid, CONSTRAINT "PK_309e37d95c9f5efd224a536a444" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a542d1c916a4ba13c7987cd31" ON "tiffin_deliveries" ("food_order_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d01551f72c9f52def033eb8c51" ON "tiffin_deliveries" ("subscription_id", "date") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_order_source" AS ENUM('app', 'storefront', 'qr', 'tiffin', 'catering', 'surplus')`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD "source" "public"."food_order_source" NOT NULL DEFAULT 'app'`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD "campaign" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD "prepaid_amount" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."food_payment_method" RENAME TO "food_payment_method_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_payment_method" AS ENUM('cod', 'transfer', 'pay_at_pickup', 'subscription', 'catering')`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ALTER COLUMN "payment_method" TYPE "public"."food_payment_method" USING "payment_method"::"text"::"public"."food_payment_method"`,
    );
    await queryRunner.query(`DROP TYPE "public"."food_payment_method_old"`);
    await queryRunner.query(
      `ALTER TABLE "tiffin_plans" ADD CONSTRAINT "FK_e866a655aac7eaa0b2470173bd5" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_plans" ADD CONSTRAINT "FK_0edf13f32a465ce847989d3d5bd" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "FK_4af1e027bd98825f5c1ad1919eb" FOREIGN KEY ("plan_id") REFERENCES "tiffin_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "FK_4a69f9d237eab7724e11b36530a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_deliveries" ADD CONSTRAINT "FK_490f09daaee0e62d89505ec9fdb" FOREIGN KEY ("subscription_id") REFERENCES "tiffin_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_deliveries" ADD CONSTRAINT "FK_7a542d1c916a4ba13c7987cd312" FOREIGN KEY ("food_order_id") REFERENCES "food_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tiffin_deliveries" DROP CONSTRAINT "FK_7a542d1c916a4ba13c7987cd312"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_deliveries" DROP CONSTRAINT "FK_490f09daaee0e62d89505ec9fdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_subscriptions" DROP CONSTRAINT "FK_4a69f9d237eab7724e11b36530a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_subscriptions" DROP CONSTRAINT "FK_4af1e027bd98825f5c1ad1919eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_plans" DROP CONSTRAINT "FK_0edf13f32a465ce847989d3d5bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_plans" DROP CONSTRAINT "FK_e866a655aac7eaa0b2470173bd5"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_payment_method_old" AS ENUM('cod', 'transfer', 'pay_at_pickup')`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ALTER COLUMN "payment_method" TYPE "public"."food_payment_method_old" USING "payment_method"::"text"::"public"."food_payment_method_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."food_payment_method"`);
    await queryRunner.query(
      `ALTER TYPE "public"."food_payment_method_old" RENAME TO "food_payment_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP COLUMN "prepaid_amount"`,
    );
    await queryRunner.query(`ALTER TABLE "food_orders" DROP COLUMN "campaign"`);
    await queryRunner.query(`ALTER TABLE "food_orders" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TYPE "public"."food_order_source"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d01551f72c9f52def033eb8c51"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a542d1c916a4ba13c7987cd31"`,
    );
    await queryRunner.query(`DROP TABLE "tiffin_deliveries"`);
    await queryRunner.query(`DROP TYPE "public"."tiffin_delivery_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_tiffin_subscriptions_live"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_854baf2b1783cab31114e3ca82"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a1c178c867f9ab976a8b57fed"`,
    );
    await queryRunner.query(`DROP TABLE "tiffin_subscriptions"`);
    await queryRunner.query(
      `DROP TYPE "public"."tiffin_period_payment_status"`,
    );
    await queryRunner.query(`DROP TYPE "public"."tiffin_payment_method"`);
    await queryRunner.query(`DROP TYPE "public"."tiffin_status"`);
    await queryRunner.query(`DROP TYPE "public"."tiffin_fulfilment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e65dfd908aa1d531f458bed1cb"`,
    );
    await queryRunner.query(`DROP TABLE "tiffin_plans"`);
    await queryRunner.query(`DROP TYPE "public"."tiffin_delivery_mode"`);
    await queryRunner.query(`DROP TYPE "public"."tiffin_period"`);
    await queryRunner.query(`DROP TYPE "public"."tiffin_meal"`);
  }
}
