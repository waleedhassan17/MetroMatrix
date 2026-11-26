import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScheduleOverrides1795734666866 implements MigrationInterface {
  name = 'ScheduleOverrides1795734666866';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "schedule_overrides" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "location_id" uuid NOT NULL, "date" date NOT NULL, "closed" boolean NOT NULL DEFAULT false, "ranges" jsonb NOT NULL DEFAULT '[]', "note" character varying(200), CONSTRAINT "PK_3dbce7def463776f208fd5d430a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_schedule_overrides_location_date" ON "schedule_overrides" ("location_id", "date") `,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_overrides" ADD CONSTRAINT "FK_82b82d843e5342e067b55e7ab70" FOREIGN KEY ("location_id") REFERENCES "practice_locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schedule_overrides" DROP CONSTRAINT "FK_82b82d843e5342e067b55e7ab70"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_schedule_overrides_location_date"`,
    );
    await queryRunner.query(`DROP TABLE "schedule_overrides"`);
  }
}
