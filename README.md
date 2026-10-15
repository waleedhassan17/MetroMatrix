# MetroMatrix API

Backend for MetroMatrix — a zero-commission community marketplace with three services:
**Shopping**, **Healthcare** and **Food**. NestJS 10, TypeORM, PostgreSQL 16.

- API contracts for clients: [`docs/API_AUTH.md`](docs/API_AUTH.md) (auth, onboarding,
  admin) and [`docs/API_SHOPPING.md`](docs/API_SHOPPING.md) (Shopping)
- Architecture and conventions: [`CLAUDE.md`](CLAUDE.md)
- Deploying to Heroku: [`DEPLOYMENT.md`](DEPLOYMENT.md)

## Quick start

Requires Node 22 and Docker.

```bash
npm ci
cp .env.example .env        # then fill in values — see below
docker compose up -d --wait # Postgres on 127.0.0.1:5433, Mailpit on :1025 / http://localhost:8025
npm run migration:run
npm run seed:superadmin     # needs SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in .env
npm run seed:shopping       # optional demo stores; needs SEED_DEMO_PASSWORD (see seed/assets/shopping)
npm run start:dev           # http://localhost:3000/api/v1 · Swagger at /api/docs
```

Local `.env` values that work with `docker-compose.yml`:
`DB_HOST=localhost DB_PORT=5433 DB_USERNAME=metromatrix DB_PASSWORD=metromatrix_local_pw
DB_NAME=metromatrix MAIL_HOST=localhost MAIL_PORT=1025`. Generate `JWT_SECRET`,
`OTP_PEPPER` and `TOTP_ENC_KEY` with the commands in `.env.example`. With `MAIL_HOST`
pointed at Mailpit, every email (OTPs included) shows up at http://localhost:8025.

## Checks

```bash
npm run lint && npm run build
npm test                 # unit
npm run test:e2e         # e2e against metromatrix_test (dropped + re-migrated each run)
npm run migration:check  # entities and migrations agree
```
# MetroMatrix
