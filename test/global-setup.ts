import { execSync } from 'child_process';
import { join } from 'path';
import { Client } from 'pg';
import { applyTestEnv } from './setup-env';

/**
 * Before the e2e run: wipe the test database and build it with the real
 * migrations (never synchronize), so every run proves the migrations work
 * from an empty database.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  const database = process.env.DB_NAME ?? '';
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to reset "${database}": the e2e database name must end in _test.`,
    );
  }

  const connection = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  };

  // docker/initdb creates the test database only on a volume's FIRST boot; an
  // older volume won't have it. Create it on demand rather than failing.
  const admin = new Client({ ...connection, database: 'postgres' });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    if (!rowCount) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }

  const client = new Client({ ...connection, database });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  execSync(
    'npx typeorm-ts-node-commonjs -d src/database/data-source.ts migration:run',
    { cwd: join(__dirname, '..'), env: process.env, stdio: 'pipe' },
  );
}
