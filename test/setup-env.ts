/**
 * The e2e environment. Runs before every test file (jest `setupFiles`) and in
 * global setup, so AppModule's env validation sees a complete, deterministic
 * configuration. A developer's .env is ignored when NODE_ENV=test.
 *
 * Every value here is a dummy: nothing secret, nothing that reaches a real
 * service. `??=` lets CI point at a different database.
 */
export function applyTestEnv(): void {
  const env = process.env;
  env.NODE_ENV = 'test';
  env.APP_URL ??= 'http://localhost:3000';
  env.CORS_ORIGINS ??= 'http://localhost:8081';
  env.DB_HOST ??= 'localhost';
  env.DB_PORT ??= '5433';
  env.DB_USERNAME ??= 'metromatrix';
  env.DB_PASSWORD ??= 'metromatrix_local_pw';
  // Must end in _test: global setup drops and re-migrates this database.
  env.DB_NAME ??= 'metromatrix_test';
  env.DB_SSL ??= 'false';
  env.DB_SYNCHRONIZE = 'false';
  env.DB_MIGRATIONS_RUN = 'false';
  env.JWT_SECRET ??= 'test-only-jwt-secret-0123456789abcdefghijklmnop';
  env.OTP_PEPPER ??= 'test-only-otp-pepper-0123456789abcdefghijklmnop';
  env.TOTP_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
  env.BCRYPT_ROUNDS ??= '4';
  env.MAIL_HOST = '';
  env.GOOGLE_CLIENT_IDS ??=
    'test-web.apps.googleusercontent.com,test-android.apps.googleusercontent.com';
  env.CLOUDINARY_CLOUD_NAME ??= 'metromatrix-test';
  env.CLOUDINARY_API_KEY ??= '123456789012345';
  env.CLOUDINARY_API_SECRET ??= 'test-only-cloudinary-secret';
  env.SENTRY_DSN = '';
  // Tests replace ExpoPushClient; nothing ever reaches Expo from a test run.
  env.PUSH_ENABLED = 'false';
  // Tests run job methods directly; no cron tick may race them.
  env.JOBS_ENABLED = 'false';
  env.SWAGGER_ENABLED ??= 'false';
  env.LOG_LEVEL ??= 'silent';
  // Route-level @Throttle limits still apply; only the 100/min default is
  // lifted so a suite's many requests from one address are not throttled.
  env.THROTTLE_LIMIT ??= '100000';
}

applyTestEnv();
