import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShopReturnsReviews1792072044532 implements MigrationInterface {
  name = 'ShopReturnsReviews1792072044532';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "product_reviews" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_order_item_id" uuid NOT NULL, "product_id" uuid NOT NULL, "store_id" uuid NOT NULL, "user_id" uuid NOT NULL, "rating" smallint NOT NULL, "text" text, "photos" text array NOT NULL, "store_reply" text, "replied_at" TIMESTAMP WITH TIME ZONE, "is_hidden" boolean NOT NULL DEFAULT false, "hidden_reason" text, CONSTRAINT "CHK_product_reviews_rating" CHECK ("rating" BETWEEN 1 AND 5), CONSTRAINT "PK_67c1501aea1b0633ec441b00bd5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b71123185739ce1ca933728bdf" ON "product_reviews" ("store_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d67bdc71f78168f50789e75ec0" ON "product_reviews" ("product_id", "is_hidden", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_baa5a27f3ba438bd751524e1de" ON "product_reviews" ("store_order_item_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."return_status" AS ENUM('requested', 'approved', 'rejected', 'received', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."return_reason" AS ENUM('wrong_item', 'damaged', 'size_issue', 'not_as_described', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "return_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "store_order_id" uuid NOT NULL, "store_id" uuid NOT NULL, "user_id" uuid NOT NULL, "status" "public"."return_status" NOT NULL DEFAULT 'requested', "reason" "public"."return_reason" NOT NULL, "details" text, "photos" text array NOT NULL, "store_note" text, "refund_amount" integer, "refund_ref" character varying(100), "decided_at" TIMESTAMP WITH TIME ZONE, "received_at" TIMESTAMP WITH TIME ZONE, "refunded_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_38714de8942bd9bc3a450a06889" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_99725aa3a8e4f9dd40f497f25a" ON "return_requests" ("store_order_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_187d18ad52e87384b69d8b6052" ON "return_requests" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01c0fbaf24044cf74457bed22b" ON "return_requests" ("store_id", "status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "return_request_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "return_request_id" uuid NOT NULL, "store_order_item_id" uuid NOT NULL, "quantity" integer NOT NULL, "restocked" boolean, CONSTRAINT "CHK_return_request_items_quantity" CHECK ("quantity" > 0), CONSTRAINT "PK_4772cac6bc616ee08a622d9b16b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c0c440734f1f36a70fb32d0bc" ON "return_request_items" ("store_order_item_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_936cb0e3fb1c638390a944e32f" ON "return_request_items" ("return_request_id", "store_order_item_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."product_report_reason" AS ENUM('counterfeit', 'prohibited_item', 'misleading', 'offensive', 'wrong_category', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."product_report_status" AS ENUM('open', 'dismissed', 'actioned')`,
    );
    await queryRunner.query(
      `CREATE TABLE "product_reports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "reporter_user_id" uuid NOT NULL, "reason" "public"."product_report_reason" NOT NULL, "details" text, "status" "public"."product_report_status" NOT NULL DEFAULT 'open', "resolved_at" TIMESTAMP WITH TIME ZONE, "resolved_by" uuid, "resolution_note" text, CONSTRAINT "PK_57b3bd50de73401641fd93a2fcf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f635027838cd23a20c299cb363" ON "product_reports" ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39266e1c66048c37139b800e34" ON "product_reports" ("status", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" ADD "line_no" smallint NOT NULL DEFAULT '0'`,
    );
    // One open return per store order; one open report per customer per product.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_return_requests_one_open" ON "return_requests" ("store_order_id") WHERE "status" IN ('requested', 'approved', 'received')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_product_reports_one_open" ON "product_reports" ("product_id", "reporter_user_id") WHERE "status" = 'open'`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" ADD CONSTRAINT "FK_baa5a27f3ba438bd751524e1dee" FOREIGN KEY ("store_order_item_id") REFERENCES "store_order_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" ADD CONSTRAINT "FK_1d3fbb451c2b63d0a763f3ff5b1" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" ADD CONSTRAINT "FK_b930ee6de6395ac91525e4c76be" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" ADD CONSTRAINT "FK_8306941b81cb5be7d521bdc0834" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" ADD CONSTRAINT "FK_99725aa3a8e4f9dd40f497f25a1" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" ADD CONSTRAINT "FK_3d7e755f23ca5d13022b46f2e9f" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" ADD CONSTRAINT "FK_47fa80a304062cb2e2703f1d620" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request_items" ADD CONSTRAINT "FK_9d17641dc7ee38212e92245ca1d" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request_items" ADD CONSTRAINT "FK_4c0c440734f1f36a70fb32d0bc4" FOREIGN KEY ("store_order_item_id") REFERENCES "store_order_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reports" ADD CONSTRAINT "FK_f635027838cd23a20c299cb3633" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reports" ADD CONSTRAINT "FK_327cd374e5ab55be24c065c1afd" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_product_reports_one_open"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_return_requests_one_open"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reports" DROP CONSTRAINT "FK_327cd374e5ab55be24c065c1afd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reports" DROP CONSTRAINT "FK_f635027838cd23a20c299cb3633"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request_items" DROP CONSTRAINT "FK_4c0c440734f1f36a70fb32d0bc4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request_items" DROP CONSTRAINT "FK_9d17641dc7ee38212e92245ca1d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" DROP CONSTRAINT "FK_47fa80a304062cb2e2703f1d620"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" DROP CONSTRAINT "FK_3d7e755f23ca5d13022b46f2e9f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_requests" DROP CONSTRAINT "FK_99725aa3a8e4f9dd40f497f25a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" DROP CONSTRAINT "FK_8306941b81cb5be7d521bdc0834"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" DROP CONSTRAINT "FK_b930ee6de6395ac91525e4c76be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" DROP CONSTRAINT "FK_1d3fbb451c2b63d0a763f3ff5b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" DROP CONSTRAINT "FK_baa5a27f3ba438bd751524e1dee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "store_order_items" DROP COLUMN "line_no"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39266e1c66048c37139b800e34"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f635027838cd23a20c299cb363"`,
    );
    await queryRunner.query(`DROP TABLE "product_reports"`);
    await queryRunner.query(`DROP TYPE "public"."product_report_status"`);
    await queryRunner.query(`DROP TYPE "public"."product_report_reason"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_936cb0e3fb1c638390a944e32f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c0c440734f1f36a70fb32d0bc"`,
    );
    await queryRunner.query(`DROP TABLE "return_request_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01c0fbaf24044cf74457bed22b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_187d18ad52e87384b69d8b6052"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_99725aa3a8e4f9dd40f497f25a"`,
    );
    await queryRunner.query(`DROP TABLE "return_requests"`);
    await queryRunner.query(`DROP TYPE "public"."return_reason"`);
    await queryRunner.query(`DROP TYPE "public"."return_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_baa5a27f3ba438bd751524e1de"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d67bdc71f78168f50789e75ec0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b71123185739ce1ca933728bdf"`,
    );
    await queryRunner.query(`DROP TABLE "product_reviews"`);
  }
}
