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

- Access token: JWT `{ sub, role, sid, ver, jti }`, `aud: 'access'`, 15 min. `sid` = the refresh
  family (one per device). JwtStrategy re-reads the user every request (role, status,
  `token_version` vs `ver`) and checks the jti denylist. Bumping `users.token_version`
  (reset, disable, delete) kills every outstanding access token at once.
- Refresh token: opaque random string, SHA-256 at rest, rotated on every use within its
  family; reuse outside the grace window revokes the family (`REFRESH_REUSED`).
- Portals: `signin-portal.ts` — password first, then portal, so a stranger never learns the
  account type. Admins always need TOTP (`aud: 'totp'` challenge token).
- `EmailVerifiedGuard` for anything that needs a proven address (partner onboarding).
- Partner routes in later chunks: `@Roles('partner')` + `@UseGuards(BusinessApprovedGuard)`
  (it also asserts the email is verified) and read the business with `@CurrentBusiness()`.
  Import `BusinessesModule` (it exports the guard). 403 `BUSINESS_NOT_APPROVED` /
  `BUSINESS_SUSPENDED` take effect on the next request.
- Admin TOTP: sign-in on the admin portal returns a 5-min challenge (`aud: 'totp'`), never
  tokens. `/auth/admin/totp` completes it; `/admin/me/totp/*` (AdminTotpEnrolGuard) enrols
  the first authenticator with the challenge, or rotates with an access token + current code.

## Businesses

- `businesses/required-documents.ts` is the ONLY place document rules live; the API, the
  e2e suite and docs/API_AUTH.md all derive from it.
- Status changes go through `BusinessesService.transition()` only — it checks
  `business-status.ts` and does a conditional `UPDATE … WHERE status = :from`.
- Uploaded files never pass through the API: `/media/sign-upload` signs a Cloudinary
  direct upload into `metromatrix/{env}/{userId}/{purpose}`, and `MediaService.assertOwnedAsset`
  refuses any URL outside that folder.

## Lists

`common/pagination/pagination.ts`: extend `PaginationQueryDto` (`page`, `pageSize` ≤ 100),
return `paged(items, total, q)` → `{ items, total, page, pageSize }`. In query builders with
joins + skip/take, `orderBy` must use entity paths (`b.createdAt`), not column names.

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
  real Postgres from `docker compose up -d --wait` (127.0.0.1:5433, DB `metromatrix_test`,
  created by global setup if missing).
- Build apps with `createTestApp()`; simulate clients with `new ApiClient(t.http)` — each
  gets its own IP (X-Forwarded-For) so route throttles don't bleed between tests.
- Time-based rules (OTP expiry, refresh grace) are tested by back-dating rows with SQL, not
  by sleeping.
- Emails land in the in-memory outbox (`test/utils/outbox.ts`: `lastOtpFor(email)`); Google
  is faked (`test/utils/fake-google.ts`); admins come from `test/utils/admin.ts`
  (`enrolledAdmin(t)` computes real TOTP codes with otplib).
- `test/qa-matrix.e2e-spec.ts` is the release gate: one test per QA row. Add rows, never
  delete them.

## Shopping (Chunk 2)

- `src/modules/shopping/` is split by sub-domain (catalog, stores, products, inventory, cart,
  wishlist, checkout, orders, returns, reviews, reports, coupons, insights, admin); one
  `shopping.module.ts` wires them. Core `addresses/` and `notifications/` are shared.
- **No money is held.** Customers pay stores directly (COD or transfer to the store's own
  account). Never add a wallet, payout, commission or fee. Money is integer rupees.
- Partner routes: `@ShoppingPartner()` (partner + approved + `ServiceTypeGuard('shopping')` +
  `PartnerStoreGuard`) and `@CurrentStore()`. Every partner service takes `storeId` first and
  scopes every query by it — another store's row is **404**, never 403.
  Customer routes: `@ShoppingCustomer()` (customer + verified email).
- Visibility is one rule (`common/catalog-sql.ts`): business approved, store not paused,
  product `active`. Use `VISIBLE_PRODUCT_SQL` / `PRODUCT_FROM_SQL`, never a hand-rolled copy.
- Stock changes only through `InventoryService.apply()` (locks `FOR UPDATE` in id order,
  writes a movement with `balance_after`). Order and payment status only through
  `OrderTransitionsService` (state machines in `orders/order-status.ts`,
  `orders/payment-status.ts`); returns through `returns/return-status.ts`.
