import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import type { Params } from 'nestjs-pino';

/**
 * Values that must never reach a log line, wherever they appear. Pino's `*`
 * matches one level, so request bodies (`req.body.x`), error details and
 * service-level objects (`{ password }`) are all covered by the `*.x` form.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...[
    'password',
    'currentPassword',
    'newPassword',
    'otp',
    'recoveryCode',
    'refreshToken',
    'accessToken',
    'idToken',
    'resetToken',
    'challengeToken',
    'totpCode',
    'currentCode',
    'temporaryPassword',
    'recoveryCodes',
    'secret',
  ].flatMap((k) => [k, `*.${k}`, `req.body.${k}`]),
  // A TOTP code travels as `code`; only the request body form is redacted, so
  // error codes (Postgres `23505`, `ECONNREFUSED`) stay readable in logs.
  'req.body.code',
  // The email link's token arrives in the query (GET /auth/verify?token=…).
  'req.query.token',
];

/** Query parameters whose values never reach a log line, in the request URL. */
const SECRET_QUERY_PARAMS = /([?&](?:token|resetToken|refreshToken)=)[^&#]*/gi;

/** `/api/v1/auth/verify?token=abc` → `/api/v1/auth/verify?token=[Redacted]`. */
export function redactUrl(url: unknown): unknown {
  return typeof url === 'string'
    ? url.replace(SECRET_QUERY_PARAMS, '$1[Redacted]')
    : url;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function buildLoggerParams(opts: {
  level: string;
  pretty: boolean;
}): Params {
  return {
    pinoHttp: {
      level: opts.level,
      transport: opts.pretty
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname,req.headers,res.headers',
            },
          }
        : undefined,
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
      // pino-http hands this the standard serialized request ({ url, query, … });
      // the path-based redaction above can't reach inside the URL string.
      serializers: {
        req: (req: { url?: unknown }) => {
          req.url = redactUrl(req.url);
          return req;
        },
      },
      // One id per request, shared with the X-Request-Id response header
      // (RequestIdMiddleware reuses what is set here).
      genReqId: (req: IncomingMessage) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
            ? incoming
            : randomUUID();
        req.headers['x-request-id'] = id;
        return id;
      },
      autoLogging: {
        // Uptime probes would otherwise drown the log.
        ignore: (req: IncomingMessage) => (req.url ?? '').endsWith('/health'),
      },
    },
  };
}
