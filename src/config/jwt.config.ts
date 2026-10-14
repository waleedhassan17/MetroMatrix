import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET ?? '',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  /** Lifetime of each opaque refresh token; every rotation starts it again. */
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  /**
   * A refresh token already rotated away may be presented again within this
   * many seconds without counting as theft — two tabs, or a phone and its
   * widget, refreshing at the same moment.
   */
  refreshReuseGraceSeconds: parseInt(
    process.env.REFRESH_REUSE_GRACE_SECONDS ?? '10',
    10,
  ),
  /** Admin sign-in step 1 → step 2 (TOTP) window. */
  challengeExpiresIn: '5m',
}));
