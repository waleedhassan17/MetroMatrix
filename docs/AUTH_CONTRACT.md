# Auth contract (generated)

Generated on 2026-10-30 from MetroMatrix_Backend `docs/openapi.json` (exported from a running API at `/api/docs-json`), with access, limits and errors from `docs/API_AUTH.md`, and the MetroMatrix_App network function that calls each endpoint. **The same file is in both repos.** Regenerate it after any change to these endpoints; don't edit it by hand.

- Base path: `/api/v1`. Every success is wrapped as `{ success: true, data }`; every failure as `{ success: false, error: { code, message, details } }` (API_AUTH.md §1).
- Response bodies are not in the OpenAPI document (it lists status codes only); their shapes are in API_AUTH.md §2 (`AuthUser`, `TokenPair`, `AuthResult`, `AccountView`, `BusinessDetail`).
- `field?` = optional. Unknown body fields are dropped by the API (`whitelist: true`).
- Not in OpenAPI, on purpose: `GET /auth/verify?token=…`, the HTML page the verification email's button opens (`@ApiExcludeEndpoint`). The App never calls it.

**35 operations**, 35 of them called by the App.

## users

### `PATCH /users/me`

Update your name, phone or avatar. Returns the user.

| | |
|---|---|
| Access | bearer |
| Body / query | `displayName`?: string (2–80 chars)<br>`phone`?: string<br>`avatarUrl`?: string (≤ 500 chars) |
| Success | 200 |
| Errors | `400 VALIDATION_FAILED` (including a foreign avatar URL). |
| App | `updateMe` |

### `PATCH /users/me/profile`

The customer's Complete Profile: date of birth, gender, street address, city (+ postal code, photo). Returns { user } with profileComplete.

| | |
|---|---|
| Access | bearer, customers only |
| Body / query | `dateOfBirth`: string<br>`gender`: 'male' \| 'female' \| 'other'<br>`streetAddress`: string (5–255 chars)<br>`city`: string (≤ 60 chars)<br>`postalCode`?: string<br>`avatarUrl`?: string (≤ 500 chars) |
| Success | 200 |
| Errors | `400 VALIDATION_FAILED` (`details.fields`), `403 FORBIDDEN` (not a customer). |
| App | `completeProfile` |

### `PUT /users/me/devices`

Register (or refresh) this install’s Expo push token.

| | |
|---|---|
| Access | bearer |
| Body / query | `expoPushToken`: string<br>`platform`: 'ios' \| 'android' |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.2 and §5 (error codes) |
| App | `registerDevice` |

### `DELETE /users/me/devices/{token}`

Forget a push token (call on sign-out). Idempotent.

| | |
|---|---|
| Access | bearer |
| Body / query | — |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.2 and §5 (error codes) |
| App | `unregisterDevice` |

## media

### `POST /media/sign-upload`

Signed params for ONE direct upload to Cloudinary, confined to metromatrix/{env}/{userId}/{purpose}.

| | |
|---|---|
| Access | bearer, 30 per minute |
| Body / query | `purpose`: 'avatar' \| 'business_document' \| 'product_image' \| 'store_branding' \| 'review_photo' \| 'return_photo' \| 'payment_proof' \| 'banner' \| 'doctor_photo' \| 'health_record' \| 'medical_note' |
| Success | 200 |
| Errors | `503 SERVICE_UNAVAILABLE` (uploads not configured). ### 4.3 Partner onboarding (role `partner` with a verified email) A customer calling any route here gets `403 FORBIDDEN`; an unverified partner gets `403 EMAIL_NOT_VERIFIED`. Status machine. Anything else gives `409 INVALID_TRANSITION` with `details: { from, to }`. ``` draft ──submit──▶ pending_approval ──approve──▶ approved ⇄ suspended (admin: suspend / reinstate) ▲ │ resubmit reject (admin) └────── rejected ``` |
| App | `signUpload` |

## auth

### `POST /auth/signup`

Register a customer or partner. Returns AuthResult and emails a verification link.

