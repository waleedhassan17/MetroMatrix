import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * Parse DATABASE_URL (postgres://user:pass@host:port/dbname?sslmode=require)
 * into individual pieces. Heroku, Render, Railway, Neon, Supabase etc. all
 * provide connection info this way.
 */
function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432', 10),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

export default registerAs('database', (): TypeOrmModuleOptions => {
  const isProd = process.env.NODE_ENV === 'production';
  const dbUrl = process.env.DATABASE_URL;
  const parsed = dbUrl ? parseDatabaseUrl(dbUrl) : null;

  // When DATABASE_URL is present (Heroku/Neon/…) default SSL on, because
  // managed providers require it and mostly present self-signed certs.
  // "Default", not "force": opt out with DB_SSL=false or ?sslmode=disable so a
  // plain Postgres with no TLS (CI service containers) still connects.
  const sslDisabled =
    (process.env.DB_SSL ?? '').toLowerCase() === 'false' ||
    (dbUrl ?? '').includes('sslmode=disable');
  const sslFromEnv = process.env.DB_SSL === 'true';
  const useSsl = sslDisabled ? false : parsed ? true : sslFromEnv;
  const rejectUnauthorized = parsed
    ? process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
    : process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

  return {
    type: 'postgres',
    host: parsed?.host ?? process.env.DB_HOST ?? 'localhost',
    port: parsed?.port ?? parseInt(process.env.DB_PORT ?? '5433', 10),
    username: parsed?.username ?? process.env.DB_USERNAME ?? 'metromatrix',
    password: parsed?.password ?? process.env.DB_PASSWORD ?? '',
    database: parsed?.database ?? process.env.DB_NAME ?? 'metromatrix',
    // Every entity is registered through a module's TypeOrmModule.forFeature.
    // No glob: a .ts glob cannot be loaded under jest, and a module that
    // forgets forFeature should fail loudly, not work by accident.
    autoLoadEntities: true,
    // gen_random_uuid() (built into Postgres 13+) instead of uuid-ossp.
    uuidExtension: 'pgcrypto',
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
    // Migrations own the schema. Joi refuses DB_SYNCHRONIZE=true in
    // production; elsewhere it is only for a throwaway local database.
    synchronize:
      !isProd &&
      (process.env.DB_SYNCHRONIZE ?? 'false').toLowerCase() === 'true',
    logging:
      (process.env.DB_LOGGING ?? 'false').toLowerCase() === 'true'
        ? ['query', 'error', 'warn']
        : ['error', 'warn'],
    ssl: useSsl ? { rejectUnauthorized } : false,
    extra: {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      min: parseInt(process.env.DB_POOL_MIN || '2', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      query_timeout: 30000,
    },
    retryAttempts: isProd ? 10 : 3,
    retryDelay: 3000,
  };
});
