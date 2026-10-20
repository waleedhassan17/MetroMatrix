# Deploying MetroMatrix API to Heroku

Chunks 1 (auth, onboarding, admin), 2 (Shopping) and 3 (Healthcare) are ready to deploy. Nothing has been
provisioned yet: the deploy, and any cost it carries, is the owner's call. This runbook gets a fresh app live in about 15 minutes.

The production image was proven locally before writing this:
- production Docker build;
- `release` migrations into an empty database;
- seed;
- `/health`;
- the full Postman collection with `NODE_ENV=production`.

See "Verified locally" at the end.

## 0. Costs: pick before you start

Prices change. Check heroku.com/pricing and neon.tech/pricing on the day.

| Piece | Cheapest option | Notes |
|---|---|---|
| Web dyno | **Eco** (shared monthly hours) or **Basic** | Eco sleeps after 30 min idle; the first request after that is slow. If the account already pays for Eco (e.g. FinMatrix runs on Eco), another Eco app draws from the same pool. |
| Postgres | **Neon free tier** (no card, usage-limited) or Heroku Postgres `essential-0` (monthly) | Both work unchanged: the app reads `DATABASE_URL` and defaults SSL on. Neon's free tier is the zero-fixed-cost choice. |
| Email | **Brevo free tier** (daily send cap) | SMTP relay `smtp-relay.brevo.com:587`. Verify the sender domain/address in Brevo first. |
| Uploads | **Cloudinary free tier** | Partner documents and avatars upload straight from the phone. Health records and doctors' note files are `authenticated` (private) assets on the same account. |
| Video | **meet.jit.si** (free, no account) or **8x8 JaaS Developer** (25 monthly active users free) | Default `VIDEO_PROVIDER=public_jitsi` needs nothing; the doctor signs in on meet.jit.si to moderate. JaaS gives signed, moderated rooms. See `docs/VIDEO.md`. |
| Symptom checker model | **None** (keyword matcher) or a **Google Gemini API key** | Optional. Without `GEMINI_API_KEY`, red-flag rules plus the keyword matcher answer. With a key, check Google's free-tier and pricing terms on the day; only symptom text, age and gender are sent. |
| Errors | **Sentry free tier** (optional) | Leave `SENTRY_DSN` unset to disable. |

`app.json` lists `heroku-postgresql:essential-0` for Heroku Button/review apps only. A
plain `heroku create` provisions nothing.

## 1. Create the app

```bash
heroku login
heroku create metromatrix-api --stack heroku-24      # pick another name if it's taken
heroku buildpacks:set heroku/nodejs -a metromatrix-api
```

## 2. Database (choose one)

**Neon (free tier).** Create a project at neon.tech, copy the *pooled* connection string,
then:
```bash
heroku config:set -a metromatrix-api DATABASE_URL='postgres://USER:PASSWORD@HOST/neondb?sslmode=require'
```

**Heroku Postgres (paid).**
```bash
heroku addons:create heroku-postgresql:essential-0 -a metromatrix-api   # sets DATABASE_URL
```

Both providers allow the `citext` extension, which the first migration creates, and
**PostGIS**, which the first Food Court migration creates (`CREATE EXTENSION IF NOT EXISTS
postgis`; Neon and Heroku Postgres both support it on every plan). Locally,
`docker-compose.yml` runs `postgis/postgis:16-3.4`.

## 3. Config vars

Production boot **fails fast** if any of these are missing (see `src/config/env.validation.ts`):

```bash
gen() { node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"; }
heroku config:set -a metromatrix-api \
  NODE_ENV=production \
  APP_URL=https://metromatrix-api.herokuapp.com \
  CORS_ORIGINS=https://admin.metromatrix.pk \
  JWT_SECRET="$(gen)" \
  OTP_PEPPER="$(gen)" \
  TOTP_ENC_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  MAIL_HOST=smtp-relay.brevo.com MAIL_PORT=587 \
  MAIL_USER='<brevo smtp login>' MAIL_PASS='<brevo smtp key>' \
  MAIL_FROM='MetroMatrix <no-reply@metromatrix.pk>' \
  GOOGLE_CLIENT_IDS='<web id>,<android id>,<ios id>' \
  CLOUDINARY_CLOUD_NAME='<cloud>' CLOUDINARY_API_KEY='<key>' CLOUDINARY_API_SECRET='<secret>' \
  SWAGGER_ENABLED=false LOG_LEVEL=info
# optional
heroku config:set -a metromatrix-api SENTRY_DSN='https://…@sentry.io/…'
```

