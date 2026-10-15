# MetroMatrix API — Chunk 1 contract (auth, accounts, partner onboarding, admin)

The app chunk is built from this file. Everything here is enforced by the e2e suite
(`test/*.e2e-spec.ts`, including `qa-matrix.e2e-spec.ts`). Live schema: `GET /api/docs-json`
(Swagger UI at `/api/docs` where enabled).

- **Base URL:** `https://<host>/api/v1` (local: `http://localhost:3000/api/v1`)
- **Auth header:** `Authorization: Bearer <accessToken>`
- **Content type:** `application/json` everywhere.
- **Optional:** `X-Request-Id` (echoed back; quote it in bug reports) and `Idempotency-Key` on
  authenticated POSTs (a retry with the same key replays the first response instead of
  running twice).

---

## 1. Envelope

Every response, success or failure, is enveloped.

```json
{ "success": true, "data": { "...": "..." } }
```

```json
{ "success": false, "error": { "code": "UPPER_SNAKE", "message": "Human sentence", "details": {} } }
```

- Branch on `error.code`, never on `message` (wording may change) or HTTP status alone.
- `message` is safe to show to the user.
- `details` is optional and code-specific (documented per endpoint below).
- **Lists** are `data: { "items": [...], "total": 42, "page": 1, "pageSize": 20 }`.
- Validation failures: `400 VALIDATION_FAILED`, with `details.fields` mapping each field to
  its messages, e.g. `{ "fields": { "password": ["Password must contain …"] } }`.

---

## 2. Shared shapes

### `AuthUser`
```json
{
  "id": "6f1c…", "email": "ayesha@example.com", "displayName": "Ayesha Khan",
  "role": "customer", "phone": "+923124890176", "avatarUrl": null,
  "isEmailVerified": false, "hasPassword": true
}
```
`role` is one of `customer | partner | rider | admin | super_admin`. `rider` is reserved for
the Food chunk. `hasPassword` is false for Google-only accounts; offer "Set a password".

### `TokenPair`
```json
{ "accessToken": "eyJ…", "refreshToken": "Qm9…", "expiresIn": 900 }
```
`expiresIn` is in seconds (15 minutes). The refresh token is an opaque string: store it
securely (SecureStore) and never decode it.

### `BusinessSummary` (null unless the user is a partner who has created a business)
```json
{
  "id": "…", "name": "Dr. Sana's Clinic", "slug": "dr-sanas-clinic-4f2a1",
  "serviceType": "healthcare", "subType": "doctor", "status": "pending_approval",
  "rejectionReason": null, "suspensionReason": null, "submittedAt": "2026-10-15T09:12:00.000Z"
}
```

### `AuthResult` (signup, signin, Google, admin TOTP)
```json
{ "user": AuthUser, "tokens": TokenPair, "business": BusinessSummary | null }
```

### `AccountView` (GET /auth/me, POST /auth/verify-email)
```json
{ "user": AuthUser, "business": BusinessSummary | null }
```

---

## 3. Sessions and tokens: client rules

- Each sign-in starts a **session**, one per device. The access token lasts 15 minutes.
- **Refresh rotates:** every `POST /auth/refresh-token` returns a *new* refresh token. Always
  store the new one and discard the old.
- **Reuse grace:** if two requests (two tabs, app plus widget) refresh with the same token
  within **10 seconds**, both succeed.
- **Reuse detection:** the same refresh token presented again *after* the grace window means
  it was copied. The whole session is revoked and the answer is `401 REFRESH_REUSED`.
- **Logout** signs out **this device only**: its access token is rejected immediately, and its
  refresh token stops working. Other devices stay signed in.
- **Signed out everywhere:** password reset, account deletion and an admin disabling the
  account. Every access token dies immediately (`401 TOKEN_REVOKED`).
- **Change password** signs out every *other* device; this one keeps its session.

Recommended client handling of a 401/403 on any authenticated call:

