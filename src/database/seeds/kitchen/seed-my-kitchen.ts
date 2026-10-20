import * as bcrypt from 'bcryptjs';
import { INestApplicationContext } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { FoodVendorService } from '../../../modules/food/vendor/food-vendor.service';
import { NutritionMappingService } from '../../../modules/nutrition/nutrition-mapping.service';
import { Product } from '../../../modules/shopping/products/entities/product.entity';
import { ProductVariant } from '../../../modules/shopping/products/entities/product-variant.entity';
import type { DemoStore } from '../shopping/catalog-data';
import {
  ensureAccounts,
  ensureBusiness,
  ensurePartner,
  ensureProduct,
  ensureStore,
} from '../shopping/seed-shopping';
import { SeedImages } from '../shopping/tiles';
import { DEMO_FOODIE_EMAIL, DEMO_VENDOR_EMAIL } from '../food/seed-food';

const TZ = 'Asia/Karachi';

/** A fictional grocer, so My Kitchen's missing-to-bag has something to compare. */
const GROCER: DemoStore = {
  key: 'grocery',
  name: 'Taaza Mandi Online (demo)',
  ownerName: 'Demo Grocer',
  city: 'Lahore',
  addressLine: '22 Akbari Mandi Road (fictional)',
  phone: '0300 1110199',
  tagline: 'A fictional demo grocer — vegetables, dairy and staples',
  about:
    'Demo data for MetroMatrix My Kitchen. This store, its products and its prices are fictional.',
  brandColor: '#166534',
  motif: 'dots',
  featured: false,
  deliveryCities: ['Lahore', 'Karachi'],
  shippingFlatFee: 120,
  freeShippingOver: 2500,
  returnWindowDays: 1,
  codLimit: 15000,
  accounts: [
    { kind: 'jazzcash', title: 'Taaza Mandi (demo)', number: '03001110199' },
  ],
  collections: [],
  coupons: [],
  products: [],
};

/** [name, category, base price, pack qty, pack unit, bigger pack: [label, qty, unit, extra price]?] */
const GROCERIES: Array<
  [string, string, number, number, string, [string, number, string, number]?]
> = [
  [
    'Tomatoes',
    'grocery-vegetables-fruit',
    160,
    1,
    'kg',
    ['5 kg crate', 5, 'kg', 540],
  ],
  [
    'Onions',
    'grocery-vegetables-fruit',
    120,
    1,
    'kg',
    ['5 kg bag', 5, 'kg', 380],
  ],
  [
    'Potatoes',
    'grocery-vegetables-fruit',
    90,
    1,
    'kg',
    ['5 kg bag', 5, 'kg', 290],
  ],
  ['Garlic (desi)', 'grocery-vegetables-fruit', 130, 250, 'g'],
  ['Ginger', 'grocery-vegetables-fruit', 110, 250, 'g'],
  ['Spinach (palak)', 'grocery-vegetables-fruit', 70, 500, 'g'],
  ['Green chillies', 'grocery-vegetables-fruit', 40, 250, 'g'],
  [
    'Fresh milk',
    'grocery-dairy-eggs',
    220,
    1,
    'l',
    ['1.5 litre', 1.5, 'l', 100],
  ],
  ['Plain yogurt (dahi)', 'grocery-dairy-eggs', 180, 1, 'kg'],
  [
    'Cooking cream',
    'grocery-dairy-eggs',
    190,
    200,
    'ml',
    ['1 litre', 1, 'l', 520],
  ],
  [
    'Eggs',
    'grocery-dairy-eggs',
    360,
    1,
    'dozen',
    ['2.5 dozen tray', 2.5, 'dozen', 520],
  ],
  ['Paneer', 'grocery-dairy-eggs', 420, 400, 'g'],
  [
    'Basmati rice',
    'grocery-rice-flour',
    450,
    1,
    'kg',
    ['5 kg bag', 5, 'kg', 1600],
  ],
  [
    'Chakki atta',
    'grocery-rice-flour',
    160,
    1,
    'kg',
    ['10 kg bag', 10, 'kg', 1240],
  ],
  ['Masoor daal', 'grocery-pulses', 320, 1, 'kg'],
  ['Chana daal', 'grocery-pulses', 300, 1, 'kg'],
  [
    'Cooking oil',
    'grocery-oil-ghee',
    590,
    1,
    'l',
    ['5 litre tin', 5, 'l', 2200],
  ],
  ['Desi ghee', 'grocery-oil-ghee', 1100, 500, 'g'],
  ['Red chilli powder', 'grocery-spices', 180, 200, 'g'],
  ['Garam masala', 'grocery-spices', 160, 100, 'g'],
];

export interface SeedMyKitchenResult {
  created: Record<
    'groceryProducts' | 'mapped' | 'nutrition' | 'pantry',
    number
  >;
}

/**
 * seed:kitchen part 3 (Chunk 5C): nutrition mappings for the demo kitchens
 * (the suggestions confirmed, every dish recomputed), a fictional demo
 * grocer with pack sizes (placeholder images, nothing uploaded), and a
 * pantry for one demo customer. Idempotent.
 */
