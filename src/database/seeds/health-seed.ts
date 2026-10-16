/**
 * Healthcare demo seed.
 *
 *   npm run seed:health                       (dev, ts-node)
 *   npm run seed:health:prod -- --allow-production [--placeholder-images]
 *   … -- --placeholder-images                 never upload, even with keys set
 *
 * Creates 30 fictional, approved, listed doctors (demo.dr01…dr30@metromatrix.test;
 * PMDC numbers DEMO-…) across 12 specialties in Lahore, Karachi and Islamabad,
 * eight demo patients (demo.patient1…8@metromatrix.test), past completed visits
 * and 0–40 reviews per doctor. Idempotent.
 *
 * Reads SEED_DEMO_PASSWORD for the demo accounts (never printed). Each demo
 * doctor gets a licensed stock portrait and the Health home five banners
 * (Unsplash License; seeds/health/CREDITS.md), uploaded to Cloudinary when
 * CLOUDINARY_* are set; otherwise the Unsplash URLs, for development only.
 * Every demo profile says the doctor is fictional.
 *
 * Refuses to run with pending migrations, and refuses a production database
 * unless --allow-production is given (and, without Cloudinary keys, also
 * --placeholder-images — e.g. the local production-image rehearsal).
 */
import { AppDataSource } from '../data-source';
import { seedHealth } from './health/seed-health';
import { SeedImages } from './shopping/tiles';

/* eslint-disable no-console */
async function main() {
  const args = process.argv.slice(2);
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production' && !args.includes('--allow-production')) {
    throw new Error(
      'This is a production environment. Re-run with --allow-production if you really want demo doctors here.',
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
    const result = await seedHealth(AppDataSource, {
      password,
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
      images,
      log: (line) => console.log(line),
    });
    console.log(
      `[seed] images: ${images.mode}${keys ? ` (${images.uploaded} uploaded)` : ''}`,
    );
    console.log(`[seed] created: ${JSON.stringify(result.created)}`);
    console.log(
      `[seed] doctors: ${result.doctors.length} (demo.dr01…@metromatrix.test), patients: ${result.patients.join(', ')}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', (err as Error).message);
  process.exit(1);
});
