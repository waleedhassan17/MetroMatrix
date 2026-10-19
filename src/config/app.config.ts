import { registerAs } from '@nestjs/config';

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  storefrontBaseUrl: (
    process.env.STOREFRONT_BASE_URL || 'http://localhost:8081'
  ).replace(/\/+$/, ''),
  corsOrigins: list(process.env.CORS_ORIGINS),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  throttleTtlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  swaggerEnabled: (process.env.SWAGGER_ENABLED || 'true') === 'true',
}));