Rules:
- Never rotate `TOTP_ENC_KEY` casually: admin TOTP secrets are encrypted with it. If you must
  rotate it, run `seed:superadmin:prod -- --reset-totp` afterwards, so the admin re-enrols.
- `OTP_PEPPER` invalidates outstanding codes when changed. That is harmless; they last 10 minutes.
- `JWT_SECRET` signs everyone out when changed.
- Leave `DB_SYNCHRONIZE` unset. It is refused in production.
- `JOBS_ENABLED` defaults to true (Shopping's order deadlines, reminders, completion and
  low-stock digest). Each job takes a Postgres advisory lock, so several dynos are safe.
- `PUSH_ENABLED=true` once the app ships Expo push; until then notifications are in-app only.
- Healthcare jobs (prepaid-video auto-cancel, auto no-show, reminders, next-available
  refresh, the 07:00 doctor digest, nightly aggregates and symptom-text erasure) run under the
  same `JOBS_ENABLED` switch.
- Healthcare video and symptom checker (all optional):
  ```bash
  # JaaS instead of meet.jit.si (docs/VIDEO.md): all three are then required.
  heroku config:set -a metromatrix-api VIDEO_PROVIDER=jaas \
    JAAS_APP_ID='vpaas-magic-cookie-…' JAAS_KID='vpaas-magic-cookie-…/<key id>' \
    JAAS_PRIVATE_KEY="$(awk 'BEGIN{ORS="\\n"} {print}' jaas-private.pem)"
  # A model behind the symptom checker; leave unset for the keyword matcher.
  heroku config:set -a metromatrix-api GEMINI_API_KEY='<key>'   # optional GEMINI_MODEL
  ```

## 4. Deploy

```bash
git push heroku main
```

What runs:
- `heroku-postbuild`: `tsc --noEmit && nest build`. A type error fails the build.
- `release` (Procfile): `node dist/database/run-migrations.js`. A failed migration stops the
  release, and the previous version keeps serving.
- `web`: `node dist/main`, listening on Heroku's `$PORT`, with `trust proxy` set for the router.

## 5. Seed the super admin (once)

The credentials go in for one command only and never live in config:
```bash
heroku run -a metromatrix-api \
  --env "SUPER_ADMIN_EMAIL=you@metromatrix.pk;SUPER_ADMIN_PASSWORD=<strong password>" \
  npm run seed:superadmin:prod
```
Then sign in on the admin portal. Its first answer is `enrolmentRequired: true`: scan the QR
code and **store the 10 recovery codes**.

Lost the authenticator?
```bash
heroku run -a metromatrix-api \
  --env "SUPER_ADMIN_EMAIL=…;SUPER_ADMIN_PASSWORD=…" \
  npm run seed:superadmin:prod -- --reset-totp
```

### Demo stores (optional)

`seed:shopping` creates four demo store partners with products, coupons and banners — for a
demo or staging app, not for real customers. It refuses a production database unless asked:
```bash
heroku run -a metromatrix-api \
  --env "SEED_DEMO_PASSWORD=<strong password>" \
  npm run seed:shopping:prod -- --allow-production
```
With `CLOUDINARY_*` set it uploads generated image tiles (or licensed photos from
`seed/assets/shopping/`) into each partner's media folder. Without keys it needs
`--placeholder-images` and uses placehold.co URLs. Re-running only adds what's missing.

### Demo doctors (optional)

`seed:health` creates 30 fictional, PMDC-verified (`DEMO-` numbers) doctors in Lahore,
Karachi and Islamabad with clinics, hours, video for half, 8 demo patients, past visits and
reviews. The same flags and password rules apply:
```bash
heroku run -a metromatrix-api \
  --env "SEED_DEMO_PASSWORD=<strong password>" \
  npm run seed:health:prod -- --allow-production [--placeholder-images]
```
Each demo doctor gets a licensed stock portrait and the Health home five banners (Unsplash
License; `src/database/seeds/health/CREDITS.md`), uploaded to Cloudinary with keys, otherwise
stored as Unsplash URLs. Every demo profile says the doctor is fictional. A production
database should only get them for a demo, and never alongside real doctors.