| | |
|---|---|
| Access | public, 20 per hour |
| Body / query | `email`: string<br>`password`: string (≥ 8 chars)<br>`displayName`: string (2–80 chars)<br>`phone`?: string<br>`role`: 'customer' \| 'partner' |
| Success | 201 |
| Errors | `409 EMAIL_EXISTS` (any letter case), `400 VALIDATION_FAILED`. **Why signup says the email is taken.** Unlike forgot-password (§4.1), which never reveals whether an account exists, signup answers `409 EMAIL_EXISTS`. That is a deliberate trade-off: - **The cost:** anyone can learn whether an address has a MetroMatrix account. - **Why it is accepted:** the person signing up needs to be told to sign in or reset their password instead. The alternative ("check your inbox" for everyone, plus an "you already have an account" email) needs a second email flow and confuses people who mistyped. Sign-in already answers the same question for an attacker with a password guess, so hiding it here alone would buy little. - **What limits it:** the route allows **20 requests per hour per client IP** (Express `trust proxy` = 1, so the IP is the caller's behind Heroku's router), which makes checking addresses in bulk slow. That limit is in memory, per dyno, so it scales with the number of dynos (see the throttling note at the start of §4). - **Revisit if** enumeration becomes a real problem: switch to the "always 201 + email the owner" flow. ```bash curl -X POST $API/auth/signup -H 'Content-Type: application/json' \ -d '{"email":"ayesha@example.com","password":"Secret123","displayName":"Ayesha Khan","role":"customer"}' ``` |
| App | `authSignup` |

### `POST /auth/signin`

Email + password on a portal. AuthResult, or { totpRequired, challengeToken } on the admin portal.

| | |
|---|---|
| Access | public, 5 per minute |
| Body / query | `email`: string<br>`password`: string<br>`portal`: 'customer' \| 'partner' \| 'admin' |
| Success | 200 |
| Errors | - `401 INVALID_CREDENTIALS`: the same answer for an unknown email and a wrong password. - `403 WRONG_PORTAL`: `details: { accountType, portal }`; the message names the right door. - `403 ACCOUNT_DISABLED`. - **Lockout:** 10 wrong passwords for one account within 15 minutes (from the first) lock the password sign-in until the window ends. While locked, **even the right password** gets the same `401 INVALID_CREDENTIALS`: the answer never says the account is locked, nor that a guess was right. A successful sign-in resets the count; a password reset lifts the lock. Trade-off: anyone who knows an address can lock its password sign-in for 15 minutes; Google sign-in and the reset flow still work. ```bash curl -X POST $API/auth/signin -H 'Content-Type: application/json' \ -d '{"email":"ayesha@example.com","password":"Secret123","portal":"customer"}' ``` |
| App | `authSignin` |

### `POST /auth/admin/totp`

Admin sign-in step 2: { challengeToken, code } or { challengeToken, recoveryCode } → AuthResult.

| | |
|---|---|
| Access | public, 5 per minute |
| Body / query | `challengeToken`: string<br>`code`?: string<br>`recoveryCode`?: string |
| Success | 200 |
| Errors | - `401 UNAUTHORIZED`: the challenge has expired or was already used; sign in again. - `401 TOTP_INVALID`: wrong, or already used. - `403 TOTP_REQUIRED`: not enrolled yet; `details.enrolmentRequired: true`. - `429 RATE_LIMITED` with `details.retryAfter` (seconds): 5 wrong codes (TOTP and recovery codes together) for the account within 15 minutes. The challenge is retired, and step 2 answers 429 even for a right code until the window ends. |
| App | `authAdminTotp` |

### `POST /auth/google`

Continue with Google (customer portal only). Links by Google id or verified email, or creates a verified customer.

| | |
|---|---|
| Access | public, 10 per minute, customer portal only |
| Body / query | `idToken`: string |
| Success | 200 |
| Errors | - `401 INVALID_CREDENTIALS`: bad or expired token. - `403 WRONG_PORTAL`: the email belongs to a partner or admin. - `403 EMAIL_NOT_VERIFIED`: Google has not verified the email. - `403 ACCOUNT_DISABLED`. - `503 SERVICE_UNAVAILABLE`: Google sign-in is not configured on the server. |
| App | `authGoogle` |

### `POST /auth/refresh-token`

Rotate a refresh token: a new { accessToken, refreshToken, expiresIn } in the same session.

| | |
|---|---|
| Access | public, 30 per minute |
| Body / query | `refreshToken`: string |
| Success | 200 |
| Errors | `401 REFRESH_INVALID` (unknown or expired), `401 REFRESH_REUSED` (see §3), `403 ACCOUNT_DISABLED`. |
| App | `refreshTokens (apiHelpers, single flight)` |

### `POST /auth/logout`

Sign this device out: revoke its session and the access token. Idempotent.

| | |
|---|---|
| Access | alias `POST /auth/signout`; public, self-authenticating |
| Body / query | — |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.1 and §5 (error codes) |
| App | `authLogout` |

### `POST /auth/signout`

Sign this device out: revoke its session and the access token. Idempotent.

| | |
|---|---|
| Access | bearer |
| Body / query | — |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.1 and §5 (error codes) |
| App | `— (alias of logout; the App uses /auth/logout)` |