| Response | Do this |
|---|---|
| `401 UNAUTHORIZED` (access token expired/missing) | Refresh once, retry the request once. |
| `401 REFRESH_INVALID`, `401 REFRESH_REUSED` (from refresh) | Clear tokens → sign-in screen. |
| `401 TOKEN_REVOKED` | Try one refresh; if that fails, sign-in screen. |
| `403 ACCOUNT_DISABLED` | Clear tokens → "account disabled" screen. |
| `403 EMAIL_NOT_VERIFIED` | Go to the verify-email screen. |

Serialise refreshes in the client (one in flight at a time). The grace window is a safety
net, not a strategy.

---

## 4. Endpoints

Throttles are per client IP. When one is exceeded the answer is `429 RATE_LIMITED`, with a
`Retry-After` header.

### 4.1 Auth

#### `POST /auth/signup` (public, 20 per hour)
```json
{ "email": "ayesha@example.com", "password": "Secret123", "displayName": "Ayesha Khan",
  "phone": "0312 4890176", "role": "customer" }
```
- `password`: 8–72 characters, with at least one lower-case letter, one upper-case letter and one digit.
- `displayName`: 2–80 characters.
- `phone` (optional): a Pakistani mobile in any common form (`03XXXXXXXXX`, `+923…`, `923…`,
  spaces and dashes allowed). It is stored and returned as `+923XXXXXXXXX`.
- `role`: `customer` or `partner`.

**201** `AuthResult` with `user.isEmailVerified: false`; a 6-digit code is emailed.
The session works immediately: send the user to the verify screen.
**Errors:** `409 EMAIL_EXISTS` (any letter case), `400 VALIDATION_FAILED`.

```bash
curl -X POST $API/auth/signup -H 'Content-Type: application/json' \
  -d '{"email":"ayesha@example.com","password":"Secret123","displayName":"Ayesha Khan","role":"customer"}'
```

#### `POST /auth/signin` (public, 5 per minute)
```json
{ "email": "ayesha@example.com", "password": "Secret123", "portal": "customer" }
```
`portal` is `customer`, `partner` or `admin`. The password is checked first and the portal second.
- **200** `AuthResult` (customer and partner portals).
- **200 on the admin portal**: no tokens yet. The response is
  `{ "totpRequired": true, "enrolmentRequired": false, "challengeToken": "eyJ…" }`; continue with
  `/auth/admin/totp`, or with `/admin/me/totp/*` when `enrolmentRequired` is true.
- **Errors:**
  - `401 INVALID_CREDENTIALS`: the same answer for an unknown email and a wrong password.
  - `403 WRONG_PORTAL`: `details: { accountType, portal }`; the message names the right door.
  - `403 ACCOUNT_DISABLED`.

```bash
curl -X POST $API/auth/signin -H 'Content-Type: application/json' \
  -d '{"email":"ayesha@example.com","password":"Secret123","portal":"customer"}'
```

#### `POST /auth/admin/totp` (public, 5 per minute)
```json
{ "challengeToken": "eyJ…", "code": "123456" }
```
or
```json
{ "challengeToken": "eyJ…", "recoveryCode": "abcd-2345" }
```
**200** `AuthResult`. The challenge is single-use and lasts 5 minutes. A recovery code works once.
**Errors:**
- `401 UNAUTHORIZED`: the challenge has expired or was already used; sign in again.
- `401 TOTP_INVALID`.
- `403 TOTP_REQUIRED`: not enrolled yet; `details.enrolmentRequired: true`.

#### `POST /auth/google` (public, 10 per minute, customer portal only)
```json
{ "idToken": "<Google ID token from Google Sign-In>" }
```
The token's audience must be one of the server's `GOOGLE_CLIENT_IDS` (web, Android, iOS).
- An account already linked to this Google account signs in.
- Otherwise Google must say the email is verified. An existing **customer** with that email
  is linked (and marked verified); otherwise a new verified customer is created.
- **200** `AuthResult`.
- **Errors:**
  - `401 INVALID_CREDENTIALS`: bad or expired token.
  - `403 WRONG_PORTAL`: the email belongs to a partner or admin.
  - `403 EMAIL_NOT_VERIFIED`: Google has not verified the email.
  - `403 ACCOUNT_DISABLED`.
  - `503 SERVICE_UNAVAILABLE`: Google sign-in is not configured on the server.

