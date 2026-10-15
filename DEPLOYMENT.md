# Deploying MetroMatrix API to Heroku

Chunk 1 is ready to deploy. Nothing has been provisioned yet: the deploy, and any cost it
carries, is the owner's call. This runbook gets a fresh app live in about 15 minutes.

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
| Uploads | **Cloudinary free tier** | Partner documents and avatars upload straight from the phone. |
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

Both providers allow the `citext` extension, which the first migration creates.

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
- A daily cron (03:00 server time) prunes expired denylist entries, dead refresh tokens, old
  OTP rows and idempotency records.

## Verified locally (production mode)

- Image `metromatrix-api:local`, `node:22-alpine`, run as a non-root user.
- Run with `NODE_ENV=production` against an **empty** database via `DATABASE_URL` (the
  `sslmode=disable` opt-out covered the local Postgres).
- In that container: `run-migrations.js` applied all five migrations, the seed created the
  super admin, the Docker HEALTHCHECK passed, and the full collection ran green through Mailpit
  over authenticated SMTP.
