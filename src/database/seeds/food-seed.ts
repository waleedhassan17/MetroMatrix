/**
 * Food Court demo seed.
 *
 *   npm run seed:food                       (dev, ts-node)
 *   npm run seed:food:prod -- --allow-production [--placeholder-images]
 *   … -- --placeholder-images               never upload, even with keys set
 *
 * Creates six fictional, approved, live vendors in Lahore and Karachi
 * (demo.food.<key>@metromatrix.test): three restaurants, a cloud kitchen, a
 * pre-order-only home kitchen and a home kitchen with daily portions — 58
 * dishes with sizes and option groups, hours, zones, deals, riders for three
 * of them (usernames printed), six demo customers
 * (demo.foodie1…6@metromatrix.test), past orders with reviews, rider cash,
 * and three home banners. Idempotent.
 *
 * Reads SEED_DEMO_PASSWORD for every demo account (never printed). Dish and
 * cover photos are Unsplash food photos (Unsplash License; seeds/food/CREDITS.md),
 * uploaded to Cloudinary when CLOUDINARY_* are set; otherwise the Unsplash
 * URLs, for development. Logos are generated monograms. No real brand appears.
 *
 * Refuses to run with pending migrations, and refuses a production database
 * unless --allow-production is given (and, without Cloudinary keys, also
 * --placeholder-images — e.g. the local production-image rehearsal).
 */
import { AppDataSource } from '../data-source';
import { seedFood } from './food/seed-food';
import { SeedImages } from './shopping/tiles';

/* eslint-disable no-console */
async function main() {
  const args = process.argv.slice(2);
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production' && !args.includes('--allow-production')) {
    throw new Error(
      'This is a production environment. Re-run with --allow-production if you really want demo vendors here.',
    );
  }
  const password = process.env.SEED_DEMO_PASSWORD ?? '';
  if (!password)
    throw new Error(
      'Set SEED_DEMO_PASSWORD (the demo accounts’ password) first.',
    );

  const {
    CLOUDINARY_CLOUD_NAME: cloudName,
    CLOUDINARY_API_KEY: apiKey,
    CLOUDINARY_API_SECRET: apiSecret,
  } = process.env;
  const keys =
    cloudName && apiKey && apiSecret && !args.includes('--placeholder-images')
      ? { cloudName, apiKey, apiSecret }
      : null;
  if (!keys && env === 'production' && !args.includes('--placeholder-images')) {
    throw new Error(
      'No Cloudinary keys: placeholder images are for development. Add --placeholder-images to accept them.',
    );
  }
  const images = new SeedImages(keys, env);

  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) {
      throw new Error(
        'Pending migrations — run `npm run migration:run` first.',
      );
    }
    const result = await seedFood(AppDataSource, {
      password,
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
      images,
      log: (line) => console.log(line),
    });
    console.log(
      `[seed] images: ${images.mode}${keys ? ` (${images.uploaded} uploaded)` : ''}`,
    );
    console.log(`[seed] created: ${JSON.stringify(result.created)}`);
    for (const v of result.vendors)
      console.log(
        `[seed] ${v.email} → /food/vendors/${v.slug}${v.riders.length ? ` · riders: ${v.riders.join(', ')}` : ''}`,
      );
    console.log(`[seed] customers: ${result.customers.join(', ')}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', (err as Error).message);
  process.exit(1);
});
