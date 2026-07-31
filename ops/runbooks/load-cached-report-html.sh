#!/usr/bin/env bash
# Load last cached report HTML from PostgreSQL into a local file for test send.
set -Eeuo pipefail

CACHE_KEY="${1:-}"
OUTPUT_FILE="${2:-}"

[[ -n "${CACHE_KEY}" && -n "${OUTPUT_FILE}" ]] || exit 1

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

command -v psql >/dev/null 2>&1 || exit 1

mkdir -p "$(dirname "${OUTPUT_FILE}")"

HTML_B64="$(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -t -A -c "
SELECT encode(convert_to(html, 'UTF8'), 'base64')
FROM engagement_reporting.report_html_cache
WHERE cache_key = '$(printf '%s' "${CACHE_KEY}" | sed "s/'/''/g")'
LIMIT 1;
" | tr -d '[:space:]')"

[[ -n "${HTML_B64}" ]] || exit 1

printf '%s' "${HTML_B64}" | base64 -d > "${OUTPUT_FILE}"
[[ -s "${OUTPUT_FILE}" ]] || exit 1
exit 0
