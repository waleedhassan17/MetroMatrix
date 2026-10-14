# MetroMatrix API — working notes for Claude (and humans)

NestJS 10 + TypeORM 0.3 + PostgreSQL 16 backend for MetroMatrix, a zero-commission
community marketplace with three services: **Shopping**, **Healthcare**, **Food**.
Customers buy/book/order; partners (stores, doctors, kitchens) list for free.

The architecture is a deliberate copy of **FinMatrix-Backend** (reference clone:
`../_ref/FinMatrix-Backend`). When in doubt, do what FinMatrix does — unless this file
says MetroMatrix fixed it. The old FYP backend (`../_ref/MetroMatrix-Backend`) is a
*domain* reference only: never port its Mongo/Express/Firebase code.

## Layout and module anatomy

```
src/
  main.ts            import './instrument' FIRST, create app, configureApp(), listen
  instrument.ts      Sentry init (only when SENTRY_DSN is set), PII scrubbing
  app.setup.ts       configureApp(app): helmet, compression, CORS, prefix, ValidationPipe,
                     Swagger. Shared with the e2e suite — never configure the app elsewhere.
  app.module.ts      Config(Joi) → TypeORM → Throttler → Schedule → Pino → global modules
  config/            registerAs namespaces: app, database, jwt, mail, auth, integrations
                     + env.validation.ts (Joi; boot fails fast with every problem listed)
  common/            cross-cutting infra (filters, interceptors, guards, decorators,
                     audit, validation, crypto, pagination, errors/codes.ts)
  modules/<name>/    <name>.module.ts, <name>.controller.ts, <name>.service.ts,
                     dto/ (class-validator + @ApiProperty), entities/ (*.entity.ts)
  database/          data-source.ts (CLI), run-migrations.ts (Heroku release),
                     check-schema.ts, migrations/, seeds/
test/                *.e2e-spec.ts (supertest, real Postgres) + utils/
```

Every entity must be registered with `TypeOrmModule.forFeature([...])` in its module —
the app uses `autoLoadEntities`, not a glob.

## Global pipeline (order matters — AppModule providers)

1. `APP_FILTER` **AllExceptionsFilter** — every error → the error envelope.
2. `APP_INTERCEPTOR` **IdempotencyInterceptor** (outer) — replays authenticated POSTs that
   repeat an `Idempotency-Key`. Skips unauthenticated routes (their bodies carry tokens).
3. `APP_INTERCEPTOR` **ResponseEnvelopeInterceptor** — wraps success bodies.
4. `APP_GUARD` **ThrottlerGuard** — keyed by `req.ip` (`trust proxy 1`). Default 100/min;
   tighter limits with `@Throttle({ default: { limit, ttl } })`; `@SkipThrottle()` for health.
5. `APP_GUARD` **JwtAuthGuard** — every route needs a bearer token unless `@PublicRoute()`.
6. `APP_GUARD` **RolesGuard** — no-op unless `@Roles(...)`. Role comes from the DB row.

Middleware (all routes): `RequestContextMiddleware` (AsyncLocalStorage holding the live
`req`, read by `currentActor()`), then `RequestIdMiddleware` (`X-Request-Id`).

## Response envelope — the contract every client relies on

- Success: `{ "success": true, "data": <payload>, "message"?: string }`
- Error: `{ "success": false, "error": { "code": "UPPER_SNAKE", "message": string, "details"?: unknown } }`
- **Lists** return `{ items, total, page, pageSize }` (`common/pagination`). Never `data`.
- **Never return an object with a `success` key** from a handler — the interceptor passes it
  through untouched and the client gets no `data`. Return `{ reset: true }`, `{ signedOut: true }`.
- **Never return an object with a `data` key** unless that is the whole payload — every
  sibling key is silently dropped (see the warning in response-envelope.interceptor.ts).
- Test response shapes over HTTP (e2e), not only at service level.

## Errors

Throw built-in Nest exceptions with a code from `common/errors/codes.ts`:

```ts
throw new ConflictException({ code: ErrorCode.EMAIL_EXISTS, message: '…', details: { … } });
```