### Demo food vendors (optional)

`seed:food` creates six fictional vendors in Lahore and Karachi (three restaurants, a cloud
kitchen, two home kitchens), 58 dishes, riders with usernames for three of them, six demo
customers, past orders, reviews and three home banners. Same flags and password rules:
```bash
heroku run -a metromatrix-api \
  --env "SEED_DEMO_PASSWORD=<strong password>" \
  npm run seed:food:prod -- --allow-production [--placeholder-images]
```
Every brand is made up and says so; logos are generated monograms; dish and cover photos
are Unsplash food photos (`src/database/seeds/food/CREDITS.md`).

### Demo kitchens (optional, after the food seed)

`seed:kitchen` gives three of those vendors a working kitchen: ingredients, recipe cards,
60 days of orders, purchases, waste, a sample of the PBS weekly prices for Lahore and
Karachi, forecasts and tonight's Bachat Box. Part 2 adds the growth demo:

- the Ramadan/Eid calendar (expected dates — confirm them after the moon sighting);
- a tiffin plan with subscribers and a quoted dawat request;
- kitchen stories, a signature dish and QR/storefront orders;
- anonymous demand data and a menu experiment.

Part 3 confirms the demo kitchens' nutrition mappings and adds a fictional demo grocer with
pack sizes (it needs `SEED_DEMO_PASSWORD`; placeholder images) and a demo pantry. The
nutrition reference foods (USDA SR Legacy, public domain) are loaded by a migration, so nothing
is downloaded at deploy time.

No uploads and no AI calls:
```bash
heroku run -a metromatrix-api npm run seed:kitchen:prod -- --allow-production
```

Set `STOREFRONT_BASE_URL` to the web storefront's address (the vendor's shareable link and
QR are `<base>/s/<slug>`); it defaults to `http://localhost:8081`.

### Kitchen AI (optional)

The kitchen's smart features (voice, receipt scan, packing check) use the same
`GEMINI_API_KEY` as the symptom checker, with their own model `AI_MODEL` (default
`gemini-3.5-flash`). Every feature works without it: set `AI_ENABLED=false`, or leave out the
key. The free tier allows about 20 requests per model per day — enough to try it, not for
real vendors. Allowances are 300 smart actions and 120 voice minutes per vendor a month
(`docs/AI.md`). Google Speech-to-Text and Text-to-Speech (`STT_PROVIDER` / `TTS_PROVIDER=google`)
need a billing account and are off by default.

## 6. Smoke test

```bash
curl -s https://metromatrix-api.herokuapp.com/api/v1/health
# {"success":true,"data":{"status":"ok","db":"up","version":"0.1.0+<commit>"}}
```

The Postman collection reads OTP codes from Mailpit, which only exists locally. Against Heroku,
open it in the Postman app with an environment whose `baseUrl` is the Heroku URL, and run it
folder by folder. When a "Mailpit: …" request fails, read the code from the real email and set
`customerOtp` / `partnerOtp` / `resetOtp` by hand. The health folder runs unattended:
```bash
npx newman@6.2.2 run postman/MetroMatrix-Auth.postman_collection.json \
  --env-var baseUrl=https://metromatrix-api.herokuapp.com/api/v1 --folder "0 · Health"
```

## 7. Operating

- Logs: `heroku logs -t -a metromatrix-api` (Pino JSON; authorization headers, passwords, OTPs
  and tokens are redacted).
- Roll back the code: `heroku releases:rollback -a metromatrix-api`. Migrations are not rolled
  back automatically; use `heroku run npm run migration:revert` only if the old code cannot run
  on the new schema.
- Scaling past one dyno: the rate limiter keeps its counters in memory per dyno. With more
  than one dyno, move it to Redis before relying on the limits.
- **Realtime (Food Court).** The Socket.IO gateway (namespace `/food`) runs in the web dyno;
  Heroku routes WebSockets with no extra setup. Clients connect with
  `transports: ['websocket']`; a dyno restart drops sockets and clients reconnect and resync
  from REST. With more than one dyno, add the Socket.IO Redis adapter (not provisioned) or
  events reach only the clients on the emitting dyno. Socket CORS follows `CORS_ORIGINS`.
