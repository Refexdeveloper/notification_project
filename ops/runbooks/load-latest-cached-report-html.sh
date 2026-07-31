#!/usr/bin/env bash
# Load the most recently cached report HTML for an application (fallback for test send).
set -Eeuo pipefail

APPLICATION_ID="${1:-}"
OUTPUT_FILE="${2:-}"
CACHE_PREFIX="${3:-}"

[[ -n "${APPLICATION_ID}" && -n "${OUTPUT_FILE}" ]] || exit 1

REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/ensure-report-html-cache-table.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

command -v psql >/dev/null 2>&1 || exit 1

mkdir -p "$(dirname "${OUTPUT_FILE}")"

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

prefix_clause=""
if [[ -n "${CACHE_PREFIX}" ]]; then
  prefix_clause="AND cache_key LIKE '$(sql_escape "${CACHE_PREFIX}")%'"
fi

TMP_OUT="${OUTPUT_FILE}.tmp"
rm -f "${TMP_OUT}"

psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1 -q <<SQL || exit 1
\\copy (
  SELECT html
  FROM engagement_reporting.report_html_cache
  WHERE application_id = '$(sql_escape "${APPLICATION_ID}")'
  ${prefix_clause}
  ORDER BY updated_at DESC
  LIMIT 1
) TO '${TMP_OUT}'
SQL

[[ -s "${TMP_OUT}" ]] || { rm -f "${TMP_OUT}"; exit 1; }
mv "${TMP_OUT}" "${OUTPUT_FILE}"
exit 0
