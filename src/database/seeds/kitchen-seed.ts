/**
 * Kitchen Intelligence demo seed (Chunk 5) — run after seed:food.
 *
 *   npm run seed:kitchen                     (dev, ts-node)
 *   npm run seed:kitchen:prod -- --allow-production
 *
 * For three of seed:food's fictional vendors (Zafran Biryani Kitchen,
 * Qandeel Karahi House, Khala Rukhsana's Kitchen): ingredients, recipe cards
 * for every dish, 60 days of orders, 8 weeks of purchases, waste, a stock
 * take, a sample of the PBS weekly SPI for Lahore and Karachi, price-watch
 * mappings, forecasts, prep stats and tonight's Bachat Box. Part 2 (5B):
 * the Ramadan/Eid calendar and Zafran's windows, a tiffin plan with
 * subscribers, a quoted dawat request, kitchen stories, a signature dish,
 * QR/storefront attribution, anonymous demand data and an experiment. Part 3
 * (5C): nutrition mappings and per-dish values, a fictional demo grocer with
 * pack sizes (needs SEED_DEMO_PASSWORD; placeholder images) and a demo
 * pantry. Idempotent.
 *
 * It boots the API's own application context, so stock, costing and
 * forecasts are written by the same services as the API. Jobs and real AI
 * are off while it runs; nothing is uploaded and no model is called.
 * Refuses to run with pending migrations, and refuses a production database
 * unless --allow-production is given.
 */
process.env.JOBS_ENABLED = 'false';
process.env.AI_ENABLED = 'false';
process.env.PUSH_ENABLED = 'false';

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { seedKitchen } from './kitchen/seed-kitchen';
import { seedGrowth } from './kitchen/seed-growth';
import { seedMyKitchen } from './kitchen/seed-my-kitchen';

/* eslint-disable no-console */
async function main() {
  const args = process.argv.slice(2);
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production' && !args.includes('--allow-production'))
    throw new Error(
      'This is a production environment. Re-run with --allow-production if you really want demo kitchens here.',
    );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    if (await app.get(DataSource).showMigrations())
      throw new Error(
        'Pending migrations — run `npm run migration:run` first.',
      );
    const result = await seedKitchen(app, {
      log: (line) => console.log(`[seed] ${line}`),
    });
    console.log(`[seed] created: ${JSON.stringify(result.created)}`);
    for (const v of result.vendors)
      console.log(`[seed] ${v.name}${v.skipped ? ' (already seeded)' : ''}`);
    const growth = await seedGrowth(app, {
      log: (line) => console.log(`[seed] ${line}`),
    });
    console.log(`[seed] growth: ${JSON.stringify(growth.created)}`);
    const mine = await seedMyKitchen(app, {
      log: (line) => console.log(`[seed] ${line}`),
    });
    console.log(`[seed] my kitchen: ${JSON.stringify(mine.created)}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', (err as Error).message);
  process.exit(1);
});
