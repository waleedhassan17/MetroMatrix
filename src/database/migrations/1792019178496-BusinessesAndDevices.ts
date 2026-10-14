import { MigrationInterface, QueryRunner } from 'typeorm';

export class BusinessesAndDevices1792019178496 implements MigrationInterface {
  name = 'BusinessesAndDevices1792019178496';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."business_document_kind" AS ENUM('cnic_front', 'cnic_back', 'pmdc_certificate', 'degree_certificate', 'ntn_certificate', 'shop_photo', 'pfa_licence', 'storefront_photo', 'kitchen_photo')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."business_document_status" AS ENUM('pending', 'accepted', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "business_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" uuid NOT NULL, "kind" "public"."business_document_kind" NOT NULL, "url" character varying(500) NOT NULL, "public_id" character varying(255) NOT NULL, "status" "public"."business_document_status" NOT NULL DEFAULT 'pending', "review_note" text, CONSTRAINT "PK_860ab003b3f784b2492a245ee45" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce83a3c821c765c65bf854f89c" ON "business_documents" ("business_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_business_documents_single_kind" ON "business_documents" ("business_id", "kind") WHERE "kind" NOT IN ('kitchen_photo', 'shop_photo')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."business_service_type" AS ENUM('shopping', 'healthcare', 'food')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."business_sub_type" AS ENUM('store', 'doctor', 'restaurant', 'home_kitchen', 'cloud_kitchen')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."business_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'suspended')`,
    );
    await queryRunner.query(
      `CREATE TABLE "businesses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "owner_user_id" uuid NOT NULL, "service_type" "public"."business_service_type" NOT NULL, "sub_type" "public"."business_sub_type" NOT NULL, "name" character varying(120) NOT NULL, "slug" citext NOT NULL, "phone" character varying(16) NOT NULL, "city" character varying(60) NOT NULL, "address_line" character varying(255) NOT NULL, "lat" numeric(9,6), "lng" numeric(9,6), "status" "public"."business_status" NOT NULL DEFAULT 'draft', "rejection_reason" text, "suspension_reason" text, "submitted_at" TIMESTAMP WITH TIME ZONE, "reviewed_at" TIMESTAMP WITH TIME ZONE, "reviewed_by" uuid, CONSTRAINT "CHK_businesses_sub_type_service" CHECK (("sub_type" = 'store' AND "service_type" = 'shopping') OR ("sub_type" = 'doctor' AND "service_type" = 'healthcare') OR ("sub_type" IN ('restaurant', 'home_kitchen', 'cloud_kitchen') AND "service_type" = 'food')), CONSTRAINT "PK_bc1bf63498dd2368ce3dc8686e8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_19fedc48aa416c30f3fa1cfb11" ON "businesses" ("owner_user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_82ca19bc20713fdfa72626a5da" ON "businesses" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cc476b737679d318265445f002" ON "businesses" ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_devices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "expo_push_token" character varying(255) NOT NULL, "platform" "public"."device_platform" NOT NULL, "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_c9e7e648903a9e537347aba4371" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28bd79e1b3f7c1168f0904ce24" ON "user_devices" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6e9378c25a56261499288fcc41" ON "user_devices" ("expo_push_token") `,
    );
    await queryRunner.query(
      `ALTER TABLE "business_documents" ADD CONSTRAINT "FK_ce83a3c821c765c65bf854f89c5" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "businesses" ADD CONSTRAINT "FK_19fedc48aa416c30f3fa1cfb11e" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "businesses" ADD CONSTRAINT "FK_1487c3e626eb71944cb41f4f1f6" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_devices" ADD CONSTRAINT "FK_28bd79e1b3f7c1168f0904ce241" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_devices" DROP CONSTRAINT "FK_28bd79e1b3f7c1168f0904ce241"`,
    );
    await queryRunner.query(
      `ALTER TABLE "businesses" DROP CONSTRAINT "FK_1487c3e626eb71944cb41f4f1f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "businesses" DROP CONSTRAINT "FK_19fedc48aa416c30f3fa1cfb11e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "business_documents" DROP CONSTRAINT "FK_ce83a3c821c765c65bf854f89c5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e9378c25a56261499288fcc41"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28bd79e1b3f7c1168f0904ce24"`,
    );
    await queryRunner.query(`DROP TABLE "user_devices"`);
    await queryRunner.query(`DROP TYPE "public"."device_platform"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cc476b737679d318265445f002"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_82ca19bc20713fdfa72626a5da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19fedc48aa416c30f3fa1cfb11"`,
    );
    await queryRunner.query(`DROP TABLE "businesses"`);
    await queryRunner.query(`DROP TYPE "public"."business_status"`);
    await queryRunner.query(`DROP TYPE "public"."business_sub_type"`);
    await queryRunner.query(`DROP TYPE "public"."business_service_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_business_documents_single_kind"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce83a3c821c765c65bf854f89c"`,
    );
    await queryRunner.query(`DROP TABLE "business_documents"`);
    await queryRunner.query(`DROP TYPE "public"."business_document_status"`);
    await queryRunner.query(`DROP TYPE "public"."business_document_kind"`);
  }
}