Only `code`, `message` and `details` survive the filter — anything else is dropped. Codes
are a client contract: add new ones, never rename or repurpose. Non-HTTP errors become a
generic 500 (`INTERNAL_ERROR`, no stack/SQL in the body), are logged and sent to Sentry.
Validation failures are `400 VALIDATION_FAILED` with `details.fields: { prop: string[] }`.

## Database and migrations (non-negotiable)

- **Every entity change ships a migration** in `src/database/migrations`. Workflow:
  1. change the entity;
  2. `npm run migration:generate -- src/database/migrations/<Name>` against a database
     that is fully migrated (`npm run migration:run` first);
  3. read the generated SQL, fix names/defaults by hand if needed;
  4. `npm run migration:run && npm run migration:check` — the check must say
     "entities and migrations agree".
- `DB_SYNCHRONIZE` is never true outside a throwaway local DB (Joi refuses it in prod).
- Heroku runs migrations in the `release` phase (`Procfile`). The e2e suite drops and
  re-migrates `metromatrix_test` on every run, so migrations are always exercised.
- Columns are snake_case via explicit `name:`; properties camelCase. Tables extend
  `BaseEntity` (uuid `id`, timestamptz `created_at`/`updated_at`). UUIDs use
  `gen_random_uuid()` (`uuidExtension: 'pgcrypto'`). Emails/slugs are `citext`.
- Put CHECK constraints and partial indexes on the entity (`@Check`, `@Index({ where })`)
  so `migration:check` keeps seeing no drift.

## Auth model (see docs/API_AUTH.md for the full contract)

- Access token: JWT `{ sub, role, sid, jti }`, `aud: 'access'`, 15 min. `sid` = the refresh
  family (one per device). JwtStrategy re-reads the user every request (role, status,
  `tokens_valid_after`) and checks the jti denylist.
- Refresh token: opaque random string, SHA-256 at rest, rotated on every use within its
  family; reuse outside the grace window revokes the family (`REFRESH_REUSED`).
- Portals: `signin-portal.ts` — password first, then portal, so a stranger never learns the
  account type. Admins always need TOTP (`aud: 'totp'` challenge token).
- `EmailVerifiedGuard` for anything that needs a proven address (partner onboarding).
- Partner routes in later chunks: `@Roles('partner')` + `@UseGuards(EmailVerifiedGuard,
  BusinessApprovedGuard)` and read the business with `@CurrentBusiness()`.

## Audit

`OperationalAuditService.record({ action, targetType, targetId, details })` — global,
best-effort (never throws), fills actor/IP/user-agent from the request context. Every admin
write and every auth event worth investigating gets one. Actions are dotted verbs:
`auth.signin`, `business.approve`, `user.disable`.

## Secrets, logging, safety

- Secrets only in env (`.env` locally, Heroku config vars). Nothing secret in code, logs,
  seeds, fixtures or Postman exports. `.env.example` lists every key with no values.
- Pino redacts authorization/cookie headers and password/OTP/token fields
  (`common/logging/pino-options.ts`). Don't log request bodies.
- **No debug routes, in any environment.** Test-only controllers are registered in the
  e2e TestingModule only (`test/utils/test-app.ts`).
- OTPs: `crypto.randomInt`, peppered SHA-256 at rest, constant-time compare.

## Testing conventions

- Unit: `src/**/*.spec.ts` (`npm test`). E2E: `test/*.e2e-spec.ts` (`npm run test:e2e`),
  real Postgres from `docker compose up -d` (host port 5433, DB `metromatrix_test`).
- Build apps with `createTestApp()`; simulate clients with `new ApiClient(t.http)` — each
  gets its own IP (X-Forwarded-For) so route throttles don't bleed between tests.
- Time-based rules (OTP expiry, refresh grace) are tested by back-dating rows with SQL, not
  by sleeping.

## Commands

```
docker compose up -d          Postgres (5433) + Mailpit (SMTP 1025, UI 8025)
npm run start:dev             watch mode
npm run migration:run         apply migrations
npm run migration:check       entities ↔ migrations drift check
npm run seed:superadmin       create/repair the super admin from SUPER_ADMIN_* env
npm run lint && npm run build && npm test && npm run test:e2e
```