export async function seedMyKitchen(
  app: INestApplicationContext,
  opts: { log?: (line: string) => void; password?: string; now?: Date } = {},
): Promise<SeedMyKitchenResult> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  const ds = app.get(DataSource);
  const created: SeedMyKitchenResult['created'] = {
    groceryProducts: 0,
    mapped: 0,
    nutrition: 0,
    pantry: 0,
  };

  // ── Nutrition for the demo kitchens ──
  for (const key of ['zafran', 'qandeel', 'rukhsana']) {
    const [b] = await ds.query(
      `SELECT b.id FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE u.email = $1`,
      [DEMO_VENDOR_EMAIL(key)],
    );
    if (!b) continue;
    const v = await app.get(FoodVendorService).ensureForBusinessId(b.id);
    const r = await app.get(NutritionMappingService).acceptAll(v);
    created.mapped += r.accepted;
    created.nutrition += r.recomputed.recipe;
  }
  log(
    `Nutrition: ${created.mapped} ingredients mapped, ${created.nutrition} dishes from their recipes`,
  );

  // ── The demo grocer ──
  const password = opts.password ?? process.env.SEED_DEMO_PASSWORD ?? '';
  if (password.length >= 8) {
    const categories = new Map<string, string>(
      (await ds.query(`SELECT id, slug FROM shop_categories`)).map(
        (r: { id: string; slug: string }) => [r.slug, r.id],
      ),
    );
    const images = new SeedImages(null, process.env.NODE_ENV ?? 'development');
    const hash = await bcrypt.hash(password, 10);
    const counts = {
      partners: 0,
      products: 0,
      variants: 0,
      coupons: 0,
      collections: 0,
      accounts: 0,
      banners: 0,
    };
    await ds.transaction(async (m) => {
      const owner = await ensurePartner(m, GROCER, hash, counts);
      const business = await ensureBusiness(m, GROCER, owner.id);
      const store = await ensureStore(m, GROCER, business, owner.id, images);
      await ensureAccounts(m, GROCER, store.id);
      for (const [
        i,
        [name, category, price, qty, unit, big],
      ] of GROCERIES.entries()) {
        const before = counts.products;
        await ensureProduct(
          m,
          GROCER,
          {
            name,
            category,
            basePrice: price,
            tags: ['grocery'],
            description: `${name} — fictional demo product.`,
            variants: big
              ? {
                  kind: 'options',
                  label1: [`${qty} ${unit}`, big[0]],
                  stock: 40,
                  deltas: [0, big[3]],
                }
              : { kind: 'single', stock: 40 },
          },
          i,
          store.id,
          owner.id,
          categories,
          new Map(),
          images,
          counts,
        );
        if (counts.products === before) continue;
        const product = await m.findOneByOrFail(Product, {
          storeId: store.id,
          name,
        });
        await m.update(
          Product,
          { id: product.id },
          { packQty: qty, packUnit: unit },
        );
        if (big) {
          const variants = await m.find(ProductVariant, {
            where: { productId: product.id },
            order: { sort: 'ASC' },
          });
          await m.update(
            ProductVariant,
            { id: variants[1].id },
            { packQty: big[1], packUnit: big[2] },
          );
        }
        created.groceryProducts++;
      }
    });
    log(
      `Grocer: ${GROCER.name}, ${created.groceryProducts} products with pack sizes`,
    );
  } else log('Grocer: skipped (set SEED_DEMO_PASSWORD)');

  // ── A demo pantry ──
  const [foodie] = await ds.query(`SELECT id FROM users WHERE email = $1`, [
    DEMO_FOODIE_EMAIL('foodie1'),
  ]);
  if (foodie) {
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM pantry_items WHERE user_id = $1`,
      [foodie.id],
    );
    if (!n) {
      const today = DateTime.fromJSDate(now, { zone: TZ });
      const items: Array<
        [string, string | null, number, string, number | null]
      > = [
        ['Palak', 'spinach', 1, 'kg', 1],
        ['Paneer', 'paneer', 400, 'g', 2],
        ['Doodh', 'milk', 1, 'l', 2],
        ['Aloo', 'potato', 2, 'kg', 15],
        ['Pyaz', 'onion', 1, 'kg', null],
        ['Anday', 'egg', 12, 'piece', 9],
        ['Chawal', 'rice', 5, 'kg', 120],
        ['Dahi', 'yogurt', 1, 'kg', 3],
      ];
      for (const [name, canonical, qty, unit, days] of items)
        await ds.query(
          `INSERT INTO pantry_items (user_id, name, canonical, qty, unit, expires_on, source)
           VALUES ($1, $2, $3, $4, $5, $6, 'manual')`,
          [
            foodie.id,
            name,
            canonical,
            qty,
            unit,
            days === null ? null : today.plus({ days }).toISODate(),
          ],
        );
      created.pantry = items.length;
      log(`Pantry: ${items.length} items for the demo customer Ayesha`);
    }
  }
  return { created };
}
