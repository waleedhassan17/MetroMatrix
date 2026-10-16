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
