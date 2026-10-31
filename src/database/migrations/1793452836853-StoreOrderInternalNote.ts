import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreOrderInternalNote1793452836853 implements MigrationInterface {
  name = 'StoreOrderInternalNote1793452836853';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "store_orders" ADD "internal_note" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "store_orders" DROP COLUMN "internal_note"`,
    );
  }
}
