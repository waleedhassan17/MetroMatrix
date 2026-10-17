import { MigrationInterface, QueryRunner } from 'typeorm';

export class FoodRiderDelivery1792263681488 implements MigrationInterface {
  name = 'FoodRiderDelivery1792263681488';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "rider_location_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "rider_id" uuid NOT NULL, "order_id" uuid, "lat" numeric(9,6) NOT NULL, "lng" numeric(9,6) NOT NULL, "heading" smallint, "speed" numeric(6,2), "accuracy" numeric(7,1), "at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_e4d5eb8cb27d93948ae69a380b2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4b149bdccbe515dbc6535195cb" ON "rider_location_logs" ("order_id", "at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_37f959ba98440102778e0c0410" ON "rider_location_logs" ("rider_id", "at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rider_cash_kind" AS ENUM('cod_collected', 'handover', 'adjustment')`,
    );
    await queryRunner.query(
      `CREATE TABLE "rider_cash_ledger" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "rider_id" uuid NOT NULL, "order_id" uuid, "kind" "public"."rider_cash_kind" NOT NULL, "amount" integer NOT NULL, "note" character varying(200), "recorded_by" uuid, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_rider_cash_ledger_sign" CHECK (("kind" = 'cod_collected' AND "amount" > 0) OR ("kind" = 'handover' AND "amount" < 0) OR ("kind" = 'adjustment' AND "amount" <> 0)), CONSTRAINT "PK_d1778d1423e086fe885ef438d87" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_rider_cash_ledger_cod" ON "rider_cash_ledger" ("order_id") WHERE "kind" = 'cod_collected'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c0fa8f624283437bc47b24af4" ON "rider_cash_ledger" ("rider_id", "at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."food_rider_step" AS ENUM('assigned', 'accepted_by_rider', 'arrived_at_branch', 'picked_up', 'arrived_at_customer', 'delivered', 'declined')`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" ADD "rider_step" "public"."food_rider_step"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_location_logs" ADD CONSTRAINT "FK_738fb547a68a8956737234f17b3" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_location_logs" ADD CONSTRAINT "FK_e1214f6185d62c6279d043a75a7" FOREIGN KEY ("order_id") REFERENCES "food_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_cash_ledger" ADD CONSTRAINT "FK_29ca35855b6ebc640f463d3a7be" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_cash_ledger" ADD CONSTRAINT "FK_a03cb9a0f79afc03132091e0808" FOREIGN KEY ("order_id") REFERENCES "food_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_cash_ledger" ADD CONSTRAINT "FK_d9b2ba80ef5a2e0cbaac307ead9" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rider_cash_ledger" DROP CONSTRAINT "FK_d9b2ba80ef5a2e0cbaac307ead9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_cash_ledger" DROP CONSTRAINT "FK_a03cb9a0f79afc03132091e0808"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_cash_ledger" DROP CONSTRAINT "FK_29ca35855b6ebc640f463d3a7be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_location_logs" DROP CONSTRAINT "FK_e1214f6185d62c6279d043a75a7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rider_location_logs" DROP CONSTRAINT "FK_738fb547a68a8956737234f17b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_orders" DROP COLUMN "rider_step"`,
    );
    await queryRunner.query(`DROP TYPE "public"."food_rider_step"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c0fa8f624283437bc47b24af4"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_rider_cash_ledger_cod"`);
    await queryRunner.query(`DROP TABLE "rider_cash_ledger"`);
    await queryRunner.query(`DROP TYPE "public"."rider_cash_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_37f959ba98440102778e0c0410"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b149bdccbe515dbc6535195cb"`,
    );
    await queryRunner.query(`DROP TABLE "rider_location_logs"`);
  }
}
