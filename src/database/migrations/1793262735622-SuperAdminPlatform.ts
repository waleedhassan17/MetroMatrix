import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Super admin S5, S7–S9, all additive:
 * - platform_settings: the feature flags (absent key = its default);
 * - admin_broadcasts: console pushes and their delivery counts;
 * - refresh_tokens.client / session_started_at: console cookie sessions
 *   (existing rows default to 'app', exactly what they are);
 * - created_at indexes for the overview and analytics periods.
 */
export class SuperAdminPlatform1793262735622 implements MigrationInterface {
  name = 'SuperAdminPlatform1793262735622';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "platform_settings" ("key" character varying(64) NOT NULL, "value" jsonb NOT NULL, "updated_by" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5d9031e30fac3ec3ec8b9602e17" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_broadcasts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid NOT NULL, "audience" character varying(16) NOT NULL, "service" character varying(16), "title" character varying(65) NOT NULL, "body" character varying(240) NOT NULL, "deep_link" character varying(500), "status" character varying(16) NOT NULL DEFAULT 'queued', "recipients" integer NOT NULL DEFAULT '0', "devices" integer NOT NULL DEFAULT '0', "delivered" integer NOT NULL DEFAULT '0', "failed" integer NOT NULL DEFAULT '0', "error" text, "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_admin_broadcasts_status" CHECK ("status" IN ('queued', 'sending', 'sent', 'failed')), CONSTRAINT "CHK_admin_broadcasts_audience" CHECK ("audience" IN ('all', 'customers', 'partners', 'riders')), CONSTRAINT "PK_f16f09752d4eb02c7164f7f4a3c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_627954e1fd83ecd0ff90b1fcf3" ON "admin_broadcasts" ("created_by", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "client" character varying(16) NOT NULL DEFAULT 'app'`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "session_started_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_created_at" ON "users" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_businesses_service_status" ON "businesses" ("service_type", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_store_orders_created_at" ON "store_orders" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_food_orders_created_at" ON "food_orders" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_appointments_created_at" ON "appointments" ("created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_appointments_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_food_orders_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_store_orders_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_businesses_service_status"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_users_created_at"`);
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "session_started_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "client"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_627954e1fd83ecd0ff90b1fcf3"`,
    );
    await queryRunner.query(`DROP TABLE "admin_broadcasts"`);
    await queryRunner.query(`DROP TABLE "platform_settings"`);
  }
}
