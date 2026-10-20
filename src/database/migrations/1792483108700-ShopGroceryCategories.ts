import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grocery in the Shopping taxonomy (Chunk 5, My Kitchen): a root and its
 * aisles, so grocery stores can list with pack sizes and the pantry's
 * missing-to-bag compare can find them.
 */
export const GROCERY_TAXONOMY: Array<[slug: string, name: string]> = [
  ['grocery-vegetables-fruit', 'Vegetables & fruit'],
  ['grocery-meat-poultry', 'Meat & poultry'],
  ['grocery-dairy-eggs', 'Dairy & eggs'],
  ['grocery-rice-flour', 'Rice, flour & grains'],
  ['grocery-pulses', 'Pulses & lentils'],
  ['grocery-spices', 'Spices & masala'],
  ['grocery-oil-ghee', 'Oil & ghee'],
  ['grocery-bakery', 'Bakery'],
  ['grocery-sauces', 'Sauces & condiments'],
  ['grocery-beverages', 'Tea, coffee & drinks'],
  ['grocery-snacks', 'Snacks & sweets'],
];

export class ShopGroceryCategories1792483108700 implements MigrationInterface {
  name = 'ShopGroceryCategories1792483108700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "shop_categories" ("name", "slug", "icon", "sort")
       SELECT 'Grocery', 'grocery', 'grocery', coalesce(max(sort), -1) + 1 FROM "shop_categories" WHERE "parent_id" IS NULL
       ON CONFLICT ("slug") DO NOTHING`,
    );
    for (const [i, [slug, name]] of GROCERY_TAXONOMY.entries())
      await queryRunner.query(
        `INSERT INTO "shop_categories" ("parent_id", "name", "slug", "sort")
         SELECT id, $1, $2, $3 FROM "shop_categories" WHERE "slug" = 'grocery'
         ON CONFLICT ("slug") DO NOTHING`,
        [name, slug, i],
      );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "shop_categories" WHERE "slug" = ANY($1)`,
      [GROCERY_TAXONOMY.map(([s]) => s)],
    );
    await queryRunner.query(
      `DELETE FROM "shop_categories" WHERE "slug" = 'grocery'`,
    );
  }
}