- Money maths only in `checkout/pricing.ts`; validation + pricing only in `CheckoutPlanner`
  (preview and checkout both call it). Checkout is one transaction; notify after commit.
- Jobs (`orders/order-jobs.service.ts`) are advisory-locked and idempotent; `JOBS_ENABLED=false`
  in tests, which call the job methods directly.
- `test/qa-matrix-shopping.e2e-spec.ts` is Chunk 2's release gate (24 rows).

## Healthcare (Chunk 3)

- `src/modules/healthcare/` — not `health/`, which is the liveness check. It is split by
  sub-domain (reference, doctors, practice, availability, discovery, family, appointments,
  consultation, prescriptions, records, reviews, insights, video, symptom-checker, admin,
  jobs), and one `healthcare.module.ts` wires them.
- Routes:

  | Who | Prefix | Decorators |
  |---|---|---|
  | Patient | `/health/...` | `@HealthPatient()` (customer + verified email) |
  | Doctor | `/health/doctor/...` | `@HealthDoctor()` (partner + approved + `ServiceTypeGuard('healthcare')` + `DoctorGuard`) and `@CurrentDoctor()` |
  | Admin | `/admin/health/...` | |

  Scope every doctor query by `doctorId`: another doctor's row is **404**.
- **No money is held.** Patients pay at the clinic or transfer to the doctor's own account
  (`doctor_payment_accounts`). Fees are integer rupees, always taken from the location.
- Time: `src/common/time/time.util.ts` (luxon; `healthcare/common/time.util.ts` re-exports it) is the only code that converts between wall time and
  instants. Responses carry the location's offset (`toZonedIso`). Jest runs with `TZ=UTC`.
- Availability is **computed**, never stored: `availability/slot-engine.ts` plus
  `AvailabilityService`. The 30 s cache is only an optimisation.
- Double booking is impossible because of the `EX_appointments_doctor_time` exclusion
  constraint (`23P01` → `SLOT_TAKEN`). Never write `ON CONFLICT DO NOTHING` without a
  target: it also swallows the exclusion violation.
- Visibility is one rule: `LISTED_DOCTOR_SQL` (`discovery/listing-sql.ts`).
- The home (`DiscoveryService.home`) picks its city (asked, else the patient's default
  address city, else the busiest), and serves only live banners (`health_banners`, staff
  CRUD at `/admin/health/banners`) whose target still exists, scoped to that city.
- A doctor's business detail carries `isListed`/`pmdcVerified` through the
  `BusinessesService.onView` hook (set by `DoctorsService`).
- Appointment and payment status change only through `AppointmentTransitionsService`
  (`appointment-status.ts`, `payment-status.ts`).
- PHI:
  - A doctor reaches a person only through an appointment between them. The person key is
    `family_member_id ?? patient_user_id`.
  - Prescriptions: the patient and the prescribing doctor only.
  - Records: only while attached to that doctor's appointment.
  - Every doctor read calls `ConsultationService.phiRead` (`phi.read` audit).
  - PHI uploads (`health_record`, `medical_note`) are Cloudinary `authenticated` assets.
    Anyone but the uploader gets `MediaService.privateDownload` links, never stored URLs.
- Sub-domains connect through mutable hook fields set in `onModuleInit`, which avoids
  circular DI:
  - `HealthEvents`;
  - `discovery.reviewSummary`;
  - `views.reviewed` / `views.attachments`;
  - `consultation.sharedRecords`;
  - `appointments.attachRecords` / `appointments.carryRecords`;
  - `insights.ratingTrend`;
  - `jobs.nightly[]`.
- Aggregates (`reviews/doctor-aggregates.service.ts`) are a full recompute that writes only
  changed rows. Wait and consult times are shown from 5 samples.
- Symptom checker:
  - red flags first, with no model call;
  - the model is optional (`SymptomModel`, Gemini, validated with class-validator);
  - keyword fallback;
  - 10 per user per hour, counted in `symptom_checks`;
  - free text erased after 30 days.
- Video: `VideoProvider` (`public_jitsi` | `jaas`); see `docs/VIDEO.md`.
- Jobs (`jobs/health-jobs.service.ts`) are advisory-locked and idempotent. Tests call them
  directly with a fixed `now`.
