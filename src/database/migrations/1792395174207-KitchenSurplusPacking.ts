import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenSurplusPacking1792395174207 implements MigrationInterface {
  name = 'KitchenSurplusPacking1792395174207';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."surplus_status" AS ENUM('live', 'sold_out', 'expired', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "surplus_boxes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "title" character varying(80) NOT NULL, "description" character varying(300), "contents_hint" character varying(200), "original_value" integer NOT NULL, "price" integer NOT NULL, "quantity" smallint NOT NULL, "remaining" smallint NOT NULL, "pickup_from" TIMESTAMP WITH TIME ZONE NOT NULL, "pickup_to" TIMESTAMP WITH TIME ZONE NOT NULL, "tags" text array NOT NULL DEFAULT '{}', "status" "public"."surplus_status" NOT NULL DEFAULT 'live', CONSTRAINT "CHK_surplus_boxes_numbers" CHECK ("price" >= 0 AND "price" <= "original_value" AND "quantity" BETWEEN 1 AND 200 AND "remaining" BETWEEN 0 AND "quantity" AND "pickup_to" > "pickup_from"), CONSTRAINT "PK_26662d1c26306da1d54fa7952b2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_surplus_boxes_live" ON "surplus_boxes" ("pickup_to") WHERE "status" IN ('live', 'sold_out')`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08b62154b22a3fb4907de4be87" ON "surplus_boxes" ("branch_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."surplus_reservation_status" AS ENUM('reserved', 'collected', 'no_show', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."surplus_payment_method" AS ENUM('pay_at_pickup', 'transfer')`,
    );
    await queryRunner.query(
      `CREATE TABLE "surplus_reservations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "box_id" uuid NOT NULL, "user_id" uuid NOT NULL, "quantity" smallint NOT NULL, "code" character varying(12) NOT NULL, "status" "public"."surplus_reservation_status" NOT NULL DEFAULT 'reserved', "payment_method" "public"."surplus_payment_method" NOT NULL DEFAULT 'pay_at_pickup', "total" integer NOT NULL, "collected_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_surplus_reservations_qty" CHECK ("quantity" BETWEEN 1 AND 10), CONSTRAINT "PK_3e8de41e865ecac7d1b1b820759" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1e4f0401426791919fd9b56f8c" ON "surplus_reservations" ("code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00b9a12a629f40ab10b0ce8273" ON "surplus_reservations" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f35eb4717c0f889bb974e1e27c" ON "surplus_reservations" ("box_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "surplus_donations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "branch_id" uuid NOT NULL, "organisation" character varying(120) NOT NULL, "meals" integer NOT NULL, "notes" character varying(300), "photo_url" character varying(500), CONSTRAINT "CHK_surplus_donations_meals" CHECK ("meals" BETWEEN 1 AND 10000), CONSTRAINT "PK_451a71c25a61146155e0c4f9690" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fca2d5e577025e55342182bd80" ON "surplus_donations" ("branch_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "surplus_customer_status" ("user_id" uuid NOT NULL, "no_shows" smallint NOT NULL DEFAULT '0', "blocked_until" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f40045beb46d11db47ef09220b1" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."packing_taken_by" AS ENUM('vendor', 'rider')`,
    );
    await queryRunner.query(
      `CREATE TABLE "packing_proofs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "photo_url" character varying(500) NOT NULL, "taken_by" "public"."packing_taken_by" NOT NULL, "taken_by_user_id" uuid, "ai_check" jsonb, CONSTRAINT "PK_b59c0a7e8585eb1179639d7f263" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6955921621967a585d33062f48" ON "packing_proofs" ("order_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_boxes" ADD CONSTRAINT "FK_a804b7f6d8463c0c91b01f56714" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" ADD CONSTRAINT "FK_73e694037740c107d2578c1cad2" FOREIGN KEY ("box_id") REFERENCES "surplus_boxes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" ADD CONSTRAINT "FK_51ce984d505fbaf0b2fd43acb2e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_donations" ADD CONSTRAINT "FK_01c960123552b7994eca2d6efbe" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_customer_status" ADD CONSTRAINT "FK_f40045beb46d11db47ef09220b1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "packing_proofs" ADD CONSTRAINT "FK_6955921621967a585d33062f485" FOREIGN KEY ("order_id") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "packing_proofs" DROP CONSTRAINT "FK_6955921621967a585d33062f485"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_customer_status" DROP CONSTRAINT "FK_f40045beb46d11db47ef09220b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_donations" DROP CONSTRAINT "FK_01c960123552b7994eca2d6efbe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" DROP CONSTRAINT "FK_51ce984d505fbaf0b2fd43acb2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_reservations" DROP CONSTRAINT "FK_73e694037740c107d2578c1cad2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_boxes" DROP CONSTRAINT "FK_a804b7f6d8463c0c91b01f56714"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6955921621967a585d33062f48"`,
    );
    await queryRunner.query(`DROP TABLE "packing_proofs"`);
    await queryRunner.query(`DROP TYPE "public"."packing_taken_by"`);
    await queryRunner.query(`DROP TABLE "surplus_customer_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fca2d5e577025e55342182bd80"`,
    );
    await queryRunner.query(`DROP TABLE "surplus_donations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f35eb4717c0f889bb974e1e27c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00b9a12a629f40ab10b0ce8273"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e4f0401426791919fd9b56f8c"`,
    );
    await queryRunner.query(`DROP TABLE "surplus_reservations"`);
    await queryRunner.query(`DROP TYPE "public"."surplus_payment_method"`);
    await queryRunner.query(`DROP TYPE "public"."surplus_reservation_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08b62154b22a3fb4907de4be87"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_surplus_boxes_live"`);
    await queryRunner.query(`DROP TABLE "surplus_boxes"`);
    await queryRunner.query(`DROP TYPE "public"."surplus_status"`);
  }
}
