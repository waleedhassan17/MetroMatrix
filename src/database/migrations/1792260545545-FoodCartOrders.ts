import { MigrationInterface, QueryRunner } from 'typeorm';

export class FoodCartOrders1792260545545 implements MigrationInterface {
  name = 'FoodCartOrders1792260545545';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."food_promotion_kind" AS ENUM('percent_off_order', 'percent_off_items', 'flat_off', 'free_delivery')`,
    );
    await queryRunner.query(
      `CREATE TABLE "food_promotions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "brand_id" uuid NOT NULL, "title" character varying(80) NOT NULL, "kind" "public"."food_promotion_kind" NOT NULL, "value" integer NOT NULL DEFAULT '0', "item_ids" uuid array NOT NULL DEFAULT '{}', "min_order" integer NOT NULL DEFAULT '0', "max_discount" integer, "code" citext, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE, "weekdays_mask" smallint NOT NULL DEFAULT '127', "time_from" TIME, "time_to" TIME, "usage_limit" integer, "per_user_limit" integer, "used_count" integer NOT NULL DEFAULT '0', "first_order_only" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "CHK_food_promotions_counts" CHECK ("used_count" >= 0 AND "min_order" >= 0 AND ("usage_limit" IS NULL OR "usage_limit" >= 1) AND ("per_user_limit" IS NULL OR "per_user_limit" >= 1)), CONSTRAINT "CHK_food_promotions_value" CHECK ("value" >= 0 AND ("kind" NOT IN ('percent_off_order', 'percent_off_items') OR "value" BETWEEN 1 AND 100)), CONSTRAINT "PK_4d6de95eed7f852abe02d8010cc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_food_promotions_code" ON "food_promotions" ("brand_id", "code") WHERE "code" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfd93f538a97a1a3605e42617c" ON "food_promotions" ("brand_id", "is_active") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_order_fulfilment" AS ENUM('delivery', 'pickup')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_order_status" AS ENUM('placed', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'picked_up', 'rejected', 'auto_rejected', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_payment_method" AS ENUM('cod', 'transfer', 'pay_at_pickup')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_payment_status" AS ENUM('cod_pending', 'unpaid', 'awaiting_transfer', 'proof_submitted', 'paid', 'void', 'refund_due', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_order_cancelled_by" AS ENUM('customer', 'vendor', 'rider', 'system', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "food_orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(16) NOT NULL, "user_id" uuid NOT NULL, "brand_id" uuid NOT NULL, "branch_id" uuid NOT NULL, "fulfilment" "public"."food_order_fulfilment" NOT NULL, "scheduled_for" TIMESTAMP WITH TIME ZONE, "slot_id" uuid, "status" "public"."food_order_status" NOT NULL DEFAULT 'placed', "payment_method" "public"."food_payment_method" NOT NULL, "payment_status" "public"."food_payment_status" NOT NULL, "payment_account_snapshot" jsonb, "payment_ref" character varying(60), "payment_proof_url" character varying(500), "payment_rejected_reason" character varying(200), "pay_by" TIMESTAMP WITH TIME ZONE, "paid_at" TIMESTAMP WITH TIME ZONE, "address_snapshot" jsonb, "drop_geo" geography(Point,4326), "distance_m" integer, "subtotal" integer NOT NULL, "discount" integer NOT NULL DEFAULT '0', "promotion_id" uuid, "promotion_snapshot" jsonb, "delivery_fee" integer NOT NULL DEFAULT '0', "total" integer NOT NULL, "cutlery" boolean NOT NULL DEFAULT false, "customer_note" character varying(300), "eta_minutes" integer, "promised_at" TIMESTAMP WITH TIME ZONE, "accept_by" TIMESTAMP WITH TIME ZONE NOT NULL, "portion_date" date, "rider_id" uuid, "handed_to_external" boolean NOT NULL DEFAULT false, "cod_collected" integer, "accepted_at" TIMESTAMP WITH TIME ZONE, "preparing_at" TIMESTAMP WITH TIME ZONE, "ready_at" TIMESTAMP WITH TIME ZONE, "picked_up_at" TIMESTAMP WITH TIME ZONE, "delivered_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" "public"."food_order_cancelled_by", "cancel_reason" character varying(300), "kitchen_reminded_at" TIMESTAMP WITH TIME ZONE, "accept_nudged_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_food_orders_cod_collected" CHECK ("cod_collected" IS NULL OR ("cod_collected" >= 0 AND "cod_collected" <= "total")), CONSTRAINT "CHK_food_orders_money" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "delivery_fee" >= 0 AND "total" >= 0 AND "total" = "subtotal" - "discount" + "delivery_fee"), CONSTRAINT "PK_b5765853128905c515770b51a04" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_food_orders_pay_by" ON "food_orders" ("pay_by") WHERE "payment_status" = 'awaiting_transfer'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_food_orders_accept_by" ON "food_orders" ("accept_by") WHERE "status" = 'placed'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4dcd960752cc684296f3e99baa" ON "food_orders" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4303f3e46cdf9a0b1356a4763" ON "food_orders" ("rider_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_food_orders_branch_status" ON "food_orders" ("branch_id", "status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4e1bb85ead9a6adc46cfa3004b" ON "food_orders" ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "food_order_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "line_no" smallint NOT NULL, "item_id" uuid, "variant_id" uuid, "item_name" character varying(120) NOT NULL, "variant_name" character varying(60), "options" jsonb NOT NULL DEFAULT '[]', "unit_price" integer NOT NULL, "quantity" smallint NOT NULL, "line_total" integer NOT NULL, "notes" character varying(200), "portions_taken" smallint NOT NULL DEFAULT '0', CONSTRAINT "CHK_food_order_items" CHECK ("quantity" BETWEEN 1 AND 50 AND "unit_price" >= 0 AND "line_total" = "unit_price" * "quantity" AND "portions_taken" >= 0), CONSTRAINT "PK_40f7df0ed90943093c4073c6efa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4cbd41e6e124ac6c172ea3b470" ON "food_order_items" ("order_id", "line_no") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_order_event_kind" AS ENUM('status', 'payment', 'rider', 'note')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_order_actor" AS ENUM('customer', 'vendor', 'rider', 'system', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "food_order_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "seq" BIGSERIAL NOT NULL, "order_id" uuid NOT NULL, "kind" "public"."food_order_event_kind" NOT NULL, "from_state" character varying(30), "to_state" character varying(30), "actor_role" "public"."food_order_actor" NOT NULL, "actor_user_id" uuid, "note" character varying(300), "data" jsonb, CONSTRAINT "PK_e7d1a887583f312c436ce30f16f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d6cc17d6681432bab23679758" ON "food_order_events" ("order_id", "seq") `,
    );
    await queryRunner.query(
      `CREATE TABLE "food_cart_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cart_id" uuid NOT NULL, "item_id" uuid NOT NULL, "variant_id" uuid, "option_ids" uuid array NOT NULL DEFAULT '{}', "quantity" smallint NOT NULL, "notes" character varying(200), "unit_price_seen" integer NOT NULL, CONSTRAINT "CHK_food_cart_items_quantity" CHECK ("quantity" BETWEEN 1 AND 50), CONSTRAINT "PK_4115223738d9cb770a27d889666" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24a1cda228b4004b813013e4cd" ON "food_cart_items" ("cart_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_cart_fulfilment" AS ENUM('delivery', 'pickup')`,
    );
    await queryRunner.query(
      `CREATE TABLE "food_carts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "brand_id" uuid NOT NULL, "branch_id" uuid NOT NULL, "fulfilment" "public"."food_cart_fulfilment" NOT NULL DEFAULT 'delivery', "scheduled_for" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_456f6fad6e474d68dc1149bbf6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_538adb165bbdd53f59d7403d6d" ON "food_carts" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "food_promotions" ADD CONSTRAINT "FK_65309d5658014dccd4ca08acd24" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD CONSTRAINT "FK_a7a45ff1ecfc225b58d7e0c75ee" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD CONSTRAINT "FK_e8dbff9db8dabfcd35262f5b6c7" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD CONSTRAINT "FK_d1a388585c3812f41fc14315c75" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD CONSTRAINT "FK_e3a875948355770226f8da50c55" FOREIGN KEY ("slot_id") REFERENCES "preorder_slots"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD CONSTRAINT "FK_61cdb1050d9932731278c0ec10e" FOREIGN KEY ("promotion_id") REFERENCES "food_promotions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD CONSTRAINT "FK_270bf673166e6406e3ff504dc9b" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_order_items" ADD CONSTRAINT "FK_8c962330a4b584a58102bf632f7" FOREIGN KEY ("order_id") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_order_events" ADD CONSTRAINT "FK_ffa1150de88083ba4449fd59836" FOREIGN KEY ("order_id") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_cart_items" ADD CONSTRAINT "FK_24a1cda228b4004b813013e4cdc" FOREIGN KEY ("cart_id") REFERENCES "food_carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_cart_items" ADD CONSTRAINT "FK_3bc87b920b85ec5e9e04867b8f0" FOREIGN KEY ("item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_carts" ADD CONSTRAINT "FK_538adb165bbdd53f59d7403d6d2" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_carts" ADD CONSTRAINT "FK_4ac5076064965e1da2f9027a9ec" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_carts" ADD CONSTRAINT "FK_37b7ae646eada6ccbc241436554" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "food_carts" DROP CONSTRAINT "FK_37b7ae646eada6ccbc241436554"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_carts" DROP CONSTRAINT "FK_4ac5076064965e1da2f9027a9ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_carts" DROP CONSTRAINT "FK_538adb165bbdd53f59d7403d6d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_cart_items" DROP CONSTRAINT "FK_3bc87b920b85ec5e9e04867b8f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_cart_items" DROP CONSTRAINT "FK_24a1cda228b4004b813013e4cdc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_order_events" DROP CONSTRAINT "FK_ffa1150de88083ba4449fd59836"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_order_items" DROP CONSTRAINT "FK_8c962330a4b584a58102bf632f7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP CONSTRAINT "FK_270bf673166e6406e3ff504dc9b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP CONSTRAINT "FK_61cdb1050d9932731278c0ec10e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP CONSTRAINT "FK_e3a875948355770226f8da50c55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP CONSTRAINT "FK_d1a388585c3812f41fc14315c75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP CONSTRAINT "FK_e8dbff9db8dabfcd35262f5b6c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP CONSTRAINT "FK_a7a45ff1ecfc225b58d7e0c75ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_promotions" DROP CONSTRAINT "FK_65309d5658014dccd4ca08acd24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_538adb165bbdd53f59d7403d6d"`,
    );
    await queryRunner.query(`DROP TABLE "food_carts"`);
    await queryRunner.query(`DROP TYPE "public"."food_cart_fulfilment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24a1cda228b4004b813013e4cd"`,
    );
    await queryRunner.query(`DROP TABLE "food_cart_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3d6cc17d6681432bab23679758"`,
    );
    await queryRunner.query(`DROP TABLE "food_order_events"`);
    await queryRunner.query(`DROP TYPE "public"."food_order_actor"`);
    await queryRunner.query(`DROP TYPE "public"."food_order_event_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4cbd41e6e124ac6c172ea3b470"`,
    );
    await queryRunner.query(`DROP TABLE "food_order_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e1bb85ead9a6adc46cfa3004b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_food_orders_branch_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4303f3e46cdf9a0b1356a4763"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4dcd960752cc684296f3e99baa"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_food_orders_accept_by"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_food_orders_pay_by"`);
    await queryRunner.query(`DROP TABLE "food_orders"`);
    await queryRunner.query(`DROP TYPE "public"."food_order_cancelled_by"`);
    await queryRunner.query(`DROP TYPE "public"."food_payment_status"`);
    await queryRunner.query(`DROP TYPE "public"."food_payment_method"`);
    await queryRunner.query(`DROP TYPE "public"."food_order_status"`);
    await queryRunner.query(`DROP TYPE "public"."food_order_fulfilment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfd93f538a97a1a3605e42617c"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_food_promotions_code"`);
    await queryRunner.query(`DROP TABLE "food_promotions"`);
    await queryRunner.query(`DROP TYPE "public"."food_promotion_kind"`);
  }
}
