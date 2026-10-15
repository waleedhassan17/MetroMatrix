import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShopOrders1792071001977 implements MigrationInterface {
  name = 'ShopOrders1792071001977';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "order_groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "code" character varying(12) NOT NULL, "address_snapshot" jsonb NOT NULL, "items_total" integer NOT NULL, "discount_total" integer NOT NULL, "shipping_total" integer NOT NULL, "grand_total" integer NOT NULL, "placed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "CHK_order_groups_totals" CHECK ("grand_total" = "items_total" - "discount_total" + "shipping_total" AND "discount_total" <= "items_total" AND "shipping_total" >= 0), CONSTRAINT "PK_6ea7fe44386fee9a655142632a0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab764a0535e9ebe1a045bf6ad1" ON "order_groups" ("user_id", "placed_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ae48ef0db9cdfb2c66a08a74a5" ON "order_groups" ("code") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_order_status" AS ENUM('placed', 'confirmed', 'packed', 'shipped', 'delivered', 'completed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_order_payment_method" AS ENUM('cod', 'transfer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_order_payment_status" AS ENUM('cod_pending', 'awaiting_transfer', 'proof_submitted', 'paid', 'void', 'refund_due', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_order_actor" AS ENUM('customer', 'store', 'system', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "store_orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "group_id" uuid NOT NULL, "store_id" uuid NOT NULL, "user_id" uuid NOT NULL, "code" character varying(16) NOT NULL, "status" "public"."store_order_status" NOT NULL DEFAULT 'placed', "payment_method" "public"."store_order_payment_method" NOT NULL, "payment_status" "public"."store_order_payment_status" NOT NULL, "payment_account_snapshot" jsonb, "payment_ref" character varying(100), "payment_proof_url" character varying(500), "payment_rejected_reason" text, "pay_by" TIMESTAMP WITH TIME ZONE, "paid_at" TIMESTAMP WITH TIME ZONE, "subtotal" integer NOT NULL, "discount" integer NOT NULL, "coupon_code" character varying(20), "shipping_fee" integer NOT NULL, "total" integer NOT NULL, "return_window_days" integer NOT NULL, "customer_note" text, "courier_name" character varying(80), "tracking_ref" character varying(80), "rider_name" character varying(80), "rider_phone" character varying(16), "cancel_reason" text, "cancelled_by" "public"."store_order_actor", "cancel_requested_at" TIMESTAMP WITH TIME ZONE, "refund_amount" integer, "refund_ref" character varying(100), "refunded_at" TIMESTAMP WITH TIME ZONE, "confirmed_at" TIMESTAMP WITH TIME ZONE, "packed_at" TIMESTAMP WITH TIME ZONE, "shipped_at" TIMESTAMP WITH TIME ZONE, "delivered_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "store_reminded_at" TIMESTAMP WITH TIME ZONE, "customer_cancel_hint_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_store_orders_totals" CHECK ("total" = "subtotal" - "discount" + "shipping_fee" AND "discount" >= 0 AND "discount" <= "subtotal" AND "shipping_fee" >= 0), CONSTRAINT "PK_933466221cd1655422e141de423" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eab8c5704d500e9fedf2b45873" ON "store_orders" ("payment_status", "pay_by") `,
    );
    // Partner order lists: newest first within a status (TypeORM cannot express DESC).
    await queryRunner.query(
      `CREATE INDEX "IDX_store_orders_store_status_created" ON "store_orders" ("store_id", "status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a182ddb84ba70377d2e1c9d0ac" ON "store_orders" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3933470214e84fb784160a5e5d" ON "store_orders" ("group_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ab6c756dbd711b2f008dbe798f" ON "store_orders" ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "store_order_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "variant_id" uuid NOT NULL, "product_name" character varying(140) NOT NULL, "variant_label" character varying(90) NOT NULL, "image_url" character varying(500), "unit_price" integer NOT NULL, "quantity" integer NOT NULL, "line_total" integer NOT NULL, "returned_qty" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_store_order_items_amounts" CHECK ("quantity" > 0 AND "unit_price" > 0 AND "line_total" = "unit_price" * "quantity" AND "returned_qty" BETWEEN 0 AND "quantity"), CONSTRAINT "PK_f32650fc0c0127feb430dd489ce" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_68b3a6c14fcbd43687b7ff9398" ON "store_order_items" ("variant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e2f2a355960fb1887a3c50f11" ON "store_order_items" ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_997b2c3ad93870467522fbd954" ON "store_order_items" ("store_order_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."store_order_event_kind" AS ENUM('status', 'payment', 'note')`,
    );
    await queryRunner.query(
      `CREATE TABLE "store_order_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_order_id" uuid NOT NULL, "kind" "public"."store_order_event_kind" NOT NULL, "from_state" character varying(30), "to_state" character varying(30), "actor_user_id" uuid, "actor_role" "public"."store_order_actor" NOT NULL, "note" text, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "PK_86c00ffe2b0bddeaf2ef3fb7d48" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b942e43049d330da81d8b6256e" ON "store_order_events" ("store_order_id", "at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "order_groups" ADD CONSTRAINT "FK_767f30b4dd3cb879461e957a825" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_orders" ADD CONSTRAINT "FK_3933470214e84fb784160a5e5d8" FOREIGN KEY ("group_id") REFERENCES "order_groups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_orders" ADD CONSTRAINT "FK_50f4a4cf441c2dd08f185857f1a" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_orders" ADD CONSTRAINT "FK_36bec82ab032856cb3c259893b1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" ADD CONSTRAINT "FK_997b2c3ad93870467522fbd9543" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" ADD CONSTRAINT "FK_2e2f2a355960fb1887a3c50f116" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" ADD CONSTRAINT "FK_68b3a6c14fcbd43687b7ff9398b" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_events" ADD CONSTRAINT "FK_082129a5cf191f9318031b379ba" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "FK_b5e7cd26a25dec9ae7afa947cf5" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "FK_b5e7cd26a25dec9ae7afa947cf5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_events" DROP CONSTRAINT "FK_082129a5cf191f9318031b379ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" DROP CONSTRAINT "FK_68b3a6c14fcbd43687b7ff9398b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" DROP CONSTRAINT "FK_2e2f2a355960fb1887a3c50f116"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" DROP CONSTRAINT "FK_997b2c3ad93870467522fbd9543"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_orders" DROP CONSTRAINT "FK_36bec82ab032856cb3c259893b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_orders" DROP CONSTRAINT "FK_50f4a4cf441c2dd08f185857f1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_orders" DROP CONSTRAINT "FK_3933470214e84fb784160a5e5d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_groups" DROP CONSTRAINT "FK_767f30b4dd3cb879461e957a825"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b942e43049d330da81d8b6256e"`,
    );
    await queryRunner.query(`DROP TABLE "store_order_events"`);
    await queryRunner.query(`DROP TYPE "public"."store_order_event_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_997b2c3ad93870467522fbd954"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e2f2a355960fb1887a3c50f11"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_68b3a6c14fcbd43687b7ff9398"`,
    );
    await queryRunner.query(`DROP TABLE "store_order_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab6c756dbd711b2f008dbe798f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3933470214e84fb784160a5e5d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a182ddb84ba70377d2e1c9d0ac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_store_orders_store_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eab8c5704d500e9fedf2b45873"`,
    );
    await queryRunner.query(`DROP TABLE "store_orders"`);
    await queryRunner.query(`DROP TYPE "public"."store_order_actor"`);
    await queryRunner.query(`DROP TYPE "public"."store_order_payment_status"`);
    await queryRunner.query(`DROP TYPE "public"."store_order_payment_method"`);
    await queryRunner.query(`DROP TYPE "public"."store_order_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae48ef0db9cdfb2c66a08a74a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab764a0535e9ebe1a045bf6ad1"`,
    );
    await queryRunner.query(`DROP TABLE "order_groups"`);
  }
}