- `test/qa-matrix-health.e2e-spec.ts` is Chunk 3's release gate (27 rows). Helpers live in
  `test/utils/health.ts`. `test/health-home.e2e-spec.ts` covers the home, banners and the
  app additions (`docs/API_HEALTH.md` §10).
- Demo doctors wear licensed stock portraits (`seeds/health/doctors-data.ts`
  `DEMO_PORTRAITS`, credits in `seeds/health/CREDITS.md`); every demo profile says it is
  fictional. Demo and dev data only.

## Food Court (Chunk 4)

- `src/modules/food/` is split by sub-domain (reference, vendor, menu, availability, discovery,
  cart, promotions, checkout, orders, riders, realtime, reviews, insights, plans, admin, jobs,
  favourites, common); one `food.module.ts` wires them. Plans are top-level in
  `src/modules/plans` (`plan-config.ts` is the single source of truth, FinMatrix shape).
- Routes:

  | Who | Prefix | Decorators |
  |---|---|---|
  | Customer | `/food/...` | `@FoodCustomer()` (customer + verified email); discovery is `@OptionalAuth()` |
  | Vendor | `/food/vendor/...` | `@FoodVendor()` (partner + approved + `ServiceTypeGuard('food')` + `VendorGuard`) and `@CurrentVendor()` |
  | Rider | `/food/rider/...` | `@FoodRider()` (role `rider` + `RiderGuard`: rider active, vendor approved) and `@CurrentRider()` |
  | Admin | `/admin/food/...` | `@Roles('admin', 'super_admin')`, every write audited |

  Scope every vendor query by its `brandId`/`branchId`/`businessId`, every rider query by
  `riderId`: anything else is **404**.
- **One brand and one branch per vendor**, created on approval (`FoodVendorService.ensureForBusiness`).
  The vendor id in APIs is the **brand id**. Separate tables so chains can come later.
- **No money is held, zero commission.** COD, pay at pickup, or transfer to the vendor's own
  account (`vendor_payment_accounts`). The delivery fee is the only fee: a CHECK enforces
  `total = subtotal − discount + delivery_fee`. Vendor screens say "recorded".
- Riders: role `rider`, vendor-issued username (`riders/rider-username.ts`), email
  `<username>@riders.metromatrix.invalid` (the mailer skips `.invalid`), sign-in by
  `identifier` on the partner portal. Seats follow the plan (`riders/rider-seats.ts`).
- Visibility is one rule: `VISIBLE_VENDOR_SQL` (`discovery/discovery.service.ts`). Paused
  vendors drop out of lists but keep their page.
- Geo is PostGIS (`geography(Point,4326)`, `ST_DWithin`/`ST_Distance`); the first Food
  migration creates the extension. Open state is `availability/open-state.ts` (overnight
  ranges, closures); fee/ETA/zone only through `ServiceabilityService.quote`.
- Pricing and validation only in `menu/item-pricing.ts`; cart, preview and checkout all go
  through `checkout/food-checkout-planner.service.ts`. Promotions: `promotions/best-promotion.ts`
  (pure). Scheduling and slots: `checkout/food-schedule.service.ts`.
- Checkout is one transaction behind `Idempotency-Key`: slot (row lock), portions and promotion
  use (conditional UPDATEs), order + snapshot lines + event, cart cleared; notify after commit.
  `FOOD_CHECKOUT_FAULT_INJECTOR` is the test seam.
- Order, payment and rider-step changes only through `FoodOrderTransitionsService`
  (`orders/food-order-status.ts`, `food-payment-status.ts`, `riders/rider-steps.ts`). Every
  cancel gives back today's portions and the promotion use. Events are ordered by `seq`.
- Realtime: `realtime/food.gateway.ts`, namespace `/food`. The handshake uses
  `AccessTokenValidator` (shared with `JwtStrategy`); socket users are identified in the
  middleware. Rooms `branch:`, `rider:`, `order:` (only via an authorised `subscribe`).
  Services never emit directly: they call `FoodNotifier.changed()` after commit. Socket CORS
  follows `CORS_ORIGINS` (`ConfiguredIoAdapter` in `configureApp`).
- Sub-domains connect through hook fields set in `onModuleInit`: `discovery.dealsFor` /
  `orderAgain` / `banners` / `reviewSummary`, `views.riderCard` / `canReview`,
  `actions.onDelivered`, `notifier.onOrderChanged`, `locations.fanOut`,
  `BusinessesService.onStatusChanged` (suspend/reinstate), `PlanService.registerCounter` /
  `onPlanChanged`, `VendorSetupService.register`.
