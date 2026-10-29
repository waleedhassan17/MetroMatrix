# Admin permissions

Who may call which admin route, and why. The server enforces every line of this
file; the console hiding a button is a courtesy, never the protection.

## The model

- **Roles.** `admin` and `super_admin` reach `/admin/*` (`@Roles('admin', 'super_admin')`).
  Customers, partners and riders never do: `RolesGuard` answers 403 `FORBIDDEN`.
- **Permissions.** A regular admin holds a subset of 11 keys
  (`src/types/admin-permissions.ts`, the only list):

  | Group | Key | What it opens |
  |---|---|---|
  | Operations | `approvePartners` | The partner approval queue: approve, reject, suspend, reinstate |
  | Operations | `manageUsers` | People: search, detail, disable, enable, sign out everywhere |
  | Services | `manageShopping` | `/admin/shop/*` except banners |
  | Services | `manageHealthcare` | `/admin/health/*` except banners |
  | Services | `manageFood` | `/admin/food/*` except banners (plans, safety checks, growth) |
  | Services | `manageKitchen` | `/admin/kitchen/*`, `/admin/nutrition/foods/*`, `/admin/ai/*` |
  | Services | `manageContent` | Home banners in Shopping, Healthcare and Food |
  | Insight | `viewAnalytics` | `/admin/overview`, `/admin/analytics/*` |
  | Insight | `viewAudit` | `/admin/audit` |
  | Platform | `broadcast` | `/admin/broadcasts` |
  | Platform | `manageSettings` | `/admin/settings` (feature flags, kill switch) |

- **Super admin.** Holds every key implicitly, plus **admin management**
  (`/admin/admins/*`), which is not a key and can never be granted. Super admins
  are made only by `npm run seed:superadmin`; the API never creates or promotes
  one.
- **Enforcement.** `PermissionsGuard` (global, after `RolesGuard`) reads the
  admin's grants from `req.user`, which `AccessTokenValidator` builds from the
  `users` row on every request — never from the token. It **fails closed**: an
  admin route with neither `@RequirePermission(...)` nor `@AdminAny()` is refused
  to regular admins. A grant change bumps `token_version`, so it applies on the
  very next request.
- **Storage.** `users.admin_permissions jsonb` (migration `AdminPermissions`), a
  sorted array. CHECKs refuse anything but an array of the 11 keys, and any grant
  on a non-`admin` row. A jsonb column rather than a join table: the validator
  already loads the row, so the grants cost no extra query per request; a grant,
  its `token_version` bump and its audit row are one update; and the audit trail
  already records who granted what, which is all a join table's extra columns
  would hold.
- **Sessions that are not set up.** While an admin must change a temporary
  password, or has no authenticator, only `/auth/me`, `/auth/change-password`,
  `/admin/me/totp/*` and sign-out work (`AdminSessionGuard`); everything else is
  403 `PASSWORD_CHANGE_REQUIRED` / `TOTP_REQUIRED`.
- **Step-up.** Routes marked *(step-up)* below also need `totpCode` in the body:
  a fresh code from the actor's own authenticator, whose 30 s step has never been
  used (403 `STEP_UP_REQUIRED` / `TOTP_INVALID`).

`test/admin-permissions.e2e-spec.ts` discovers every route under `/admin` at
runtime and proves: each is refused (403 `FORBIDDEN`) to an admin without its
permission, passes the check with it, a key opens no other key's routes,
super-admin routes refuse an admin holding all 11 keys, customers, partners and
riders get 403 everywhere, and no admin route lacks a mapping.

## Route map
<!-- generated from the controllers: 121 routes -->

### `approvePartners`

| Method | Path |
|---|---|
| GET | `/admin/businesses` |
| GET | `/admin/businesses/:id` |
| POST | `/admin/businesses/:id/approve` |
| POST | `/admin/businesses/:id/reject` |
| POST | `/admin/businesses/:id/suspend` |
| POST | `/admin/businesses/:id/reinstate` |

### `manageUsers`

| Method | Path |
|---|---|
| GET | `/admin/users` |
| GET | `/admin/users/:id` |
| POST | `/admin/users/:id/sign-out-everywhere` |
| POST | `/admin/users/:id/disable` |
| POST | `/admin/users/:id/enable` |

### `manageShopping`

| Method | Path |
|---|---|
| GET | `/admin/shop/categories` |
| POST | `/admin/shop/categories` |
| PATCH | `/admin/shop/categories/:id` |
| DELETE | `/admin/shop/categories/:id` |
| POST | `/admin/shop/stores/:id/feature` |
| POST | `/admin/shop/stores/:id/unfeature` |
| GET | `/admin/shop/reports` |
| POST | `/admin/shop/reports/:id/dismiss` |
| POST | `/admin/shop/products/:id/remove` |
| POST | `/admin/shop/products/:id/restore` |
| GET | `/admin/shop/orders` |
| GET | `/admin/shop/orders/:id` |
| POST | `/admin/shop/reviews/:id/hide` |
| POST | `/admin/shop/reviews/:id/unhide` |

### `manageHealthcare`