#### `POST /auth/refresh-token` (public, 30 per minute)
```json
{ "refreshToken": "Qm9…" }
```
**200** `TokenPair`. Replace both stored tokens.
**Errors:** `401 REFRESH_INVALID` (unknown or expired), `401 REFRESH_REUSED` (see §3),
`403 ACCOUNT_DISABLED`.

#### `POST /auth/logout` (alias `POST /auth/signout`; public, self-authenticating)
Send the bearer header; an expired access token still works here. There is no body.
**200** `{ "signedOut": true }`, always, even with a missing or invalid token (idempotent).
Also call `DELETE /users/me/devices/:token` *before* logging out.

#### `GET /auth/me` (bearer)
**200** `AccountView`. Call it on app start to route the user:
- unverified → the verify screen;
- a partner with no business → onboarding;
- `business.status` → the matching screen.

#### `POST /auth/verify-email` (bearer, 10 per 15 minutes)
```json
{ "otp": "123456" }
```
**200** `AccountView` with `isEmailVerified: true`. If the account is already verified, this is a no-op that returns 200.
**Errors** (all 400):
- `OTP_INVALID`: `details.attemptsLeft` gives the count remaining.
- `OTP_EXPIRED`: codes last 10 minutes.
- `OTP_LOCKED`: the 5th wrong attempt locks the code; only a resend issues a new one.

#### `POST /auth/resend-verification` (bearer, 5 per hour)
There is no body.
**200** `{ "sent": true, "alreadyVerified": false, "retryAfter": 60 }`; for an already-verified account,
`{ "sent": false, "alreadyVerified": true, "retryAfter": 0 }`.
**Errors:** `429 RESEND_COOLDOWN` with `details.retryAfter` (seconds). Show a countdown.

#### `POST /auth/forgot-password` (public, 3 per 15 minutes)
```json
{ "email": "ayesha@example.com" }
```
**200** `{ "delivered": true }`, always, whether or not the account exists. If it does, a 6-digit code is
emailed (10 minutes, 5 attempts).

#### `POST /auth/verify-otp` (public, 10 per 15 minutes)
```json
{ "email": "ayesha@example.com", "otp": "123456" }
```
**200** `{ "resetToken": "…" }`. It is single-use and expires 15 minutes after verification.
**Errors:** `400 OTP_INVALID` (with `attemptsLeft` when the account exists), `400 OTP_EXPIRED`,
`400 OTP_LOCKED`.

#### `POST /auth/reset-password` (public, 5 per 15 minutes)
```json
{ "resetToken": "…", "password": "NewSecret123" }
```
**200** `{ "reset": true }`. Every session on every device is revoked, so send the user to sign-in.
**Errors:** `400 OTP_INVALID` (token invalid, used or expired; start again), `400 VALIDATION_FAILED`.

#### `POST /auth/change-password` (bearer, 10 per 15 minutes)
```json
{ "currentPassword": "Secret123", "newPassword": "NewSecret123" }
```
Google-only accounts (`hasPassword: false`) omit `currentPassword` to set their first password.
**200** `{ "changed": true }`. Other devices are signed out; this one is not.
**Errors:** `403 INVALID_CREDENTIALS` (wrong current password; it is 403, not 401, so your
refresh logic is not triggered), `400 VALIDATION_FAILED`.

#### `DELETE /auth/account` (bearer, 5 per 15 minutes)
```json
{ "password": "Secret123" }
```
or, for a Google-only account:
```json
{ "idToken": "<fresh Google ID token>" }
```
**200** `{ "deleted": true }`. The account is anonymised and every session revoked. The email
address can sign up again. A partner's approved business is suspended, and one under review is
rejected. **Errors:** `403 INVALID_CREDENTIALS`.

### 4.2 Users and media

#### `PATCH /users/me` (bearer)
```json
{ "displayName": "Ayesha K.", "phone": "0312 4890176", "avatarUrl": "https://res.cloudinary.com/…" }
```
All fields are optional. `avatarUrl` must come from an upload signed with purpose `avatar`;
send `null` to remove it. The phone can be changed but not removed.
**200** `AuthUser`. **Errors:** `400 VALIDATION_FAILED` (including a foreign avatar URL).

