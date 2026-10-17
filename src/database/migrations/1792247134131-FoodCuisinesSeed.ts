import { MigrationInterface, QueryRunner } from 'typeorm';

/** The cuisine chips Food Court launches with (staff can add, rename or retire them). */
export const CUISINES: Array<[slug: string, name: string, icon: string]> = [
  ['pakistani', 'Pakistani', 'pakistani'],
  ['bbq', 'BBQ', 'bbq'],
  ['fast-food', 'Fast food', 'fast_food'],
  ['burgers', 'Burgers', 'burger'],
  ['pizza', 'Pizza', 'pizza'],
  ['chinese', 'Chinese', 'chinese'],
  ['biryani', 'Biryani', 'biryani'],
  ['karahi', 'Karahi', 'karahi'],
  ['desserts', 'Desserts', 'dessert'],
  ['bakery', 'Bakery', 'bakery'],
  ['cafe', 'Cafe', 'cafe'],
  ['healthy', 'Healthy', 'healthy'],
  ['breakfast', 'Breakfast', 'breakfast'],
  ['shawarma', 'Shawarma', 'shawarma'],
  ['rolls', 'Rolls', 'roll'],
  ['ice-cream', 'Ice cream', 'ice_cream'],
  ['home-food', 'Home food', 'home_food'],
  ['beverages', 'Beverages', 'beverage'],
];

export class FoodCuisinesSeed1792247134131 implements MigrationInterface {
  name = 'FoodCuisinesSeed1792247134131';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [i, [slug, name, icon]] of CUISINES.entries()) {
      await queryRunner.query(
        `INSERT INTO cuisines (slug, name, icon, sort) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
        [slug, name, icon, (i + 1) * 10],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM cuisines WHERE slug = ANY($1::text[])`,
      [CUISINES.map((c) => c[0])],
    );
  }
}
