/**
 * P7 hardening checks that don't need a database: the throttle table from the
 * Chunk 1 spec, log redaction, and the generic 500.
 */
import 'reflect-metadata';
import { ArgumentsHost } from '@nestjs/common';
import pino from 'pino';
import { Writable } from 'stream';
import * as Sentry from '@sentry/nestjs';
import { AuthController } from './modules/auth/auth.controller';
import { HealthController } from './modules/health/health.controller';
import { buildLoggerParams, REDACT_PATHS } from './common/logging/pino-options';
import {
  AllExceptionsFilter,
  GENERIC_ERROR_MESSAGE,
} from './common/filters/all-exceptions.filter';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual('@sentry/nestjs'),
  captureException: jest.fn(),
  withScope: (fn: (scope: unknown) => void) =>
    fn({ setTag: jest.fn(), setContext: jest.fn(), setUser: jest.fn() }),
}));

const MINUTE = 60_000;

describe('throttles match the Chunk 1 spec', () => {
  const throttleOf = (handler: (...a: never[]) => unknown) => ({
    limit: Reflect.getMetadata('THROTTLER:LIMITdefault', handler),
    ttl: Reflect.getMetadata('THROTTLER:TTLdefault', handler),
  });
  const p = AuthController.prototype;

  it.each([
    ['POST /auth/signup — 20/h/IP', p.signup, 20, 60 * MINUTE],
    ['POST /auth/signin — 5/min', p.signin, 5, MINUTE],
    ['POST /auth/admin/totp — 5/min', p.adminTotp, 5, MINUTE],
    ['POST /auth/google — 10/min', p.googleSignin, 10, MINUTE],
    [
      'POST /auth/resend-verification — 5/h',
      p.resendVerification,
      5,
      60 * MINUTE,
    ],
    ['POST /auth/forgot-password — 3/15min', p.forgotPassword, 3, 15 * MINUTE],
  ])('%s', (_name, handler, limit, ttl) => {
    expect(throttleOf(handler as never)).toEqual({ limit, ttl });
  });

  it('GET /health is never throttled', () => {
    expect(
      Reflect.getMetadata(
        'THROTTLER:SKIPdefault',
        HealthController.prototype.check,
      ),
    ).toBe(true);
  });
});

describe('log redaction', () => {
  it('censors credentials, tokens and codes but keeps diagnostic error codes', () => {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const params = buildLoggerParams({ level: 'info', pretty: false });
    const redact = (params.pinoHttp as { redact: pino.LoggerOptions['redact'] })
      .redact;
    const logger = pino({ redact }, sink);

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer SECRET-ACCESS',
          cookie: 'sid=SECRET-COOKIE',
        },
        body: {
          password: 'SECRET-PW',
          otp: '111222',
          code: '333444',
          idToken: 'SECRET-ID',
        },
      },
      password: 'SECRET-PW2',
      dto: {
        refreshToken: 'SECRET-REFRESH',
        resetToken: 'SECRET-RESET',
        currentPassword: 'SECRET-CUR',
        newPassword: 'SECRET-NEW',
        challengeToken: 'SECRET-CHALLENGE',
        recoveryCode: 'SECRET-RECOVERY',
      },
      err: { code: '23505' },
    });

    expect(out).not.toMatch(/SECRET|111222|333444/);
    expect(out).toContain('[Redacted]');
    expect(out).toContain('23505');
    for (const key of [
      'authorization',
      'cookie',
      'password',
      'otp',
      'refreshToken',
      'idToken',
      'resetToken',
    ]) {
      expect(REDACT_PATHS.some((p) => p.endsWith(key))).toBe(true);
    }
  });
});

describe('AllExceptionsFilter on an unexpected error', () => {
  it('answers a generic 500 — no stack, no SQL — and reports to Sentry', () => {
    const capture = Sentry.captureException as jest.Mock;
    let status = 0;
    let body: any;
    const res = {
      status: (s: number) => {
        status = s;
        return res;
      },
      json: (b: unknown) => {
        body = b;
      },
    };
    const req = { method: 'GET', path: '/x', headers: {}, user: { id: 'u1' } };
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    } as unknown as ArgumentsHost;

    const filter = new AllExceptionsFilter();
    jest
      .spyOn((filter as any).logger, 'error')
      .mockImplementation(() => undefined);
    filter.catch(
      new Error(
        'duplicate key value violates unique constraint "users_email" — SELECT * FROM users',
      ),
      host,
    );

    expect(status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: GENERIC_ERROR_MESSAGE },
    });
    expect(JSON.stringify(body)).not.toMatch(/SELECT|constraint|at /);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
