#!/usr/bin/env bash
# Run a Postman collection with newman against a local server + Mailpit.
#
#   npm run postman:local                       # Auth collection, http://localhost:3000/api/v1
#   npm run postman:shopping                    # Shopping collection (needs seed:shopping)
#   BASE_URL=http://localhost:3100/api/v1 npm run postman:local
#
# The demo partners' password comes from SEED_DEMO_PASSWORD the same way.
#
# The admin password comes from SUPER_ADMIN_PASSWORD (env, or .env) and is
# passed on the command line — it is never written into the committed
# environment file. The admin's TOTP secret, created on the first run, is kept
# in the git-ignored postman/*.local.json so later runs can sign in with it.
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_PASSWORD="${SUPER_ADMIN_PASSWORD:-$(grep -E '^SUPER_ADMIN_PASSWORD=' .env 2>/dev/null | cut -d= -f2- || true)}"
ADMIN_EMAIL="${SUPER_ADMIN_EMAIL:-$(grep -E '^SUPER_ADMIN_EMAIL=' .env 2>/dev/null | cut -d= -f2- || true)}"
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "Set SUPER_ADMIN_PASSWORD (env or .env) first." >&2
  exit 1
fi

DEMO_PASSWORD="${SEED_DEMO_PASSWORD:-$(grep -E '^SEED_DEMO_PASSWORD=' .env 2>/dev/null | cut -d= -f2- || true)}"
case "${COLLECTION:-auth}" in
  auth) FILE=postman/MetroMatrix-Auth.postman_collection.json ;;
  shopping)
    FILE=postman/MetroMatrix-Shopping.postman_collection.json
    if [ -z "$DEMO_PASSWORD" ]; then
      echo "Set SEED_DEMO_PASSWORD (env or .env) — the password seed:shopping gave the demo partners." >&2
      exit 1
    fi ;;
  *) echo "COLLECTION must be auth or shopping" >&2; exit 1 ;;
esac

ENV_BASE=postman/MetroMatrix-Local.postman_environment.json
ENV_LOCAL=postman/MetroMatrix-Local.postman_environment.local.json
ENV_IN="$ENV_BASE"
[ -f "$ENV_LOCAL" ] && ENV_IN="$ENV_LOCAL"

npx --yes newman@6.2.2 run "$FILE" \
  -e "$ENV_IN" \
  --env-var "baseUrl=${BASE_URL:-http://localhost:3000/api/v1}" \
  --env-var "mailpitUrl=${MAILPIT_URL:-http://localhost:8025}" \
  --env-var "adminEmail=${ADMIN_EMAIL:-admin@metromatrix.local}" \
  --env-var "adminPassword=$ADMIN_PASSWORD" \
  --env-var "demoPassword=$DEMO_PASSWORD" \
  --export-environment "$ENV_LOCAL" \
  "$@"
