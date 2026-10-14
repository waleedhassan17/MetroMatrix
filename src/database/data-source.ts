import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config as loadEnv } from 'dotenv';

// Never overrides variables already set (Heroku config vars, the e2e suite).
loadEnv();

/**
 * Standalone DataSource used by the TypeORM CLI for generating/running
 * migrations, by the release-phase runner and by the seed. Keep it aligned
 * with config/database.config.ts.
 *
 * Supports DATABASE_URL (Heroku, Neon, Render, …) OR discrete DB_* variables.
 */

/**
 * SSL policy for a DATABASE_URL connection: on by default (managed providers
 * require it and mostly present self-signed certificates), off with
 * DB_SSL=false or ?sslmode=disable so a plain Postgres with no TLS — CI
 * service containers, local Docker — still connects.
 */
function sslForUrl(url: string): false | { rejectUnauthorized: boolean } {
  if ((process.env.DB_SSL ?? '').toLowerCase() === 'false') return false;
  try {
    const sslmode = new URL(url).searchParams.get('sslmode');
    if (sslmode === 'disable') return false;
  } catch {
    // Not parseable as a URL — fall through to the secure default.
  }
  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
  };
}

function buildOptions(): DataSourceOptions {
  const dbUrl = process.env.DATABASE_URL;
  const isCompiled = __filename.endsWith('.js');
  const entities = isCompiled
    ? ['dist/**/*.entity.js']
    : ['src/**/*.entity.ts'];
  const migrations = isCompiled
    ? ['dist/database/migrations/*.js']
    : ['src/database/migrations/*.ts'];
  const common = {
    type: 'postgres' as const,
    entities,
    migrations,
    synchronize: false,
    logging: false,
    uuidExtension: 'pgcrypto' as const,
  };

  if (dbUrl) {
    return { ...common, url: dbUrl, ssl: sslForUrl(dbUrl) };
  }

  return {
    ...common,
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    username: process.env.DB_USERNAME ?? 'metromatrix',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'metromatrix',
    ssl:
      process.env.DB_SSL === 'true'
        ? {
            rejectUnauthorized:
              process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
          }
        : false,
  };
}

export const AppDataSource = new DataSource(buildOptions());
