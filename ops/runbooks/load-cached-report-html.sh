#!/usr/bin/env bash
# Load cached report HTML from PostgreSQL into a local file for test send.
set -Eeuo pipefail

CACHE_KEY="${1:-}"
OUTPUT_FILE="${2:-}"

[[ -n "${CACHE_KEY}" && -n "${OUTPUT_FILE}" ]] || exit 1

REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/ensure-report-html-cache-table.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

command -v psql >/dev/null 2>&1 || exit 1

mkdir -p "$(dirname "${OUTPUT_FILE}")"

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

TMP_OUT="${OUTPUT_FILE}.tmp"
rm -f "${TMP_OUT}"

psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1 -q <<SQL || exit 1
\\copy (SELECT html FROM engagement_reporting.report_html_cache WHERE cache_key = '$(sql_escape "${CACHE_KEY}")' LIMIT 1) TO '${TMP_OUT}'
SQL

[[ -s "${TMP_OUT}" ]] || { rm -f "${TMP_OUT}"; exit 1; }
mv "${TMP_OUT}" "${OUTPUT_FILE}"
exit 0
