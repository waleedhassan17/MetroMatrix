# Admin API (super admin and the web console)

The contract the MetroMatrix admin web console (`MetroMatrix-Admin`) is built
from. Per-route permissions are in [ADMIN_PERMISSIONS.md](ADMIN_PERMISSIONS.md);
request and response shapes for every operation are in `openapi.json`
(`npm run openapi:export`, committed). Everything here is under `/api/v1`.

Envelope, as everywhere: `{ success: true, data }` or
`{ success: false, error: { code, message, details? } }`. Lists are
`{ items, total, page, pageSize }`, except the audit log (cursor paging, below).

## 1. Sessions

### 1.1 Signing in

1. `POST /auth/signin { email, password, portal: 'admin' }` →
   `{ totpRequired: true, enrolmentRequired, challengeToken }` (5 minutes). Admins
   never get tokens for a password alone.
2. **First time** (`enrolmentRequired: true`), with `Authorization: Bearer <challengeToken>`:
   - `POST /admin/me/totp/enrol` → `{ otpauthUri, qrDataUrl, secret }`;
   - `POST /admin/me/totp/confirm { code }` → `{ recoveryCodes, auth }` — the
     recovery codes are shown **once**; `auth` is the new session.
3. **Otherwise:** `POST /auth/admin/totp { challengeToken, code }` (or
   `recoveryCode`) → the session.
4. `GET /auth/me` → `{ user, business: null, admin: { isSuperAdmin, permissions,
   mustChangePassword, totpEnabled, recoveryCodesRemaining } }`. `permissions`
   is effective (a super admin lists all 11).

A TOTP code's 30 s step is spent once used — at sign-in, rotation and step-up —
so the same code never works twice (`TOTP_INVALID`).

### 1.2 The console's cookie session

