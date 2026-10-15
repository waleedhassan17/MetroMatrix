/**
 * Shopping demo seed.
 *
 *   npm run seed:shopping                     (dev, ts-node)
 *   npm run seed:shopping:prod -- --allow-production [--placeholder-images]
 *   … -- --placeholder-images                 never upload, even with keys set
 *
 * Creates four approved demo store partners (demo.<fashion|beauty|home|
 * handmade>@metromatrix.test) with products, variants, collections, coupons,
 * payment accounts and three home banners. Idempotent.
 *
 * Reads SEED_DEMO_PASSWORD for the demo accounts (never printed). Images are
 * generated tiles uploaded to Cloudinary when CLOUDINARY_* are set; otherwise
 * placehold.co URLs, which are for local development only.
 *
 * Refuses to run with pending migrations, and refuses a production database
 * unless --allow-production is given (and, without Cloudinary keys, also
 * --placeholder-images — e.g. the local production-image rehearsal).
 */
import { AppDataSource } from '../data-source';
import { seedShopping } from './shopping/seed-shopping';
import { SeedImages } from './shopping/tiles';

/* eslint-disable no-console */
async function main() {
  const args = process.argv.slice(2);
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production' && !args.includes('--allow-production')) {
    throw new Error(
      'This is a production environment. Re-run with --allow-production if you really want demo stores here.',
    );
  }
  const password = process.env.SEED_DEMO_PASSWORD ?? '';
  if (!password)
    throw new Error(
      'Set SEED_DEMO_PASSWORD (the demo partners’ password) first.',
    );

  const {
    CLOUDINARY_CLOUD_NAME: cloudName,
    CLOUDINARY_API_KEY: apiKey,
    CLOUDINARY_API_SECRET: apiSecret,
  } = process.env;
  // --placeholder-images forces placeholders even when keys are set.
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
    const result = await seedShopping(AppDataSource, {
      password,
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
      images,
      log: (line) => console.log(line),
    });
    console.log(
      `[seed] images: ${images.mode}${keys ? ` (${images.uploaded} uploaded, ${images.photos} real photos)` : ''}`,
    );
    console.log(`[seed] created: ${JSON.stringify(result.created)}`);
    for (const s of result.stores)
      console.log(`[seed] partner ${s.email} → /shop/stores/${s.slug}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', (err as Error).message);
  process.exit(1);
});
