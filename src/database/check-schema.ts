/**
 * `npm run migration:check` — proves the migrations and the entities agree.
 *
 * Fails (exit 1) when a migration is pending, or when the fully-migrated
 * database still differs from what the entities describe — i.e. someone
 * changed an entity without shipping its migration.
 */
import { AppDataSource } from './data-source';

/* eslint-disable no-console */
async function main() {
  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) {
      console.error(
        '[schema] pending migrations — run `npm run migration:run` first.',
      );
      process.exitCode = 1;
      return;
    }
    const sql = await AppDataSource.driver.createSchemaBuilder().log();
    if (sql.upQueries.length === 0) {
      console.log('[schema] up to date: entities and migrations agree.');
      return;
    }
    console.error(
      `[schema] DRIFT: ${sql.upQueries.length} statement(s) needed to match the entities:`,
    );
    for (const q of sql.upQueries) console.error(`  ${q.query};`);
    process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[schema] FAILED:', err);
  process.exit(1);
});
