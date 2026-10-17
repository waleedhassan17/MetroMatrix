import { MigrationInterface, QueryRunner } from 'typeorm';

export class FoodFavourites1792262221116 implements MigrationInterface {
  name = 'FoodFavourites1792262221116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "food_favourites" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "brand_id" uuid NOT NULL, CONSTRAINT "PK_f624959119daf3eced8d65994ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ed61b534d7ab6f9dcb2ddbd0ea" ON "food_favourites" ("user_id", "brand_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "food_favourites" ADD CONSTRAINT "FK_ecffb876b7a848e433603c4dff9" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_favourites" ADD CONSTRAINT "FK_3ae7151e45558ba0b96caa410b3" FOREIGN KEY ("brand_id") REFERENCES "food_brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "food_favourites" DROP CONSTRAINT "FK_3ae7151e45558ba0b96caa410b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "food_favourites" DROP CONSTRAINT "FK_ecffb876b7a848e433603c4dff9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed61b534d7ab6f9dcb2ddbd0ea"`,
    );
    await queryRunner.query(`DROP TABLE "food_favourites"`);
  }
}
