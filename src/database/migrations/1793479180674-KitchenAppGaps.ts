import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenAppGaps1793479180674 implements MigrationInterface {
  name = 'KitchenAppGaps1793479180674';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "pantry_reminder_settings" ("user_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "hour" smallint NOT NULL DEFAULT '9', "days_before" smallint NOT NULL DEFAULT '2', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_pantry_reminder_days" CHECK ("days_before" BETWEEN 0 AND 3), CONSTRAINT "CHK_pantry_reminder_hour" CHECK ("hour" BETWEEN 6 AND 22), CONSTRAINT "PK_45d6563d99075b5b69364bb650a" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" ADD "show_calories" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_boxes" ADD "photo_url" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_plans" ADD "photo_url" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" ALTER COLUMN "target_kcal" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" ALTER COLUMN "target_method" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "pantry_reminder_settings" ADD CONSTRAINT "FK_45d6563d99075b5b69364bb650a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pantry_reminder_settings" DROP CONSTRAINT "FK_45d6563d99075b5b69364bb650a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" ALTER COLUMN "target_method" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" ALTER COLUMN "target_kcal" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tiffin_plans" DROP COLUMN "photo_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "surplus_boxes" DROP COLUMN "photo_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nutrition_profiles" DROP COLUMN "show_calories"`,
    );
    await queryRunner.query(`DROP TABLE "pantry_reminder_settings"`);
  }
}
