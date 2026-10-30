import { randomBytes } from 'crypto';
import { envValidationSchema } from './env.validation';

/** The always-required keys, with throwaway values generated per run. */
const BASE = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:8081',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5433/db',
  JWT_SECRET: randomBytes(32).toString('hex'),
  OTP_PEPPER: randomBytes(32).toString('hex'),
  TOTP_ENC_KEY: randomBytes(32).toString('base64'),
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate({ ...BASE, ...env }, { abortEarly: false });

describe('env validation: verification links', () => {
  const PROD = {
    NODE_ENV: 'production',
    MAIL_HOST: 'smtp-relay.brevo.com',
    MAIL_USER: 'u',
    MAIL_PASS: 'p',
    MAIL_FROM: 'MetroMatrix <no-reply@metromatrix.pk>',
    GOOGLE_CLIENT_IDS: 'x.apps.googleusercontent.com',
    CLOUDINARY_CLOUD_NAME: 'c',
    CLOUDINARY_API_KEY: 'k',
    CLOUDINARY_API_SECRET: 's',
  };
  const paths = (env: Record<string, string>) =>
    (validate(env).error?.details ?? []).map((d) => d.path[0]);

  it('production needs an https APP_URL; elsewhere http is fine', () => {
    expect(paths({ ...PROD, APP_URL: 'http://api.metromatrix.pk' })).toContain(
      'APP_URL',
    );
    expect(
      paths({ ...PROD, APP_URL: 'https://api.metromatrix.pk' }),
    ).not.toContain('APP_URL');
    expect(
      validate({ APP_URL: 'http://localhost:3000' }).error,
    ).toBeUndefined();
  });

  it('production refuses a "*" CORS origin, alone or in a list; elsewhere it is allowed', () => {
    const prod = { ...PROD, APP_URL: 'https://api.metromatrix.pk' };
    expect(paths({ ...prod, CORS_ORIGINS: '*' })).toContain('CORS_ORIGINS');
    expect(
      paths({ ...prod, CORS_ORIGINS: 'https://metromatrix.pk, *' }),
    ).toContain('CORS_ORIGINS');
    expect(
      paths({
        ...prod,
        CORS_ORIGINS: 'https://metromatrix.pk,https://admin.metromatrix.pk',
      }),
    ).not.toContain('CORS_ORIGINS');
    expect(validate({ CORS_ORIGINS: '*' }).error).toBeUndefined();
  });

  it('SUPPORT_EMAIL is optional, but must be an address when given', () => {
    expect(validate({}).error).toBeUndefined();
    expect(validate({ SUPPORT_EMAIL: '' }).error).toBeUndefined();
    expect(
      validate({ SUPPORT_EMAIL: 'help@metromatrix.pk' }).error,
    ).toBeUndefined();
    expect(paths({ SUPPORT_EMAIL: 'not-an-address' })).toContain(
      'SUPPORT_EMAIL',
    );
  });

  it('defaults the app scheme and the link lifetime, and bounds them', () => {
    expect(validate({}).value).toMatchObject({
      APP_SCHEME: 'metromatrix',
      EMAIL_VERIFY_TTL_HOURS: 24,
    });
    expect(paths({ APP_SCHEME: 'Metro Matrix://' })).toContain('APP_SCHEME');
    expect(paths({ EMAIL_VERIFY_TTL_HOURS: '0' })).toContain(
      'EMAIL_VERIFY_TTL_HOURS',
    );
  });
});

describe('env validation: healthcare video and symptom checker', () => {
  it('defaults to public Jitsi and the default Gemini model, no keys needed', () => {
    const { error, value } = validate({ NODE_ENV: 'test' });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      VIDEO_PROVIDER: 'public_jitsi',
      GEMINI_MODEL: 'gemini-2.5-flash',
    });
  });

  it('JaaS needs all three keys, and the key id must belong to the app id', () => {
    const missing = validate({ NODE_ENV: 'test', VIDEO_PROVIDER: 'jaas' });
    expect(missing.error?.details.map((d) => d.path[0]).sort()).toEqual([
      'JAAS_APP_ID',
      'JAAS_KID',
      'JAAS_PRIVATE_KEY',
    ]);
    const ok = validate({
      NODE_ENV: 'test',
      VIDEO_PROVIDER: 'jaas',
      JAAS_APP_ID: 'vpaas-magic-cookie-abc',
      JAAS_KID: 'vpaas-magic-cookie-abc/k1',
      JAAS_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----',
    });
    expect(ok.error).toBeUndefined();
    expect(
      validate({ NODE_ENV: 'test', VIDEO_PROVIDER: 'zoom' }).error,
    ).toBeDefined();
  });
});