#### `PUT /users/me/devices` (bearer)
```json
{ "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "platform": "android" }
```
**200** `{ "registered": true }`. This is an upsert, so call it on every app start once signed in. A token
registered by another account on the same phone moves to this one.

#### `DELETE /users/me/devices/:token` (bearer)
URL-encode the token. **200** `{ "removed": true | false }` (idempotent).

#### `POST /media/sign-upload` (bearer, 30 per minute)
```json
{ "purpose": "business_document" }
```
`purpose` is `avatar` or `business_document`.

**200**
```json
{
  "cloudName": "metromatrix", "apiKey": "1234567890", "timestamp": 1792019900,
  "signature": "3f1a…", "folder": "metromatrix/production/<userId>/business_document",
  "publicIdPrefix": "metromatrix/production/<userId>/business_document/",
  "uploadUrl": "https://api.cloudinary.com/v1_1/metromatrix/auto/upload",
  "allowedFormats": "jpg,jpeg,png,webp,heic,pdf", "maxBytes": 10000000
}
```

Upload flow:
1. `POST` the file as multipart to `uploadUrl` with fields `file`, `api_key=apiKey`,
   `timestamp`, `signature`, `folder` and `allowed_formats=allowedFormats`, all exactly as
   returned. Changing any of them invalidates the signature.
2. From Cloudinary's response, keep `secure_url` and `public_id`.
3. Send them to the API: `avatarUrl` on `PATCH /users/me`, or `{ url, publicId }` on
   `POST /businesses/me/documents`.

The signature lasts about an hour, so sign right before each upload. Size limits: avatar 5 MB,
document 10 MB. **Errors:** `503 SERVICE_UNAVAILABLE` (uploads not configured).

### 4.3 Partner onboarding (role `partner` with a verified email)

A customer calling any route here gets `403 FORBIDDEN`; an unverified partner gets `403 EMAIL_NOT_VERIFIED`.

Status machine. Anything else gives `409 INVALID_TRANSITION` with `details: { from, to }`.

```
draft ──submit──▶ pending_approval ──approve──▶ approved ⇄ suspended   (admin: suspend / reinstate)
                    ▲          │
                resubmit     reject (admin)
                    └────── rejected
```

#### `POST /businesses`
```json
{ "serviceType": "healthcare", "subType": "doctor", "name": "Dr. Sana's Clinic",
  "phone": "042 35761234", "city": "Lahore", "addressLine": "12-B Main Boulevard, Gulberg III",
  "lat": 31.520369, "lng": 74.358749 }
```
`subType` must belong to `serviceType`: `store`→`shopping`, `doctor`→`healthcare`, and
`restaurant`, `home_kitchen` and `cloud_kitchen`→`food`. `phone` may be a mobile or a landline, and is stored
`+92…`. `lat` and `lng` are optional.
**201** `BusinessDetail` (below), in status `draft`.
**Errors:** `409 BUSINESS_EXISTS` (one business per partner account), `400 VALIDATION_FAILED`.

`BusinessDetail`:
```json
{
  "id": "…", "name": "Dr. Sana's Clinic", "slug": "dr-sanas-clinic-4f2a1",
  "serviceType": "healthcare", "subType": "doctor", "phone": "+924235761234",
  "city": "Lahore", "addressLine": "…", "lat": 31.520369, "lng": 74.358749,
  "status": "draft", "rejectionReason": null, "suspensionReason": null,
  "submittedAt": null, "reviewedAt": null, "createdAt": "…", "updatedAt": "…",
  "documents": [
    { "id": "…", "kind": "cnic_front", "url": "https://res.cloudinary.com/…", "publicId": "…",
      "status": "pending", "reviewNote": null, "createdAt": "…" }
  ],
  "requiredDocuments": [
    { "kind": "cnic_front", "min": 1, "have": 1, "satisfied": true },
    { "anyOf": ["ntn_certificate", "shop_photo"], "min": 1, "have": 0, "satisfied": false }
  ],
  "missingDocuments": ["cnic_back", "pmdc_certificate", "degree_certificate"]
}
```

#### `GET /businesses/me`
**200** `BusinessDetail`. **Errors:** `404 NOT_FOUND` (no business yet).

