# Subscriptions — how paid plans would arrive later

Today every Food Court vendor is on **`community`**: free, no expiry, nothing paywalled.
This note records what is already in place, and how FinMatrix's manual-transfer billing would
be ported **if and when the owner decides to offer paid plans**. Nothing here is built yet,
and nothing here changes the rules that hold today:

- **Zero commission, forever.** A plan would be a flat monthly price for features. It is
  never a percentage of, or a fee on, any customer order. Customers' money still goes to the
  vendor directly; the delivery fee stays the only fee a customer sees.
- **No paid services.** Billing would run on manual transfers to MetroMatrix's own account,
  approved by staff, exactly as FinMatrix does — no payment gateway or subscription service.

## What is already in place (Chunk 4)

| Piece | Where | What it does |
|---|---|---|
| Plan config | `src/modules/plans/plan-config.ts` | The single source of truth (FinMatrix shape): `key`, `label`, `priceMinorUnits` (paisa, FinMatrix's unit), `currency`, `durationMonths` (null = no expiry), `isOffered`, `limits` (`brands`, `branches`, `riders`, `menu_items`, `promotions_active`), `entitlements` (`riders`, `promotions`, `insights`, `preorders`). `normalizePlan` maps unknown keys to `community`. |
| Per-vendor plan | `business_plans` (`business_id` unique, `plan_key`, `started_at`, `expires_at`, `overrides jsonb`) | One row per food business, created on approval. `overrides` are staff's per-vendor exceptions (`applyOverrides`). |
| Enforcement | `PlanService.assertWithin(m, businessId, key, nextCount)` → `409 PLAN_LIMIT_REACHED { key, limit, used, planKey }`; `assertEntitled(...)` for features | Every limit is counted by the sub-domain that owns it (`registerCounter`), so a new limit is one counter and one config key. |
| Seat reconcile | `src/modules/food/riders/rider-seats.ts` (ported) | When a limit drops, riders beyond it become `plan_locked` and are signed out; a rider mid-delivery keeps the seat; raising the limit unlocks them. Runs in the same transaction as the plan change (`PlanService.onPlanChanged`). |
| Staff control | `GET/PATCH /admin/food/vendors/:id/plan` | Change plan or overrides; takes effect immediately; audited (`food.vendor.plan`). |
| Vendor view | `GET /food/vendor/plan` | `{ planKey, label, priceMinorUnits, currency, limits, usage, entitlements, startedAt, expiresAt, overrides }` — the app's plan screen already has its data. |

So a paid plan is a new entry in `PLAN_CONFIG` plus the billing flow below — not a rewrite.

## The billing flow to port from FinMatrix

FinMatrix sells plans by bank transfer: the owner pays, uploads a screenshot, staff approve,
the plan activates. Three files carry it; each maps onto MetroMatrix as follows.

### 1. `billing.controller.ts` → `src/modules/plans/billing.controller.ts` (vendor)

| FinMatrix | MetroMatrix | Notes |
|---|---|---|
| `GET /billing/plans` | `GET /food/vendor/billing/plans` | The plans with `isOffered` from `PLAN_CONFIG`. |
| `GET /billing/status` | (fold into `GET /food/vendor/plan`) | Add `subscriptionStatus` (`active` / `expiring` / `expired`), `daysRemaining`, the last submission. |
| `GET /billing/plan-limits` | (already `GET /food/vendor/plan`) | |
| `GET /billing/bank-details` | `GET /food/vendor/billing/bank-details` | MetroMatrix's own account, from env (never in code or seeds). |
| `POST /billing/submit` | `POST /food/vendor/billing/submissions` | `{ planKey, months?, transferRef, screenshotUrl }` — the screenshot through `POST /media/sign-upload { purpose: "billing_proof" }` (a new **private** purpose, like `health_record`). One open submission per business. |
| `GET /billing/submissions` | `GET /food/vendor/billing/submissions` | The owner's history. |
| `GET /billing/submissions/:id/screenshot` | — | Use `MediaService.privateDownload` links instead of streaming. |

New table `plan_payment_submissions`: `business_id`, `plan_key`, `months`, `amount`
(from the plan config, never from the client; shown in rupees), `transfer_ref`, `screenshot_url`,
`status` (`submitted` → `approved` / `rejected`), `reviewed_by`, `reviewed_at`,
`rejection_reason`. A partial unique index keeps one `submitted` row per business.

### 2. `billing-admin.controller.ts` → `src/modules/plans/billing-admin.controller.ts` (staff)

| FinMatrix | MetroMatrix |
|---|---|
| `GET /admin/payment-submissions` | `GET /admin/billing/submissions?status&serviceType` |
| `GET /admin/payment-submissions/revenue/summary` | `GET /admin/billing/revenue` |
| `PATCH /admin/payment-submissions/:id/approve` | `POST /admin/billing/submissions/:id/approve` |
| `PATCH /admin/payment-submissions/:id/reject` | `POST /admin/billing/submissions/:id/reject { reason }` |
| `POST /admin/payment-submissions/run-expiry-scan` | — (no debug or ops routes: tests call the job method) |

**Approve** (one transaction, as in FinMatrix `BillingService.approve`): lock the submission
and the `business_plans` row; idempotent on an already-approved submission; set `plan_key`,
`started_at = now`, `expires_at` = the later of now and the current expiry, plus the plan's
months (renewing early loses no paid days); write one `plan_revenue` row (unique per
submission); run the plan-changed hooks (rider seats reconcile — locked riders come back when
the new limit allows). Notify the owner after commit; audit `billing.approve`.

**Reject:** `{ reason }`, the owner is notified, the plan is untouched.

### 3. `billing-cron.service.ts` → a job in `src/modules/plans/plan-jobs.service.ts`

FinMatrix runs one idempotent daily scan (reminders deduped per day, a one-time downgrade).
Ported with MetroMatrix's job pattern (advisory lock, `JOBS_ENABLED`, a plain method tests
call with a fixed `now`):

- 7, 3 and 1 days before `expires_at`: remind the owner (once per day — store
  `reminded_on`).
- At `expires_at`: move the business back to `community` through `PlanService.change`
  (so the seat reconcile runs), keep `expires_at` as history, notify the owner.
  **A downgrade never deletes or hides data**: extra riders become `plan_locked`, menu items
  beyond the limit stay but new ones are refused, promotions beyond the limit stop counting
  as running.

## The natural first paid features

Both are already modelled so they can be switched on by plan:

1. **Chains (multi-branch).** `food_brands` and `branches` are separate tables today with one
   of each per vendor. A chain plan raises `branches` (and drops the unique
   `branches.business_id`), adds branch selection to the vendor app, and routes orders by the
   nearest serviceable branch — menus are per brand already, availability per branch.
2. **Staff accounts.** Kitchen and counter logins under one vendor, with roles (accept orders,
   edit menu, see insights) — the same vendor-issued-username pattern the riders use.

Other candidates: more riders or active promotions than `community` allows, a longer insights
range, featured placement (staff-curated today). Each is a `limits` or `entitlements` key.

## Before turning any of this on

- Decide the prices (`priceMinorUnits`) and durations in `PLAN_CONFIG`; keep `community`
  free and the default.
- Put MetroMatrix's receiving account in env (`BILLING_ACCOUNT_*`), and add the keys to
  `.env.example` and `env.validation.ts` together.
- Add the `billing_proof` upload purpose (private).
- Update `docs/API_FOOD.md` and the Postman collection.