Send `X-Client: admin-web` on step 3 (or on step 2's confirm). Then:

- the body carries `tokens: { accessToken, expiresIn }` only — **no refresh
  token**;
- the refresh token is set as cookie `mm_admin_rt`: `HttpOnly; Secure;
  SameSite=Strict; Path=/api/v1/auth/web; Max-Age=ADMIN_REFRESH_TTL`. JavaScript
  can never read it, and only the two endpoints below ever receive it.

| Endpoint | Does |
|---|---|
| `POST /auth/web/refresh` | Rotates from the cookie → `{ accessToken, expiresIn }` + a new cookie. Same rotation, 10 s grace and reuse detection as `/auth/refresh-token`: replaying a rotated cookie revokes the session (`401 REFRESH_REUSED`). |
| `POST /auth/web/logout` | Revokes the session (and the bearer token, if sent), clears the cookie. Always `200 { signedOut: true }`. |

Rules on every cookie request **and** on a sign-in with `X-Client: admin-web`
(else `403 CSRF_REJECTED`):

- header `X-Requested-With: metromatrix-admin`;
- `Origin` exactly equal to `ADMIN_WEB_ORIGIN` (unset: everything is refused);
- plus the cookie's own `SameSite=Strict`.

Limits:

- admin access tokens last `ADMIN_ACCESS_EXPIRES_IN` (10 minutes), in the app too;
- no refresh for `ADMIN_IDLE_MINUTES` (30) → `401 SESSION_IDLE` (and the session is revoked);
- `ADMIN_REFRESH_TTL` (12 h) after sign-in → `401 REFRESH_INVALID`, however often it refreshed;
- console tokens are refused by `/auth/refresh-token`, app tokens by `/auth/web/refresh` (`401 REFRESH_INVALID`);
- only `admin` and `super_admin` accounts get a console session.

**Deployment requirement.** The console must reach the API **same-site**, or
the browser drops a `SameSite=Strict` cookie. Recommended: serve the console on
Vercel with a rewrite `/api/:path*` → `https://<api-host>/api/:path*`, so the
API (and its cookie) is first-party to the console's origin, and set
`ADMIN_WEB_ORIGIN` to the console's origin (e.g. `https://admin.example.com`).
The API is not deployed yet: fill in `<api-host>` when it is.

### 1.3 Sessions that are not set up

While `admin.mustChangePassword` is true (a temporary password from a super
admin) or there is no authenticator, only `GET /auth/me`,
`POST /auth/change-password`, `/admin/me/totp/*` and sign-out work; everything
else is `403 PASSWORD_CHANGE_REQUIRED` / `403 TOTP_REQUIRED`.
`POST /auth/change-password { currentPassword: <temporary>, newPassword }`
clears the flag (the new password must differ).

### 1.4 Step-up

Sensitive writes need `totpCode` in the JSON body: a fresh code from the
actor's own authenticator. Missing → `403 STEP_UP_REQUIRED`; wrong or already
used → `403 TOTP_INVALID`. The console answers both by asking for a code and
retrying once. Step-up routes: admin create, permissions, disable, enable, both
resets, `PATCH /admin/settings`, `POST /admin/broadcasts`,
`POST /admin/me/recovery-codes`.

## 2. Endpoints added for the console

| Route | Permission | Notes |
|---|---|---|
| `GET /admin/meta` | any admin | Permission catalogue + groups, broadcast audiences, settings schema |
| `POST /admin/me/recovery-codes` | any admin, step-up | New recovery codes, shown once |
| `GET /admin/admins` | super admin | `?q&role&status&page&pageSize` |
| `GET /admin/admins/:id` | super admin | |
| `POST /admin/admins` | super admin, step-up | `{ email, displayName, permissions }` → `{ admin, temporaryPassword }` (shown once, never stored in clear) |
| `PATCH /admin/admins/:id/permissions` | super admin, step-up | `{ permissions }`; revokes the admin's sessions |
| `POST /admin/admins/:id/disable` · `/enable` | super admin, step-up | Never the last active super admin (`LAST_SUPER_ADMIN`) |
| `POST /admin/admins/:id/reset-password` | super admin, step-up | → `{ admin, temporaryPassword }`; revokes sessions |
| `POST /admin/admins/:id/reset-totp` | super admin, step-up | Next sign-in enrols again; revokes sessions |
| `GET /admin/users` | manageUsers | `?q&role&status&verified&service&createdFrom&createdTo&page&pageSize` |
| `GET /admin/users/:id` | manageUsers | Profile, businesses, `lastLoginAt`, `sessionCount` |
| `POST /admin/users/:id/sign-out-everywhere` | manageUsers | Revokes every session and access token |
| `GET /admin/overview` | viewAnalytics | `?period=7d\|30d\|90d` |
| `GET /admin/analytics/timeseries` | viewAnalytics | `?metric&from&to&interval=day\|week\|month` |
| `GET /admin/audit` | viewAudit | Cursor paging (below) |
| `GET /admin/settings` · `PATCH` | manageSettings (PATCH step-up) | |
| `POST /admin/broadcasts` · `GET` | broadcast (POST step-up) | |
| `GET /config` | public | The flags the apps enforce |

Invariants on admin management (each tested in `admin-admins.e2e-spec.ts`):
nobody acts on themselves (`403 SELF_ACTION_FORBIDDEN`); there is always an
active super admin (`403 LAST_SUPER_ADMIN`); the API never creates or promotes
a super admin (no `role` field; `manageAdmins` is not a key; an existing
account's email is `409 EMAIL_EXISTS`).

## 3. Overview and analytics

`GET /admin/overview` — every number comes from a table:

- `usersByRole` (non-deleted accounts), `signups { last7d, last30d, last90d }`
  (customers and partners);
- `businesses [{ serviceType, status, count }]`, `pendingApprovals`;
- `activity.{shopping,healthcare,food} { count, cancelled, value }` for the
  period: orders or bookings placed, how many were cancelled / rejected /
  no-show, and the recorded value in rupees (not cancelled; completed
  appointments). MetroMatrix holds no money: this is what partners recorded;
- `integrations { mailConfigured, pushEnabled, aiEnabled }`.

`GET /admin/analytics/timeseries` metrics: `signups`, `businesses_submitted`,
`shopping_orders`, `shopping_value`, `health_appointments`, `food_orders`,
`food_value`. Buckets are UTC, every bucket is present (empty ones are 0); at
most 366 days, 160 weeks or 120 months.

## 4. Audit log

`GET /admin/audit?actorUserId&action&targetType&targetId&from&to&cursor&limit`
→ `{ items, nextCursor }`, newest first. `action` is exact, or a prefix ending
in `*` (`business.*`). Pass `nextCursor` back as `cursor` until it is `null`.
Each item: `action, targetType, targetId, actor { id, email, displayName, role },
details, before, after, ip, userAgent, requestId, createdAt`.

- Every successful admin write writes **exactly one** row, by the service that
  did it, with the changed fields before and after. Every e2e suite checks this
  for the admin writes it makes (`test/utils/test-app.ts`, the audit probe); an
  interceptor writes a generic row (and logs a warning) should a future route
  forget.
- The table is append-only at the database level: a trigger refuses UPDATE,
  DELETE and TRUNCATE (migration `AuditTrail`). There is no write endpoint.
- Temporary passwords, codes and secrets never reach the trail.

## 5. Platform settings and the kill switch

| Key | Type | Default | Enforced as |
|---|---|---|---|
| `signupsEnabled.customer` | boolean | true | off: `403 SIGNUPS_PAUSED` on customer sign-up (email and new Google accounts) |
| `signupsEnabled.partner` | boolean | true | off: `403 SIGNUPS_PAUSED` on partner sign-up |
| `services.shopping.enabled` | boolean | true | off: `503 SERVICE_PAUSED` on `/shop/**` |
| `services.healthcare.enabled` | boolean | true | off: `503 SERVICE_PAUSED` on `/health/**` (not the `/health` liveness check) |
| `services.food.enabled` | boolean | true | off: `503 SERVICE_PAUSED` on `/food/**`, `/public/food/**` |
| `services.kitchen.enabled` | boolean | true | off: `503 SERVICE_PAUSED` on `/food/vendor/kitchen/**`, `/food/surplus/**`, `/food/me/nutrition/**`, `/my-kitchen/**` |
| `ai.enabled` | boolean | true | off: every AI feature takes its manual path (`503 AI_UNAVAILABLE { manual }`), as with `AI_ENABLED=false` |
| `maintenance.enabled` | boolean | false | on: `503 MAINTENANCE { message }` everywhere except `/auth/me`, `/config`, `/health`, `/admin/**`, the admin sign-in steps, sign-out, and any signed-in admin |
| `maintenance.message` | string ≤ 280 | (a default) | |
| `support.email` | email or empty | empty | |

- `GET /admin/settings` → `{ values, schema, lastChanged: { [key]: { by, at } } }`.
- `PATCH /admin/settings { values: { key: value }, totpCode }` — all-or-nothing;
  unknown keys and bad values are `400 VALIDATION_FAILED` with
  `details.fields[key]`; one `settings.update` audit row.
- `GET /config` (public, `Cache-Control: public, max-age=60`) →
  `{ signupsEnabled { customer, partner }, services { shopping|healthcare|food|kitchen { enabled } },
  ai { enabled }, maintenance { enabled, message }, support { email | null } }`.
- The server caches the values for 10 s; a change applies at once on the
  instance that made it and within 10 s elsewhere.

## 6. Broadcasts

`POST /admin/broadcasts { audience: all|customers|partners|riders, service?,
title (≤ 65), body (≤ 240), deepLink?, totpCode }` → `201` with the broadcast
(`status: queued`). `service` narrows `partners` (approved businesses of that
service). `deepLink` is `metromatrix://…` or `https://…`.

- `503 PUSH_DISABLED` when the server's `PUSH_ENABLED` is off;
- at most 5 an hour per admin (`429 RATE_LIMITED`), and 5 an hour per address;
- delivery runs right after the response, in batches of 100 through the Expo
  client every other notification uses (dead tokens are pruned), updating
  `devices`, `delivered`, `failed` and finally `status: sent | failed`.

`GET /admin/broadcasts` — history, newest first, with counts and author.

## 7. Error codes added

`PASSWORD_CHANGE_REQUIRED`, `STEP_UP_REQUIRED`, `SELF_ACTION_FORBIDDEN`,
`LAST_SUPER_ADMIN`, `SIGNUPS_PAUSED`, `SERVICE_PAUSED`, `MAINTENANCE`,
`PUSH_DISABLED`, `CSRF_REJECTED`, `SESSION_IDLE`. Existing codes the console
handles: `TOKEN_REVOKED` (access changed: sign in again), `REFRESH_INVALID`,
`REFRESH_REUSED`, `TOTP_INVALID`, `TOTP_REQUIRED`, `FORBIDDEN`,
`VALIDATION_FAILED`, `RATE_LIMITED`.

## 8. Environment

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_WEB_ORIGIN` | (unset) | The console's exact origin. Unset: console sessions are refused |
| `ADMIN_REFRESH_TTL` | `12h` | Longest a console session lives |
| `ADMIN_IDLE_MINUTES` | `30` | No refresh for this long ends the console session |
| `ADMIN_ACCESS_EXPIRES_IN` | `10m` | Access-token lifetime for admin accounts (app and console) |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | — | One-time, for `npm run seed:superadmin`; remove them afterwards |
