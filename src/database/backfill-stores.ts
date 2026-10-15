/**
 * Create the missing `stores` row for every shopping business approved before
 * Shopping existed. New approvals get theirs in the approval transaction, and
 * partners without one get it on first use — this just makes it explicit.
 *
 *   npm run backfill:stores          (dev)
 *   npm run backfill:stores:prod     (compiled, e.g. `heroku run`)
 *
 * Idempotent: running it twice creates nothing the second time.
 */
import { AppDataSource } from './data-source';

/* eslint-disable no-console */
async function main() {
  await AppDataSource.initialize();
  try {
    const created: Array<{ slug: string }> = await AppDataSource.query(`
      INSERT INTO stores (business_id, slug, brand_color, on_brand_color, socials, delivery_cities)
      SELECT b.id, b.slug, '#16151A', '#FFFFFF', '{}'::jsonb, '{}'::text[]
        FROM businesses b
       WHERE b.service_type = 'shopping'
         AND b.status IN ('approved', 'suspended')
         AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.business_id = b.id)
      ON CONFLICT (business_id) DO NOTHING
      RETURNING slug`);
    console.log(`[backfill] stores created: ${created.length}`);
    for (const row of created) console.log(`  - ${row.slug}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[backfill] FAILED:', (err as Error).message);
  process.exit(1);
});
