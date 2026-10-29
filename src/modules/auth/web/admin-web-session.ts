import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { durationMs } from '../../../common/crypto/duration';
import { ErrorCode } from '../../../common/errors/codes';

export const ADMIN_REFRESH_COOKIE = 'mm_admin_rt';
/** The header a sign-in sends to get the cookie instead of a refresh token. */
export const ADMIN_WEB_CLIENT = 'admin-web';
/** Required on every cookie request: a cross-site form can't set it. */
export const ADMIN_WEB_CSRF_HEADER = 'x-requested-with';
export const ADMIN_WEB_CSRF_VALUE = 'metromatrix-admin';

/** The kind of session a refresh token belongs to. */
export type SessionClient = 'app' | 'admin_web';

/**
 * The console's cookie and its CSRF rules, in one place:
 *
 * - the refresh token is an HttpOnly, Secure, SameSite=Strict cookie scoped to
 *   /api/v1/auth/web — JavaScript never sees it, and only the two cookie
 *   endpoints ever receive it;
 * - every request that sets or uses it must carry
 *   `X-Requested-With: metromatrix-admin` and come from ADMIN_WEB_ORIGIN.
 */
@Injectable()
export class AdminWebSession {
  readonly origin: string;
  readonly refreshTtlMs: number;
  readonly idleMs: number;
  private readonly path: string;

  constructor(config: ConfigService) {
    this.origin = config.get<string>('adminWeb.origin', '');
    this.refreshTtlMs = durationMs(
      config.get<string>('adminWeb.refreshTtl', '12h'),
    );
    this.idleMs = config.get<number>('adminWeb.idleMinutes', 30) * 60_000;
    const prefix = config
      .get<string>('app.apiPrefix', 'api/v1')
      .replace(/^\/+|\/+$/g, '');
    this.path = `/${prefix}/auth/web`;
  }

  /** Did this sign-in ask for a console session (`X-Client: admin-web`)? */
  wantsCookie(req: Request): boolean {
    return req.headers['x-client'] === ADMIN_WEB_CLIENT;
  }

  /** 403 CSRF_REJECTED unless the request is from the console itself. */
  assertFromConsole(req: Request): void {
    const header = req.headers[ADMIN_WEB_CSRF_HEADER];
    const origin = req.headers.origin;
    if (
      !this.origin ||
      header !== ADMIN_WEB_CSRF_VALUE ||
      typeof origin !== 'string' ||
      origin !== this.origin
    ) {
      throw new ForbiddenException({
        code: ErrorCode.CSRF_REJECTED,
        message:
          'This request did not come from the MetroMatrix admin console.',
      });
    }
  }

  /**
   * A console sign-in result: the refresh token moves from the body into the
   * cookie, so the console's JavaScript only ever holds the access token.
   */
  handOver<T extends { tokens: { refreshToken?: string } }>(
    res: Response,
    result: T,
  ): T {
    const { refreshToken, ...rest } = result.tokens;
    if (refreshToken) this.set(res, refreshToken);
    return { ...result, tokens: rest };
  }

  read(req: Request): string | null {
    const raw = req.headers.cookie;
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === ADMIN_REFRESH_COOKIE) {
        try {
          return decodeURIComponent(part.slice(eq + 1).trim()) || null;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  set(res: Response, refreshToken: string): void {
    res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: this.path,
      maxAge: this.refreshTtlMs,
    });
  }

  clear(res: Response): void {
    res.clearCookie(ADMIN_REFRESH_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: this.path,
    });
  }
}