- Food jobs (advisory-locked, idempotent, counts logged): every 30 s auto-reject unanswered
  orders and cancel unpaid transfers; every minute scheduled-order reminders and the
  2-minute accept nudge; 00:05 PKT today's portions reset; 03:30 PKT ratings, `sold30d` and
  the 14-day rider-location purge.
- A daily cron (03:00 server time) prunes expired denylist entries, dead refresh tokens, old
  OTP rows and idempotency records.
- Shopping jobs (advisory-locked, idempotent, counts logged): every 10 min cancel unpaid
  transfer orders past their 24 h deadline; hourly reminders; 03:00 PKT complete delivered
  orders past their return window; 09:00 PKT low-stock digest.
- Sign-in is rate-limited per client address (in memory, per dyno). Running both Postman
  collections back to back from one machine can hit it; wait out the window or run them
  against a freshly started process.

## Verified locally (production mode)

- Image `metromatrix-api:local`, `node:22-alpine`, run as a non-root user.
- Run with `NODE_ENV=production` against an **empty** database via `DATABASE_URL` (the
  `sslmode=disable` opt-out covered the local Postgres).
- In that container: `run-migrations.js` applied all five migrations, the seed created the
  super admin, the Docker HEALTHCHECK passed, and the full collection ran green through Mailpit
  over authenticated SMTP.

### Chunk 2 (Shopping), same procedure

- Image rebuilt (`docker build -t metromatrix-api:local .`), run with `NODE_ENV=production`
  against an **empty** database (`DATABASE_URL=…?sslmode=disable`), SMTP to Mailpit with a login.
- `run-migrations.js` applied all twelve migrations; `seed:superadmin:prod` created the admin;
  `seed:shopping:prod` refused without `--allow-production`, then with
  `--allow-production --placeholder-images` created 4 partners, 72 products, 149 variants,
  8 coupons, 8 collections, 7 payment accounts and 3 banners.
- Docker HEALTHCHECK `healthy`; `/health` ok; no error-level log lines with jobs enabled.
- `MetroMatrix-Auth`: 38 requests / 102 assertions green. `MetroMatrix-Shopping`: 89
  requests / 256 assertions green (after a restart: run straight after the Auth collection
  from the same address, its partner sign-ins were correctly rate-limited).

### Chunk 3 (Healthcare), same procedure (16 October 2026)

- Image rebuilt (`docker build -t metromatrix-api:local .`) and run with `NODE_ENV=production`
  against an **empty** database (`DATABASE_URL=…?sslmode=disable`), SMTP to Mailpit with a
  login, `VIDEO_PROVIDER=public_jitsi`, no `GEMINI_API_KEY`, jobs enabled.
- `run-migrations.js` applied all twenty migrations. `seed:superadmin:prod` created the admin.
  `seed:shopping:prod --allow-production --placeholder-images` created the demo stores.
- `seed:health:prod`:
  - refused without `--allow-production`;
  - with `--allow-production` alone it tried to upload avatars with the rehearsal's dummy
    Cloudinary keys. Cloudinary rejected the first one ("Unknown API key"), so nothing was
    uploaded and that doctor's transaction rolled back;
  - with `--allow-production --placeholder-images`, created 30 doctors, 55 locations,
    930 completed visits and 637 reviews (and 8 patients);
  - all 30 doctors got a next-available time; 2 got the top-booked badge.
- Docker HEALTHCHECK `healthy`; `/health` ok; no error-level log lines.
- `MetroMatrix-Auth` 40 requests / 109 assertions, `MetroMatrix-Shopping` 89 / 256 and
  `MetroMatrix-Health` 71 / 218: all green, with the container restarted between collections
  (the per-address sign-in limit).

### Chunk 4 (Food Court), same procedure (18 October 2026)

- Image rebuilt (`docker build -t metromatrix-api:local .`) and run with `NODE_ENV=production`
  against an **empty** database on the PostGIS image (`DATABASE_URL=…?sslmode=disable`),
  host networking, SMTP to Mailpit with a login, jobs enabled, push off, a dummy
  `GOOGLE_CLIENT_IDS` (production requires one).
- `run-migrations.js` applied all 29 migrations (PostGIS created by the first Food one).
  `seed:superadmin:prod`, then `seed:shopping:prod`, `seed:health:prod` and
  `seed:food:prod` with `--allow-production --placeholder-images` (the Food seed refused
  without `--allow-production`): 6 vendors, 58 dishes, 6 riders, 6 customers, 75 orders,
  48 reviews, 6 promotions, 3 banners.