### `POST /auth/verify-email`

The app's deep link: spend the emailed link's token. Public (the link may open the app signed out). Returns the owner's { user, business }; 400 VERIFY_LINK_INVALID.

| | |
|---|---|
| Access | public, 10 per 15 minutes |
| Body / query | `token`: string (≤ 200 chars) |
| Success | 200 |
| Errors | `400 VERIFY_LINK_INVALID` (unknown, or spent/expired while unverified), `400 VALIDATION_FAILED`. > Changed from Chunk 1: this endpoint took `{ "otp": "123456" }` with a bearer. The 6-digit > verification code is gone (the `email_verification_otps` table stays, unused). Password reset > still uses a 6-digit code. |
| App | `authVerifyEmail` |

### `POST /auth/resend-verification`

Email a fresh verification link (the old one stops working). 60 s cooldown (429 RESEND_COOLDOWN).

| | |
|---|---|
| Access | bearer, 5 per hour |
| Body / query | — |
| Success | 200 |
| Errors | `429 RESEND_COOLDOWN` with `details.retryAfter` (seconds). Show a countdown. |
| App | `authResendVerification` |

### `POST /auth/forgot-password`

Email a password-reset code. Always 200 { delivered: true } — no account enumeration.

| | |
|---|---|
| Access | public, 3 per 15 minutes |
| Body / query | `email`: string |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.1 and §5 (error codes) |
| App | `authForgotPassword` |

### `POST /auth/verify-otp`

Exchange the reset code for a single-use { resetToken }.

| | |
|---|---|
| Access | public, 10 per 15 minutes |
| Body / query | `email`: string<br>`otp`: string |
| Success | 200 |
| Errors | `400 OTP_INVALID` (with `attemptsLeft` when the account exists), `400 OTP_EXPIRED`, `400 OTP_LOCKED`. |
| App | `authVerifyResetOtp` |

### `POST /auth/reset-password`

Set a new password with the reset token. Signs the account out everywhere.

| | |
|---|---|
| Access | public, 5 per 15 minutes |
| Body / query | `resetToken`: string<br>`password`: string (≥ 8 chars) |
| Success | 200 |
| Errors | `400 OTP_INVALID` (token invalid, used or expired; start again), `400 VALIDATION_FAILED`. |
| App | `authResetPassword` |

### `POST /auth/change-password`

Change the password with currentPassword (a Google-only account sets its first one with a fresh idToken). Ends every session at once; returns { changed, tokens } for this device.

| | |
|---|---|
| Access | bearer, 10 per 15 minutes |
| Body / query | `currentPassword`?: string<br>`newPassword`: string (≥ 8 chars)<br>`idToken`?: string |
| Success | 200 |
| Errors | `403 INVALID_CREDENTIALS` (wrong current password, missing or mismatched Google token; it is 403, not 401, so your refresh logic is not triggered), `400 VALIDATION_FAILED`. > Changed from Chunk 1: the response was `{ "changed": true }` and this device's tokens stayed > valid; other devices' access tokens lived up to 15 more minutes; a Google-only account needed > no proof beyond the session. |
| App | `authChangePassword` |

### `DELETE /auth/account`

Delete the account (password, or a fresh Google idToken). Anonymises it and revokes every session.

| | |
|---|---|
| Access | bearer, 5 per 15 minutes |
| Body / query | `password`?: string<br>`idToken`?: string |
| Success | 200 |
| Errors | `403 INVALID_CREDENTIALS`. ### 4.2 Users and media |
| App | `authDeleteAccount` |

### `GET /auth/me`

The signed-in account: { user, business }.

| | |
|---|---|
| Access | bearer |
| Body / query | — |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.1 and §5 (error codes) |
| App | `authMe` |

## businesses

### `POST /businesses`

Create your business (status draft). 409 BUSINESS_EXISTS if you have one.