- Queries in a transaction must not overlap: use `common/db/parallel.ts`, not `Promise.all`,
  when `m` may be a transaction manager.
- Jobs (`jobs/food-jobs.service.ts`) are advisory-locked and idempotent; tests call them with
  a fixed `now`. The daily portions reset runs once per branch-local day (`portions_reset_on`).
- `test/qa-matrix-food.e2e-spec.ts` is Chunk 4's release gate (28 rows). Helpers live in
  `test/utils/food.ts` and `test/utils/socket.ts`; `createTestApp({ listen: true })` for sockets.
- Demo vendors are fictional (taglines say so), logos are generated monograms, photos are
  credited Unsplash food photos (`seeds/food/CREDITS.md`, checked by `food-data.spec.ts`).

## Kitchen Intelligence (Chunk 5)

- New modules:
  - `src/modules/ai/` — the AI layer and voice;
  - `src/modules/kitchen/` — stock, recipes, purchases, costing, price watch, waste, insight
    cards, forecast and prep, Bachat Box, packing proof;
  - `src/modules/food-growth/` (5B) — tiffin, catering, Ramadan, story and hygiene,
    storefront, discovery rails and badges, demand map and curve;
  - later `nutrition/` and `my-kitchen/`.

  Contracts: `docs/API_KITCHEN.md`, `docs/AI.md`, `docs/VOICE.md`.
- **AI is optional and never trusted blindly.** Every call goes through `AiService.run`:
  kill switch, cache, quota, 12 s budget, class-validator check plus one retry, then an
  `ai_usage` row. Callers always have a manual path (`AiService.failure` →
  `503 AI_UNAVAILABLE { manual }` / `429 AI_QUOTA_REACHED { resetsOn }`). AI output is a
  draft until a person confirms; `/ai/voice` executes nothing.
- **Prompts** are `ai/prompts/*.md` with an `id` and `version`. Bump the version when the
  text changes.
- **Tests never call a real model.** Override `AiProvider` with `FakeAiProvider` and
  `MediaStorage` with `FakeMediaStorage` (`test/utils/fake-ai.ts`). Real calls only in
  `npm run voice:eval` (free-tier quota: about 20 a model a day).
- **Voice screens** register in `onModuleInit` through `VoiceContexts.register`, so ai/ never
  imports Food. Readings go through `combineReadings`: the model, completed by the rule
  parser (`voice/rule-parser.ts`, `voice/lexicon.ts`). `voice-eval/manifest.json` is the
  accuracy set; the rule-parser spec is its regression gate. Add phrases, don't tune on the
  held-out set.
- **Units:** `kitchen/stock/units.ts` is the only conversion code (base `g` / `ml` / `piece`).
  Costs are rupees per base unit, `numeric(12,4)`.
- **Stock changes only through `KitchenStockService`** (`apply`, `restoreRef`,
  `reversePurchase`). It locks ingredients in id order, uses FIFO batches and writes one
  movement per batch with `balance_after`. Stock may go negative and never blocks an order.
  After each change it re-checks sold-out (`StockAvailabilityService`; `auto_reason = 'stock'`
  only — never undo a manual sold-out).
- **Order hooks:** `FoodOrderTransitionsService.beforeStatus` / `afterStatus` (deduct on
  accept, restore on cancel, the packing-photo check), and `FoodNotifier.afterChange`.
  Deduct and restore are once-only through `food_orders.stock_deducted_at` /
  `stock_restored_at`.
- **`UPDATE … RETURNING` through `m.query` returns `[rows, affected]`.** Read it with
  `returned()` (`common/db/parallel.ts`), never `const [row] = …`.
- **Kitchen notifications go through the `kitchen_alerts` outbox:** `queue` in the
  transaction, then `flush` after commit.
- **Forecast:** `kitchen/forecast/forecast.ts` (pure, spec-tested). Certain demand plugs in
  through `ForecastService.extraDemand`, and insight cards through
  `InsightCardsService.register`.
- **Smart ETA:** `prep_time_stats` (Food), p75 when a bucket has ≥ 20 samples.
- **Bachat Box:** the last box is decided by one conditional `UPDATE`; three no-shows block
  a customer for 14 days.
- **Jobs** (`kitchen/jobs/kitchen-jobs.service.ts`) are advisory-locked and idempotent, and
  tests call them directly. `KitchenJobsService.nightly[]` takes more steps.