#### `PATCH /businesses/me`
Takes any subset of the create body. It is allowed only in `draft` or `rejected`; otherwise
`409 BUSINESS_NOT_EDITABLE`. `serviceType`/`subType` can change only in `draft`. A new name
gives a new slug. A rejected business keeps its `rejectionReason` while being edited.
**200** `BusinessDetail`.

#### `POST /businesses/me/documents`
```json
{ "kind": "cnic_front", "url": "<secure_url>", "publicId": "<public_id>" }
```
- Allowed only in `draft` or `rejected`; otherwise `409 BUSINESS_NOT_EDITABLE`.
- `url` must be on our Cloudinary cloud and inside *your* `business_document` folder, and
  `publicId` must match it; otherwise `400 VALIDATION_FAILED`.
- `kind` must be one this sub-type uses; otherwise `400 VALIDATION_FAILED` with `details.allowed`.
- Uploading a kind you already have **replaces** it. The exceptions are `shop_photo` and
  `kitchen_photo`, which allow up to 4 each.

**201** the document.

#### `DELETE /businesses/me/documents/:id`
Draft or rejected only. **200** `{ "removed": true }`. **Errors:** `404 NOT_FOUND`.

#### `POST /businesses/me/submit`
Moves `draft` or `rejected` to `pending_approval`, sets `submittedAt` and clears `rejectionReason`.
**200** `BusinessDetail`.
**Errors:**
- `422 DOCUMENTS_MISSING`, with:
  - `details.missing`: requirement keys, e.g. `["pmdc_certificate"]`. An any-of group is
    written `"ntn_certificate|shop_photo"`.
  - `details.requirements`: the same rows as `requiredDocuments`.
- `409 INVALID_TRANSITION`: already pending, approved or suspended.

#### `GET /businesses/me/status`
**200** `{ "status": "pending_approval", "rejectionReason": null, "suspensionReason": null }`.
This is cheap, so poll it from the waiting screen (every 15–30 s while in the foreground).

#### Required documents (`src/modules/businesses/required-documents.ts`)

| subType | Required |
|---|---|
| `store` | `cnic_front`, `cnic_back`, and one of `ntn_certificate` / `shop_photo` |
| `doctor` | `cnic_front`, `cnic_back`, `pmdc_certificate`, `degree_certificate` |
| `restaurant` | `cnic_front`, `cnic_back`, `pfa_licence`, `storefront_photo` |
| `cloud_kitchen` | `cnic_front`, `cnic_back`, `pfa_licence` |
| `home_kitchen` | `cnic_front`, `cnic_back`, `kitchen_photo` ×2 |

A document an admin marked `rejected` (with a `reviewNote`) no longer counts, so re-upload that
kind.

#### Partner routes in later chunks
They return `403 BUSINESS_NOT_APPROVED` (`details.status`) until the business is approved, and
`403 BUSINESS_SUSPENDED` (`details.suspensionReason`) while it is suspended. This takes effect on the
very next request.

### 4.4 Admin (roles `admin`, `super_admin`; tokens only ever come after TOTP)

**First sign-in for a seeded admin:**
1. `POST /auth/signin` with `portal: "admin"` returns `enrolmentRequired: true` and a `challengeToken`.
2. `POST /admin/me/totp/enrol` with `Authorization: Bearer <challengeToken>` returns
   `{ otpauthUri, qrDataUrl, secret }`. Show the QR code.
3. `POST /admin/me/totp/confirm` with the challenge as bearer and body `{ "code": "123456" }` returns
   `{ "recoveryCodes": [10 codes, shown once], "auth": AuthResult }`.

**Rotating later** (with an admin access token): `enrol`, then
`confirm { code: <new>, currentCode: <from the current app> }`; `auth` comes back as `null`.
**Errors:**
- `400 TOTP_INVALID`.
- `403 TOTP_REQUIRED`: a challenge cannot enrol an admin who already has TOTP.
- `401 UNAUTHORIZED`.

