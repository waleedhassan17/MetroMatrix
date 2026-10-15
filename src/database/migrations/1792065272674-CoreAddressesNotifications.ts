import { MigrationInterface, QueryRunner } from 'typeorm';

export class CoreAddressesNotifications1792065272674 implements MigrationInterface {
  name = 'CoreAddressesNotifications1792065272674';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "type" character varying(64) NOT NULL, "title" character varying(140) NOT NULL, "body" character varying(500) NOT NULL, "data" jsonb NOT NULL, "read_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_unread" ON "notifications" ("user_id") WHERE "read_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_310667f935698fcd8cb319113a" ON "notifications" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."address_label" AS ENUM('home', 'work', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "addresses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "label" "public"."address_label" NOT NULL DEFAULT 'home', "full_name" character varying(80) NOT NULL, "phone" character varying(16) NOT NULL, "city" character varying(60) NOT NULL, "area" character varying(100) NOT NULL, "line1" character varying(255) NOT NULL, "landmark" character varying(255), "lat" numeric(9,6), "lng" numeric(9,6), "is_default" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_745d8f43d3af10ab8247465e450" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2e2d417237527d8b6beb238f2" ON "addresses" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_addresses_one_default_per_user" ON "addresses" ("user_id") WHERE "is_default"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "addresses" ADD CONSTRAINT "FK_16aac8a9f6f9c1dd6bcb75ec023" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "addresses" DROP CONSTRAINT "FK_16aac8a9f6f9c1dd6bcb75ec023"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_addresses_one_default_per_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2e2d417237527d8b6beb238f2"`,
    );
    await queryRunner.query(`DROP TABLE "addresses"`);
    await queryRunner.query(`DROP TYPE "public"."address_label"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_310667f935698fcd8cb319113a"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_unread"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