| | |
|---|---|
| Access | bearer |
| Body / query | `serviceType`: 'shopping' \| 'healthcare' \| 'food'<br>`subType`: 'store' \| 'doctor' \| 'restaurant' \| 'home_kitchen' \| 'cloud_kitchen'<br>`name`: string (2–120 chars)<br>`phone`: string<br>`city`: string (≤ 60 chars)<br>`addressLine`: string (≤ 255 chars)<br>`lat`?: number<br>`lng`?: number<br>`pmdcNumber`?: string |
| Success | 201 |
| Errors | `409 BUSINESS_EXISTS` (one business per partner account), `400 VALIDATION_FAILED`. `BusinessDetail`: ```json { "id": "…", "name": "Dr. Sana's Clinic", "slug": "dr-sanas-clinic-4f2a1", "serviceType": "healthcare", "subType": "doctor", "phone": "+924235761234", "city": "Lahore", "addressLine": "…", "lat": 31.520369, "lng": 74.358749, "status": "draft", "rejectionReason": null, "suspensionReason": null, "submittedAt": null, "reviewedAt": null, "createdAt": "…", "updatedAt": "…", "pmdcNumber": "12345-P", "documents": [ { "id": "…", "kind": "cnic_front", "url": "https://res.cloudinary.com/…", "publicId": "…", "status": "pending", "reviewNote": null, "createdAt": "…" } ], "requiredDocuments": [ { "kind": "cnic_front", "min": 1, "have": 1, "satisfied": true }, { "anyOf": ["ntn_certificate", "shop_photo"], "min": 1, "have": 0, "satisfied": false } ], "missingDocuments": ["cnic_back", "pmdc_certificate", "degree_certificate"] } ``` A doctor's business (*Chunk 3*) also carries `isListed` (the profile is published to patients) and `pmdcVerified` (staff have checked the PMDC number), here and on `GET /admin/businesses/:id`. Other businesses don't have these keys. The doctor app opens on practice set-up until `isListed` is true. |
| App | `createBusiness` |

### `GET /businesses/me`

Your business with its documents, requiredDocuments and missingDocuments.

| | |
|---|---|
| Access | bearer |
| Body / query | — |
| Success | 200 |
| Errors | `404 NOT_FOUND` (no business yet). |
| App | `getMyBusiness` |

### `PATCH /businesses/me`

Edit while draft or rejected; 409 BUSINESS_NOT_EDITABLE otherwise.

| | |
|---|---|
| Access | bearer |
| Body / query | `serviceType`?: 'shopping' \| 'healthcare' \| 'food'<br>`subType`?: 'store' \| 'doctor' \| 'restaurant' \| 'home_kitchen' \| 'cloud_kitchen'<br>`name`?: string (2–120 chars)<br>`phone`?: string<br>`city`?: string (≤ 60 chars)<br>`addressLine`?: string (≤ 255 chars)<br>`lat`?: number<br>`lng`?: number<br>`pmdcNumber`?: string |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.3 and §5 (error codes) |
| App | `updateMyBusiness` |

### `POST /businesses/me/documents`

Attach an uploaded document. The URL must be on our Cloudinary cloud, in your business_document folder.

| | |
|---|---|
| Access | bearer |
| Body / query | `kind`: 'cnic_front' \| 'cnic_back' \| 'pmdc_certificate' \| 'degree_certificate' \| 'ntn_certificate' \| 'shop_photo' \| 'pfa_licence' \| 'storefront_photo' \| 'kitchen_photo'<br>`url`: string<br>`publicId`: string |
| Success | 201 |
| Errors | not listed per endpoint; see API_AUTH.md §4.3 and §5 (error codes) |
| App | `addDocument (then GET /businesses/me)` |

### `DELETE /businesses/me/documents/{id}`

Remove a document (draft / rejected only).

| | |
|---|---|
| Access | bearer |
| Body / query | — |
| Success | 200 |
| Errors | `404 NOT_FOUND`. |
| App | `removeDocument (then GET /businesses/me)` |

### `POST /businesses/me/submit`

Submit for approval → pending_approval. 422 DOCUMENTS_MISSING lists what is missing.

| | |
|---|---|
| Access | bearer |
| Body / query | — |
| Success | 200 |
| Errors | - `422 DOCUMENTS_MISSING`, with: - `details.missing`: requirement keys, e.g. `["pmdc_certificate"]`. An any-of group is written `"ntn_certificate\|shop_photo"`. - `details.requirements`: the same rows as `requiredDocuments`. - `400 VALIDATION_FAILED` (`details.fields.pmdcNumber`): a doctor without a PMDC number. - `409 INVALID_TRANSITION`: already pending, approved or suspended. |
| App | `submitBusiness` |

### `GET /businesses/me/status`

{ status, rejectionReason, suspensionReason } — cheap, for polling.

