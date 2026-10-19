import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrowthCatering1792409713801 implements MigrationInterface {
  name = 'GrowthCatering1792409713801';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."catering_event_type" AS ENUM('dawat', 'wedding', 'office', 'birthday', 'milad', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."catering_fulfilment" AS ENUM('delivery', 'pickup', 'on_site')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."catering_status" AS ENUM('requested', 'quoted', 'accepted', 'advance_proof', 'confirmed', 'completed', 'declined', 'expired', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "catering_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(12) NOT NULL, "user_id" uuid NOT NULL, "brand_id" uuid NOT NULL, "event_date" date NOT NULL, "event_time" TIME NOT NULL, "guests" smallint NOT NULL, "event_type" "public"."catering_event_type" NOT NULL, "requested_items" jsonb NOT NULL DEFAULT '[]', "budget" integer, "fulfilment" "public"."catering_fulfilment" NOT NULL, "address_snapshot" jsonb, "notes" text, "status" "public"."catering_status" NOT NULL DEFAULT 'requested', "accepted_version" smallint, "advance_proof_url" character varying(500), "advance_ref" character varying(60), "reason" character varying(300), "food_order_id" uuid, CONSTRAINT "CHK_catering_requests_guests" CHECK ("guests" BETWEEN 1 AND 5000), CONSTRAINT "PK_9350886da19ad5068bc3b140f2c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d05753adb681c13bf54a3a5c9" ON "catering_requests" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3fc6d55d9d88c86e651c4241f" ON "catering_requests" ("brand_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1a37db696b50dc8636a1843663" ON "catering_requests" ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "catering_quotes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "request_id" uuid NOT NULL, "lines" jsonb NOT NULL, "delivery_fee" integer NOT NULL DEFAULT '0', "total" integer NOT NULL, "advance_pct" smallint NOT NULL, "valid_until" TIMESTAMP WITH TIME ZONE NOT NULL, "notes" text, "version" smallint NOT NULL, CONSTRAINT "CHK_catering_quotes_numbers" CHECK ("total" >= 0 AND "delivery_fee" >= 0 AND "advance_pct" BETWEEN 0 AND 100 AND "version" >= 1), CONSTRAINT "PK_c54a4375cbb64675a5c5aef388a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3e6b14478e51da17c4b23094af" ON "catering_quotes" ("request_id", "version") `,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD CONSTRAINT "CHK_food_orders_prepaid" CHECK ("prepaid_amount" >= 0 AND "prepaid_amount" <= "total")`,
    );
    await queryRunner.query(
      `ALTER TABLE "catering_requests" ADD CONSTRAINT "FK_a93d99b914c0fdf2a9c35a5a8dc" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "catering_requests" ADD CONSTRAINT "FK_bf3ff5c1818bd1dbe21801a2e35" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "catering_requests" ADD CONSTRAINT "FK_7ae043c3c29369aae10eec6277a" FOREIGN KEY ("food_order_id") REFERENCES "food_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "catering_quotes" ADD CONSTRAINT "FK_f0734d8015f29d3d97a1861bc66" FOREIGN KEY ("request_id") REFERENCES "catering_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catering_quotes" DROP CONSTRAINT "FK_f0734d8015f29d3d97a1861bc66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catering_requests" DROP CONSTRAINT "FK_7ae043c3c29369aae10eec6277a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catering_requests" DROP CONSTRAINT "FK_bf3ff5c1818bd1dbe21801a2e35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catering_requests" DROP CONSTRAINT "FK_a93d99b914c0fdf2a9c35a5a8dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP CONSTRAINT "CHK_food_orders_prepaid"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e6b14478e51da17c4b23094af"`,
    );
    await queryRunner.query(`DROP TABLE "catering_quotes"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a37db696b50dc8636a1843663"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3fc6d55d9d88c86e651c4241f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d05753adb681c13bf54a3a5c9"`,
    );
    await queryRunner.query(`DROP TABLE "catering_requests"`);
    await queryRunner.query(`DROP TYPE "public"."catering_status"`);
    await queryRunner.query(`DROP TYPE "public"."catering_fulfilment"`);
    await queryRunner.query(`DROP TYPE "public"."catering_event_type"`);
  }
}
