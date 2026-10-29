/**
 * `npm run openapi:export` — writes openapi.json at the repo root (committed).
 * The web console runs `npm run gen:api` against it for its types.
 *
 * The app is created in preview mode: controllers and their Swagger metadata
 * are read, but no provider runs, so nothing connects to a database or any
 * service. The environment is a fixed set of dummies (a developer's .env is
 * ignored), so the output depends on the code only.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

/* eslint-disable no-console */
const DUMMY_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:8081',
  DB_HOST: 'localhost',
  DB_USERNAME: 'openapi',
  DB_PASSWORD: 'openapi-export-only',
  DB_NAME: 'openapi_export_test',
  JWT_SECRET: 'openapi-export-only-jwt-secret-0123456789abcdef',
  OTP_PEPPER: 'openapi-export-only-otp-pepper-0123456789abcdef',
  TOTP_ENC_KEY: Buffer.alloc(32, 1).toString('base64'),
  SWAGGER_ENABLED: 'false',
  JOBS_ENABLED: 'false',
  LOG_LEVEL: 'silent',
};

async function main() {
  for (const [k, v] of Object.entries(DUMMY_ENV)) process.env[k] = v;
  // Imported only now: ConfigModule validates the environment on import.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { buildOpenApi, sortKeys } = await import('../common/swagger/openapi');
  const { appVersion } = await import('../common/utils/app-version');

  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  const doc = sortKeys(
    buildOpenApi(app, { version: appVersion(), serverUrl: '/' }),
  );
  const out = join(__dirname, '..', '..', 'openapi.json');
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  const ops = Object.values(doc.paths).reduce(
    (n, p) => n + Object.keys(p).length,
    0,
  );
  console.log(`[openapi] ${ops} operations → ${out}`);
  await app.close();
}

main().catch((err) => {
  console.error('[openapi] FAILED:', err);
  process.exit(1);
});
