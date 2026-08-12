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

# Prefer explicit repo root from Cloud Run (REPO_ROOT=/app). Falling back to
# dirname/.. of this file yields /app/ops (wrong) and breaks ensure-* sourcing.
REPO_ROOT="${REPO_ROOT_OVERRIDE:-${REPO_ROOT:-}}"
if [[ -z "${REPO_ROOT}" || ! -d "${REPO_ROOT}/ops/runbooks" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/ensure-report-html-cache-table.sh"

if ! command -v psql >/dev/null 2>&1; then
  log "psql not available — skipping report HTML cache"
  exit 0
fi

PSQL=(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1)
BYTE_SIZE="$(wc -c < "${REPORT_FILE}" | tr -d ' ')"
TAG="report_html_$(date +%s)_$$"

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

cache_one_key() {
  local key="$1"
  local tag="${TAG}_$(printf '%s' "${key}" | tr -cs 'A-Za-z0-9' '_')"
  {
    printf "INSERT INTO engagement_reporting.report_html_cache (cache_key, application_id, html, byte_size, updated_at)\n"
    printf "VALUES (\n"
    printf "  '%s',\n" "$(sql_escape "${key}")"
    printf "  '%s',\n" "$(sql_escape "${APPLICATION_ID}")"
    printf "  \$%s\$\n" "${tag}"
    cat "${REPORT_FILE}"
    printf "\n\$%s\$,\n" "${tag}"
    printf "  %s,\n" "${BYTE_SIZE}"
    printf "  now()\n"
    printf ")\n"
    printf "ON CONFLICT (cache_key) DO UPDATE SET\n"
    printf "  application_id = EXCLUDED.application_id,\n"
    printf "  html = EXCLUDED.html,\n"
    printf "  byte_size = EXCLUDED.byte_size,\n"
    printf "  updated_at = now();\n"
  } | "${PSQL[@]}"
}

cache_one_key "${CACHE_KEY}"

if [[ -n "${REPORT_CACHE_KEY_SCHEDULE:-}" && "${REPORT_CACHE_KEY_SCHEDULE}" != "${CACHE_KEY}" ]]; then
  cache_one_key "${REPORT_CACHE_KEY_SCHEDULE}"
fi

log "Cached report HTML in PostgreSQL: key=${CACHE_KEY} bytes=${BYTE_SIZE}"