- Docker HEALTHCHECK `healthy`; `/health` ok; no error-level log lines; the food jobs logged
  their counts every 30 s.
- `MetroMatrix-Auth` 40 requests / 109 assertions, `MetroMatrix-Shopping` 89 / 256,
  `MetroMatrix-Health` 80 / 247 and `MetroMatrix-Food` 66 / 204: all green, the container
  restarted between collections. `npm run socket:food`: every realtime check passed.
- Both again with the demo vendor closed (a temporary closure): the order was scheduled for
  half an hour after opening and walked to delivered; all green.

### Chunk 5A (Kitchen Intelligence: vendor operations), same procedure (19 October 2026)

- Image rebuilt (`docker build -t metromatrix-api:local .`; the AI prompts are copied into
  `dist`) and run with `NODE_ENV=production` against an **empty** database on the PostGIS
  image (`DATABASE_URL=…?sslmode=disable`). Host networking, port 3200, SMTP to Mailpit with
  a login, jobs enabled, push off, dummy Google and Cloudinary keys, **`AI_ENABLED=false`
  and no `GEMINI_API_KEY`** (the deterministic run).
- `run-migrations.js` applied all 35 migrations. Then `seed:superadmin:prod`,
  `seed:shopping:prod`, `seed:health:prod` and `seed:food:prod` (`--allow-production
  --placeholder-images`).
- `seed:kitchen:prod` refused without `--allow-production`. With it, it created 48
  ingredients, 32 recipe cards, 1,525 history orders, 135 purchases, 27 waste entries,
  208 SPI prices, 224 forecasts and 1 Bachat Box.
- Docker HEALTHCHECK `healthy`; `/health` ok; no error-level log lines; the kitchen and food
  jobs ran (auto-resume, surplus expiry).
- All green, with the container restarted between collections:

  | Collection | Requests | Assertions |
  |---|---|---|
  | `MetroMatrix-Auth` | 40 | 109 |
  | `MetroMatrix-Shopping` | 89 | 256 |
  | `MetroMatrix-Health` | 80 | 247 |
  | `MetroMatrix-Food` | 66 | 204 |
  | `MetroMatrix-Kitchen` | 59 | 171 |

  `npm run socket:food`: every realtime check passed.
- Teardown: container removed, database dropped, the env file deleted, the local Postman
  environment restored.
- AI on: the real-model check is `npm run voice:eval` (`docs/VOICE.md`). This key's
  free-tier daily quota was used by the eval that day.

### Chunk 5B (Kitchen Intelligence: growth), same procedure (19 October 2026)

- Image rebuilt and run with `NODE_ENV=production` against an **empty** PostGIS database: host
  networking, port 3200, SMTP to Mailpit with a login, jobs enabled, push off, dummy Google
  and Cloudinary keys, `AI_ENABLED=false` and no `GEMINI_API_KEY`, and
  `STOREFRONT_BASE_URL=https://storefront.rehearsal.test`.
- `run-migrations.js` applied all 39 migrations. Then `seed:superadmin:prod`,
  `seed:shopping:prod`, `seed:health:prod` and `seed:food:prod` (`--allow-production
  --placeholder-images`).
- `seed:kitchen:prod` refused without `--allow-production`. With it:
  - part 1 as in 5A (no Bachat Box: the run was after that evening's pickup window);
  - part 2: 4 calendar events, 1 tiffin plan with 2 subscribers, 1 quoted dawat request,
    2 kitchen stories, 1 signature dish, 138 QR/storefront orders, 420 anonymous search
    events → 166 demand cells, and 1 running experiment.
- Docker HEALTHCHECK `healthy`; `/health` ok; no error-level log lines; the growth and kitchen
  jobs ran.
- All green, with the container restarted between collections:

  | Collection | Requests | Assertions |
  |---|---|---|
  | `MetroMatrix-Auth` | 40 | 109 |
  | `MetroMatrix-Shopping` | 89 | 256 |
  | `MetroMatrix-Health` | 80 | 247 |
  | `MetroMatrix-Food` | 66 | 204 |
  | `MetroMatrix-Kitchen` | 103 | 305 |

  `npm run socket:food`: every realtime check passed.
- Teardown: container removed, database dropped, the env file deleted, the local Postman
  environment restored.
