#!/usr/bin/env bash
# Load cached report HTML from PostgreSQL into a local file for test send.
# Uses base64 so PostgreSQL COPY text escaping cannot inject literal "\n" into HTML.
set -Eeuo pipefail

CACHE_KEY="${1:-}"
OUTPUT_FILE="${2:-}"

[[ -n "${CACHE_KEY}" && -n "${OUTPUT_FILE}" ]] || exit 1

REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
if [[ ! -f "${REPO_ROOT}/ops/runbooks/ensure-report-html-cache-table.sh" ]]; then
  REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
fi
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/ensure-report-html-cache-table.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

command -v psql >/dev/null 2>&1 || exit 1

mkdir -p "$(dirname "${OUTPUT_FILE}")"

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

TMP_B64="${OUTPUT_FILE}.b64.tmp"
TMP_OUT="${OUTPUT_FILE}.tmp"
rm -f "${TMP_B64}" "${TMP_OUT}"

psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" \
  -v ON_ERROR_STOP=1 -t -A -c "
  SELECT encode(convert_to(html, 'UTF8'), 'base64')
  FROM engagement_reporting.report_html_cache
  WHERE cache_key = '$(sql_escape "${CACHE_KEY}")'
  LIMIT 1
" > "${TMP_B64}" || { rm -f "${TMP_B64}"; exit 1; }

B64="$(tr -d '\r\n[:space:]' < "${TMP_B64}")"
rm -f "${TMP_B64}"
[[ -n "${B64}" ]] || exit 1

if ! printf '%s' "${B64}" | base64 --decode > "${TMP_OUT}" 2>/dev/null \
  && ! printf '%s' "${B64}" | base64 -d > "${TMP_OUT}" 2>/dev/null \
  && ! printf '%s' "${B64}" | base64 -D > "${TMP_OUT}" 2>/dev/null; then
  B64_PAYLOAD="${B64}" OUT_FILE="${TMP_OUT}" node -e \
    "require('fs').writeFileSync(process.env.OUT_FILE, Buffer.from(process.env.B64_PAYLOAD, 'base64'))" \
    || { rm -f "${TMP_OUT}"; exit 1; }
fi

[[ -s "${TMP_OUT}" ]] || { rm -f "${TMP_OUT}"; exit 1; }
mv "${TMP_OUT}" "${OUTPUT_FILE}"
exit 0