| Method | Path | Body | 200 data |
|---|---|---|---|
| GET | `/admin/businesses?status&serviceType&q&page&pageSize` | — | `{ items: [BusinessView + owner], total, page, pageSize }` |
| GET | `/admin/businesses/:id` | — | `BusinessDetail` + `owner` + `history` (audit) |
| POST | `/admin/businesses/:id/approve` | — | `BusinessDetail` (pending documents → accepted) |
| POST | `/admin/businesses/:id/reject` | `{ reason, documentNotes?: [{ documentId, note }] }` | `BusinessDetail` |
| POST | `/admin/businesses/:id/suspend` | `{ reason }` | `BusinessDetail` |
| POST | `/admin/businesses/:id/reinstate` | `{ reason }` | `BusinessDetail` |
| GET | `/admin/users?role&status&q&page&pageSize` | — | `{ items: [AuthUser + status, totpEnabled, lastLoginAt, createdAt], … }` |
| POST | `/admin/users/:id/disable` | `{ reason? }` | the user (all sessions revoked) |
| POST | `/admin/users/:id/enable` | — | the user |

How these behave:
- `q` matches name, slug, city or owner email (businesses), and email, name or phone (users).
  `pageSize` is at most 100.
- The partner is emailed on approve, reject (with the reason and per-document notes), suspend
  and reinstate.
- Every write is recorded in `operational_audit_events`.
- An admin cannot disable themselves (`403 FORBIDDEN`), and only a `super_admin` may disable another admin.

### 4.5 Health

#### `GET /health` (public, never throttled)
**200** `{ "status": "ok", "db": "up", "version": "0.1.0" }`.
If the database is unreachable, the answer is `503 SERVICE_UNAVAILABLE` with
`details: { db: "down" }`.

---

## 5. Error codes (`src/common/errors/codes.ts`)

| Code | HTTP | Where / meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad input; `details.fields` |
| `EMAIL_EXISTS` | 409 | Signup with a taken email |
| `INVALID_CREDENTIALS` | 401 / 403 | Sign-in, bad Google token (401); wrong current password on change/delete (403) |
| `WRONG_PORTAL` | 403 | The account belongs to another sign-in door |
| `ACCOUNT_DISABLED` | 403 | Disabled by an admin |
| `EMAIL_NOT_VERIFIED` | 403 | Route needs a verified email; Google email unverified |
| `OTP_INVALID` | 400 | Wrong code (`attemptsLeft`), or a used/invalid reset token |
| `OTP_EXPIRED` | 400 | Code older than 10 minutes |
| `OTP_LOCKED` | 400 | 5 wrong attempts; request a new code |
| `RESEND_COOLDOWN` | 429 | Resend within 60 s; `retryAfter` |
| `REFRESH_INVALID` | 401 | Unknown or expired refresh token |
| `REFRESH_REUSED` | 401 | Replayed refresh token; the session is revoked |
| `TOKEN_REVOKED` | 401 | Signed out, password reset, disabled or deleted |
| `TOTP_REQUIRED` | 403 | Admin must enrol / already enrolled |
| `TOTP_INVALID` | 401 / 400 | Wrong authenticator or recovery code (401 at sign-in, 400 at confirm) |
| `BUSINESS_EXISTS` | 409 | Second business |
| `BUSINESS_NOT_EDITABLE` | 409 | Change outside draft/rejected |
| `DOCUMENTS_MISSING` | 422 | Submit without required documents; `missing` |
| `BUSINESS_NOT_APPROVED` | 403 | Partner route before approval; `status` |
| `BUSINESS_SUSPENDED` | 403 | Partner route while suspended; `suspensionReason` |
| `INVALID_TRANSITION` | 409 | Illegal status change; `from`, `to` |
| `FORBIDDEN` | 403 | Wrong role |
| `NOT_FOUND` | 404 | Unknown route or record |
| `RATE_LIMITED` | 429 | Throttled; `Retry-After` header |
| `INTERNAL_ERROR` | 500 | Unexpected; generic message, reported to Sentry |
| `UNAUTHORIZED` | 401 | Missing/expired bearer, expired admin challenge |
| `CONFLICT` | 409 | Generic conflict |
| `SERVICE_UNAVAILABLE` | 503 | DB down; Google or Cloudinary not configured |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Same `Idempotency-Key` still in flight |
