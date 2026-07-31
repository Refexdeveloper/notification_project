#!/usr/bin/env bash
# Store rendered report HTML in PostgreSQL for fast test sends (no Kissflow refresh).
set -Eeuo pipefail

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

REPORT_FILE="${1:-${REPORT_FILE_OVERRIDE:-}}"
CACHE_KEY="${2:-${REPORT_CACHE_KEY:-}}"
APPLICATION_ID="${APPLICATION_ID:-}"

[[ -n "${REPORT_FILE}" && -f "${REPORT_FILE}" ]] || exit 0
[[ -n "${CACHE_KEY}" ]] || exit 0

if ! command -v psql >/dev/null 2>&1; then
  log "psql not available — skipping report HTML cache"
  exit 0
fi

PSQL=(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1)
BYTE_SIZE="$(wc -c < "${REPORT_FILE}" | tr -d ' ')"
TAG="report_html_$(date +%s)_$$"

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

"${PSQL[@]}" -c "
CREATE TABLE IF NOT EXISTS engagement_reporting.report_html_cache (
  cache_key      text PRIMARY KEY,
  application_id text NOT NULL,
  html           text NOT NULL,
  byte_size      bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
"

{
  printf "INSERT INTO engagement_reporting.report_html_cache (cache_key, application_id, html, byte_size, updated_at)\n"
  printf "VALUES (\n"
  printf "  '%s',\n" "$(sql_escape "${CACHE_KEY}")"
  printf "  '%s',\n" "$(sql_escape "${APPLICATION_ID}")"
  printf "  \$%s\$\n" "${TAG}"
  cat "${REPORT_FILE}"
  printf "\n\$%s\$,\n" "${TAG}"
  printf "  %s,\n" "${BYTE_SIZE}"
  printf "  now()\n"
  printf ")\n"
  printf "ON CONFLICT (cache_key) DO UPDATE SET\n"
  printf "  application_id = EXCLUDED.application_id,\n"
  printf "  html = EXCLUDED.html,\n"
  printf "  byte_size = EXCLUDED.byte_size,\n"
  printf "  updated_at = now();\n"
} | "${PSQL[@]}"

log "Cached report HTML in PostgreSQL: key=${CACHE_KEY} bytes=${BYTE_SIZE}"