| | |
|---|---|
| Access | bearer |
| Body / query | — |
| Success | 200 |
| Errors | - `400 TOTP_INVALID`. - `403 TOTP_REQUIRED`: a challenge cannot enrol an admin who already has TOTP. - `401 UNAUTHORIZED`. \| Method \| Path \| Body \| 200 data \| \|---\|---\|---\|---\| \| GET \| `/admin/businesses?status&serviceType&q&page&pageSize` \| — \| `{ items: [BusinessView + owner], total, page, pageSize }` \| \| GET \| `/admin/businesses/:id` \| — \| `BusinessDetail` + `owner` + `history` (audit) \| \| POST \| `/admin/businesses/:id/approve` \| — \| `BusinessDetail` (pending documents → accepted). A doctor whose PMDC number isn't verified yet → `422 PMDC_NOT_VERIFIED` (`details.doctorId`); verify it with `POST /admin/health/doctors/:doctorId/pmdc-verify` (see `docs/API_HEALTH.md`). \| \| POST \| `/admin/businesses/:id/reject` \| `{ reason, documentNotes?: [{ documentId, note }] }` \| `BusinessDetail` \| \| POST \| `/admin/businesses/:id/suspend` \| `{ reason }` \| `BusinessDetail` \| \| POST \| `/admin/businesses/:id/reinstate` \| `{ reason }` \| `BusinessDetail` \| \| GET \| `/admin/users?role&status&q&page&pageSize` \| — \| `{ items: [AuthUser + status, totpEnabled, lastLoginAt, createdAt], … }` \| \| POST \| `/admin/users/:id/disable` \| `{ reason? }` \| the user (all sessions revoked) \| \| POST \| `/admin/users/:id/enable` \| — \| the user \| How these behave: - `q` matches name, slug, city or owner email (businesses), and email, name or phone (users). `pageSize` is at most 100. - The partner is emailed on approve, reject (with the reason and per-document notes), suspend and reinstate. - Every write is recorded in `operational_audit_events`. - An admin cannot disable themselves (`403 FORBIDDEN`), and only a `super_admin` may disable another admin. ### 4.5 Health |
| App | `getMyBusinessStatus` |

## admin

### `GET /admin/businesses`

Businesses → { items, total, page, pageSize }.

| | |
|---|---|
| Access | bearer, admin / super_admin (after TOTP) |
| Body / query | query: page?, pageSize?, status?, serviceType?, q? |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.4 and §5 (error codes) |
| App | `listBusinesses` |

### `GET /admin/businesses/{id}`

One business with owner, documents, requirements and history.

| | |
|---|---|
| Access | bearer, admin / super_admin (after TOTP) |
| Body / query | — |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.4 and §5 (error codes) |
| App | `getBusiness` |

### `POST /admin/businesses/{id}/approve`

pending_approval → approved; emails the partner.

| | |
|---|---|
| Access | bearer, admin / super_admin (after TOTP) |
| Body / query | — |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.4 and §5 (error codes) |
| App | `approveBusiness` |

### `POST /admin/businesses/{id}/reject`

pending_approval → rejected with a reason (+ per-document notes); emails the partner.

| | |
|---|---|
| Access | bearer, admin / super_admin (after TOTP) |
| Body / query | `reason`: string (3–1000 chars)<br>`documentNotes`?: DocumentNoteDto[] { documentId, note } |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.4 and §5 (error codes) |
| App | `rejectBusiness` |

### `POST /admin/businesses/{id}/suspend`

approved → suspended; emails the partner.

| | |
|---|---|
| Access | bearer, admin / super_admin (after TOTP) |
| Body / query | `reason`: string |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.4 and §5 (error codes) |
| App | `suspendBusiness` |

### `POST /admin/businesses/{id}/reinstate`

suspended → approved; emails the partner.

| | |
|---|---|
| Access | bearer, admin / super_admin (after TOTP) |
| Body / query | `reason`: string |
| Success | 200 |
| Errors | not listed per endpoint; see API_AUTH.md §4.4 and §5 (error codes) |
| App | `reinstateBusiness` |

### `POST /admin/me/totp/enrol`

Start TOTP enrolment: { otpauthUri, qrDataUrl, secret }. Bearer: admin access token or first-time challenge token.

| | |
|---|---|
| Access | challenge token as bearer (first sign-in), or an admin access token (rotation) |
| Body / query | — |
| Success | 200 |
| Errors | `400 TOTP_INVALID`, `403 TOTP_REQUIRED` (a challenge cannot enrol an admin who already has TOTP), `401 UNAUTHORIZED` |
| App | `adminTotpEnrol` |

### `POST /admin/me/totp/confirm`

Confirm with a code → { recoveryCodes (shown once), auth }. With a challenge token, `auth` is the AuthResult.

| | |
|---|---|
| Access | challenge token as bearer (first sign-in), or an admin access token (rotation) |
| Body / query | `code`: string<br>`currentCode`?: string |
| Success | 200 |
| Errors | `400 TOTP_INVALID`, `403 TOTP_REQUIRED` (a challenge cannot enrol an admin who already has TOTP), `401 UNAUTHORIZED` |
| App | `adminTotpConfirm` |