| Method | Path |
|---|---|
| GET | `/admin/health/doctors` |
| POST | `/admin/health/doctors/:id/pmdc-verify` |
| POST | `/admin/health/doctors/:id/pmdc-unverify` |
| POST | `/admin/health/doctors/:id/unlist` |
| POST | `/admin/health/doctors/:id/clear-unlist` |
| GET | `/admin/health/specialties` |
| POST | `/admin/health/specialties` |
| PATCH | `/admin/health/specialties/:id` |
| GET | `/admin/health/conditions` |
| POST | `/admin/health/conditions` |
| PATCH | `/admin/health/conditions/:id` |
| PUT | `/admin/health/conditions/:id/specialties` |
| GET | `/admin/health/overview` |
| GET | `/admin/health/appointments` |
| GET | `/admin/health/appointments/:code` |
| POST | `/admin/health/appointments/:code/cancel` |
| GET | `/admin/health/reviews` |
| POST | `/admin/health/reviews/:id/hide` |
| POST | `/admin/health/reviews/:id/unhide` |

### `manageFood`

| Method | Path |
|---|---|
| GET | `/admin/food/lookup` |
| GET | `/admin/food/demand-map` |
| GET | `/admin/food/demand-map/cities` |
| GET | `/admin/food/calendar-events` |
| POST | `/admin/food/calendar-events` |
| PATCH | `/admin/food/calendar-events/:id` |
| DELETE | `/admin/food/calendar-events/:id` |
| GET | `/admin/food/hygiene` |
| POST | `/admin/food/hygiene/:brandId/verify` |
| POST | `/admin/food/hygiene/:brandId/revoke` |
| GET | `/admin/food/signatures` |
| POST | `/admin/food/signatures/:recipeCardId/remove` |
| GET | `/admin/food/vendors/:id/plan` |
| PATCH | `/admin/food/vendors/:id/plan` |
| POST | `/admin/food/branches/:id/food-safety-check` |
| GET | `/admin/food/overview` |
| GET | `/admin/food/vendors` |
| GET | `/admin/food/vendors/:id` |
| POST | `/admin/food/vendors/:id/feature` |
| POST | `/admin/food/vendors/:id/unfeature` |
| POST | `/admin/food/vendors/:id/suspend` |
| POST | `/admin/food/vendors/:id/reinstate` |
| GET | `/admin/food/orders` |
| GET | `/admin/food/orders/:id` |
| GET | `/admin/food/reviews` |
| POST | `/admin/food/reviews/:id/hide` |
| POST | `/admin/food/reviews/:id/unhide` |
| GET | `/admin/food/cuisines` |
| POST | `/admin/food/cuisines` |
| PATCH | `/admin/food/cuisines/:id` |
| DELETE | `/admin/food/cuisines/:id` |

### `manageKitchen`

| Method | Path |
|---|---|
| GET | `/admin/ai/usage` |
| GET | `/admin/ai/prompts` |
| GET | `/admin/ai/settings` |
| GET | `/admin/kitchen/aliases` |
| POST | `/admin/kitchen/aliases` |
| DELETE | `/admin/kitchen/aliases/:id` |
| POST | `/admin/kitchen/reference-prices/import` |
| GET | `/admin/kitchen/reference-items` |
| GET | `/admin/nutrition/foods` |
| POST | `/admin/nutrition/foods` |
| POST | `/admin/nutrition/foods/import` |
| PATCH | `/admin/nutrition/foods/:id` |
| DELETE | `/admin/nutrition/foods/:id` |
| POST | `/admin/nutrition/foods/:id/activate` |

### `manageContent`

| Method | Path |
|---|---|
| GET | `/admin/food/banners` |
| POST | `/admin/food/banners` |
| PATCH | `/admin/food/banners/:id` |
| DELETE | `/admin/food/banners/:id` |
| GET | `/admin/health/banners` |
| POST | `/admin/health/banners` |
| PUT | `/admin/health/banners/order` |
| PATCH | `/admin/health/banners/:id` |
| DELETE | `/admin/health/banners/:id` |
| GET | `/admin/shop/banners` |
| POST | `/admin/shop/banners` |
| PATCH | `/admin/shop/banners/:id` |
| DELETE | `/admin/shop/banners/:id` |

### `viewAnalytics`

| Method | Path |
|---|---|
| GET | `/admin/overview` |
| GET | `/admin/analytics/timeseries` |

### `broadcast`

| Method | Path |
|---|---|
| POST | `/admin/broadcasts` (step-up) |
| GET | `/admin/broadcasts` |

### `viewAudit`

| Method | Path |
|---|---|
| GET | `/admin/audit` |

### `manageSettings`

| Method | Path |
|---|---|
| GET | `/admin/settings` |
| PATCH | `/admin/settings` (step-up) |

### Super admin only — never grantable

| Method | Path |
|---|---|
| GET | `/admin/admins` |
| GET | `/admin/admins/:id` |
| POST | `/admin/admins` (step-up) |
| PATCH | `/admin/admins/:id/permissions` (step-up) |
| POST | `/admin/admins/:id/disable` (step-up) |
| POST | `/admin/admins/:id/enable` (step-up) |
| POST | `/admin/admins/:id/reset-password` (step-up) |
| POST | `/admin/admins/:id/reset-totp` (step-up) |

### Any admin (`@AdminAny`)

| Method | Path |
|---|---|
| GET | `/admin/meta` |
| POST | `/admin/me/recovery-codes` (step-up) |
| POST | `/admin/me/totp/enrol` |
| POST | `/admin/me/totp/confirm` |
