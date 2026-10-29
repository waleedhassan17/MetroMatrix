import { registerAs } from '@nestjs/config';

/**
 * The web console's sessions (docs/ADMIN_API.md). Its refresh token lives in
 * an HttpOnly cookie, never in JavaScript; these bound how long it lasts.
 */
export default registerAs('adminWeb', () => ({
  /** The console's exact origin. Unset: the cookie endpoints refuse all. */
  origin: (process.env.ADMIN_WEB_ORIGIN ?? '').replace(/\/+$/, ''),
  /** Longest a console session lives, refreshes included. */
  refreshTtl: process.env.ADMIN_REFRESH_TTL || '12h',
  /** No refresh for this long ends the session. */
  idleMinutes: parseInt(process.env.ADMIN_IDLE_MINUTES ?? '30', 10),
  /** Access tokens of admin and super_admin accounts (app and console). */
  accessExpiresIn: process.env.ADMIN_ACCESS_EXPIRES_IN || '10m',
}));
