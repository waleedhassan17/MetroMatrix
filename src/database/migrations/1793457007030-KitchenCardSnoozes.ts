import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenCardSnoozes1793457007030 implements MigrationInterface {
  name = 'KitchenCardSnoozes1793457007030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "kitchen_card_snoozes" ("branch_id" uuid NOT NULL, "card_key" character varying(200) NOT NULL, "snoozed_until" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2f0bf5dd5191195d7f9a3e2480d" PRIMARY KEY ("branch_id", "card_key"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen_card_snoozes" ADD CONSTRAINT "FK_890c275e8bbaec39401e708bcc2" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kitchen_card_snoozes" DROP CONSTRAINT "FK_890c275e8bbaec39401e708bcc2"`,
    );
    await queryRunner.query(`DROP TABLE "kitchen_card_snoozes"`);
  }
}
