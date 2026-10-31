import { MigrationInterface, QueryRunner } from 'typeorm';

export class StorePhone1793452340811 implements MigrationInterface {
  name = 'StorePhone1793452340811';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stores" ADD "phone" character varying(16)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "phone"`);
  }
}
