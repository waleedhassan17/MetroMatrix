import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The platform shopping taxonomy — reference data every environment needs,
 * so it ships as a migration (admins edit it later via /admin/shop/categories).
 * Idempotent: re-running inserts nothing that already exists.
 */
const TAXONOMY: Array<{
  slug: string;
  name: string;
  icon: string;
  children: Array<[slug: string, name: string]>;
}> = [
  {
    slug: 'women',
    name: 'Women',
    icon: 'women',
    children: [
      ['women-kurtas-tunics', 'Kurtas & tunics'],
      ['women-shalwar-kameez', 'Shalwar kameez'],
      ['women-dupattas-shawls', 'Dupattas & shawls'],
      ['women-western-wear', 'Western wear'],
      ['women-footwear', 'Footwear'],
    ],
  },
  {
    slug: 'men',
    name: 'Men',
    icon: 'men',
    children: [
      ['men-kurtas-shalwar-kameez', 'Kurtas & shalwar kameez'],
      ['men-shirts-tshirts', 'Shirts & T-shirts'],
      ['men-trousers-jeans', 'Trousers & jeans'],
      ['men-waistcoats', 'Waistcoats'],
      ['men-footwear', 'Footwear'],
    ],
  },
  {
    slug: 'kids',
    name: 'Kids',
    icon: 'kids',
    children: [
      ['kids-girls', 'Girls'],
      ['kids-boys', 'Boys'],
      ['kids-babies', 'Babies'],
      ['kids-school-essentials', 'School essentials'],
    ],
  },
  {
    slug: 'beauty-care',
    name: 'Beauty & care',
    icon: 'beauty',
    children: [
      ['beauty-skincare', 'Skincare'],
      ['beauty-makeup', 'Makeup'],
      ['beauty-hair-care', 'Hair care'],
      ['beauty-fragrance', 'Fragrance'],
      ['beauty-personal-care', 'Personal care'],
    ],
  },
  {
    slug: 'home-living',
    name: 'Home & living',
    icon: 'home',
    children: [
      ['home-bedding', 'Bedding'],
      ['home-kitchen-dining', 'Kitchen & dining'],
      ['home-decor', 'Décor'],
      ['home-bath', 'Bath'],
      ['home-storage', 'Storage'],
    ],
  },
  {
    slug: 'accessories',
    name: 'Accessories',
    icon: 'accessories',
    children: [
      ['accessories-bags', 'Bags'],
      ['accessories-jewellery', 'Jewellery'],
      ['accessories-watches', 'Watches'],
      ['accessories-belts-wallets', 'Belts & wallets'],
      ['accessories-sunglasses', 'Sunglasses'],
    ],
  },
  {
    slug: 'handmade',
    name: 'Handmade',
    icon: 'handmade',
    children: [
      ['handmade-embroidery', 'Embroidery'],
      ['handmade-pottery-ceramics', 'Pottery & ceramics'],
      ['handmade-woodwork', 'Woodwork'],
      ['handmade-truck-art', 'Truck art'],
      ['handmade-handwoven-textiles', 'Handwoven textiles'],
    ],
  },
  {
    slug: 'electronics-accessories',
    name: 'Electronics accessories',
    icon: 'electronics',
    children: [
      ['electronics-phone-cases', 'Phone cases'],
      ['electronics-chargers-cables', 'Chargers & cables'],
      ['electronics-audio', 'Audio'],
      ['electronics-power-banks', 'Power banks'],
      ['electronics-smart-accessories', 'Smart accessories'],
    ],
  },
];

export class ShopCategoriesSeed1792065738567 implements MigrationInterface {
  name = 'ShopCategoriesSeed1792065738567';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [rootIndex, root] of TAXONOMY.entries()) {
      await queryRunner.query(
        `INSERT INTO "shop_categories" ("name", "slug", "icon", "sort")
         VALUES ($1, $2, $3, $4) ON CONFLICT ("slug") DO NOTHING`,
        [root.name, root.slug, root.icon, rootIndex],
      );
      for (const [childIndex, [slug, name]] of root.children.entries()) {
        await queryRunner.query(
          `INSERT INTO "shop_categories" ("parent_id", "name", "slug", "sort")
           SELECT id, $1, $2, $3 FROM "shop_categories" WHERE "slug" = $4
           ON CONFLICT ("slug") DO NOTHING`,
          [name, slug, childIndex, root.slug],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const slugs = TAXONOMY.flatMap((r) => [
      r.slug,
      ...r.children.map(([s]) => s),
    ]);
    await queryRunner.query(
      `DELETE FROM "shop_categories" WHERE "parent_id" IS NOT NULL AND "slug" = ANY($1)`,
      [slugs],
    );
    await queryRunner.query(
      `DELETE FROM "shop_categories" WHERE "slug" = ANY($1)`,
      [slugs],
    );
  }
}