- **Growth (5B):**
  - Orders the system writes (tiffin, catering) go through `FoodOrderWriter` and are accepted
    as `system`. They run once: a `tiffin_deliveries` unique key, and
    `catering_requests.food_order_id`.
  - Ramadan hours are `BranchStateService.dateOverrides` → `openIntervals(…, byDate)`, only
    on dates inside a `ramadan` `calendar_events` row. Never store them as hours.
  - Discovery extensions are lists on `FoodDiscoveryService`: `badgeSources`,
    `railSources`, `vendorExtras`, `itemExtras`, `searchSinks`.
  - `search_events` is anonymous: no user, device, IP or exact point; geohash6 only
    (`common/geo`). Never add a user column. Demand output is k-thresholded (`DEMAND_K` = 5).
  - Hygiene `verified` is set only by staff (`/admin/food/hygiene`).
  - Menu engineering rules are pure (`kitchen/engineering/menu-engineering.ts`).
- `test/qa-matrix-kitchen.e2e-spec.ts` is Chunk 5's release gate: rows 1–28 and 36–38 now.
  Helpers live in `test/utils/kitchen.ts` and `test/utils/fake-ai.ts`.
- **`seed:kitchen`** (after `seed:food`) boots the app context, so demo data goes through the
  same services. History orders are inserted as already deducted. Part 2 (5B) adds a tiffin
  plan with subscribers, a catering request, a Ramadan event, a story and search events.

## Keep in sync when the API changes

- `docs/API_AUTH.md`, `docs/API_SHOPPING.md`, `docs/API_HEALTH.md` (+ `docs/VIDEO.md`),
  `docs/API_FOOD.md` (+ `docs/SUBSCRIPTIONS_LATER.md`): the contracts the apps are built from.
- `postman/MetroMatrix-Auth.postman_collection.json` (`npm run postman:local`) and
  `postman/MetroMatrix-Shopping.postman_collection.json` (`npm run postman:shopping`, needs
  `seed:shopping`) and `postman/MetroMatrix-Health.postman_collection.json`
  (`npm run postman:health`, needs `seed:health`) and
  `postman/MetroMatrix-Food.postman_collection.json` (`npm run postman:food`, needs
  `seed:food`), plus `scripts/food-socket-check.mjs` (`npm run socket:food`), and
  `postman/MetroMatrix-Kitchen.postman_collection.json` (`npm run postman:kitchen`, needs
  `seed:food` + `seed:kitchen`). These are runnable flows against a local server plus Mailpit.
- `docs/API_KITCHEN.md`, `docs/AI.md`, `docs/VOICE.md` (and its accuracy table, written by
  `npm run voice:eval`).
- `.env.example` and `env.validation.ts` — together, always.

## Commands

```
docker compose up -d --wait   Postgres (127.0.0.1:5433) + Mailpit (SMTP 1025, UI 8025), healthy
npm run start:dev             watch mode
npm run migration:run         apply migrations
npm run migration:check       entities ↔ migrations drift check
npm run seed:superadmin       create/repair the super admin from SUPER_ADMIN_* env
npm run seed:shopping         demo stores/products (SEED_DEMO_PASSWORD; --placeholder-images = no uploads)
npm run seed:health           30 demo doctors (portraits), patients, visits, reviews, home banners (same password and flags)
npm run seed:food             6 fictional food vendors, 58 dishes, riders, customers, orders, reviews, banners (same password and flags)
npm run seed:kitchen          kitchens for 3 of them: ingredients, recipes, 60 days of orders, purchases, waste, SPI sample, forecasts
npm run lint && npm run build && npm test && npm run test:e2e
npm run postman:local         newman run of the Auth collection (needs a running server)
npm run postman:shopping      newman run of the Shopping collection (needs seed:shopping)
npm run postman:health        newman run of the Healthcare collection (needs seed:health)
npm run postman:food          newman run of the Food Court collection (needs seed:food)
npm run socket:food           Socket.IO check of the Food realtime flow (needs seed:food)
npm run postman:kitchen       newman run of the Kitchen collection (needs seed:food + seed:kitchen; AI_ENABLED=false)
npm run voice:eval            voice accuracy against Gemini (real calls; resumes; never in CI)
```

Deploying: see `DEPLOYMENT.md` (nothing is provisioned by default — the owner decides).
