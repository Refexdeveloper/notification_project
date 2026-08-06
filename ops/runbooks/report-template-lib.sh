#!/usr/bin/env bash
# Shared helpers: load published template HTML from PostgreSQL (or seed fallback) and render placeholders.

report_template_repo_root() {
  local lib_dir candidate override
  override="${REPO_ROOT_OVERRIDE:-}"

  if [[ -n "${override}" && -d "${override}/db/seeds" ]]; then
    printf '%s' "${override}"
    return 0
  fi

  if [[ -n "${REPO_ROOT:-}" && -d "${REPO_ROOT}/db/seeds" ]]; then
    printf '%s' "${REPO_ROOT}"
    return 0
  fi

  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for candidate in \
    "$(cd "${lib_dir}/../.." && pwd)" \
    "$(cd "${lib_dir}/../../.." && pwd)" \
    "${override}" \
    "${REPO_ROOT:-}" \
    "/app"; do
    [[ -n "${candidate}" && -d "${candidate}/db/seeds" ]] || continue
    printf '%s' "${candidate}"
    return 0
  done

  printf '%s' "${override:-${REPO_ROOT:-/app}}"
}

report_template_pg_conn() {
  printf 'host=%s port=%s dbname=%s user=%s' \
    "${PGHOST:-localhost}" "${PGPORT:-5432}" "${PGDATABASE:-engagement_reporting}" "${PGUSER:-postgres}"
}

report_template_seed_for_app() {
  case "${1:-}" in
    IT_Service_Management_A00) printf '%s' 'db/seeds/itsm-engagement-template.html' ;;
    Project_Management_Tracker_A00) printf '%s' 'db/seeds/pm-engagement-template.html' ;;
    Lead_Trcaker_A00) printf '%s' 'db/seeds/lead-tracker-report-template.html' ;;
    *) return 1 ;;
  esac
}

report_template_file_looks_like_html() {
  local f="$1"
  [[ -s "${f}" ]] || return 1
  local head
  head="$(head -c 64 "${f}" | tr -d '\r' | sed 's/^[[:space:]]*//')"
  [[ "${head}" == \<* ]]
}

# Decode base64 payload from psql (-t -A) into $1. Avoids COPY text-format escaping
# which turns real newlines into literal "\n" visible in the emailed HTML.
report_template_decode_b64_to_file() {
  local out_file="$1"
  local b64
  b64="$(tr -d '\r\n[:space:]')"
  [[ -n "${b64}" ]] || return 1
  if command -v base64 >/dev/null 2>&1; then
    if printf '%s' "${b64}" | base64 --decode > "${out_file}" 2>/dev/null; then
      return 0
    fi
    if printf '%s' "${b64}" | base64 -d > "${out_file}" 2>/dev/null; then
      return 0
    fi
    if printf '%s' "${b64}" | base64 -D > "${out_file}" 2>/dev/null; then
      return 0
    fi
  fi
  # Fallback when base64 CLI is unavailable (Node is always present in schedule-runner).
  B64_PAYLOAD="${b64}" OUT_FILE="${out_file}" node -e \
    "require('fs').writeFileSync(process.env.OUT_FILE, Buffer.from(process.env.B64_PAYLOAD, 'base64'))" \
    2>/dev/null
}

# Prefer published inline HTML over stale seed file paths.
# Writes resolved template HTML to $1 (output file path).
report_template_load_html() {
  local out_file="$1"
  local repo
  repo="$(report_template_repo_root)"
  local pg_conn
  pg_conn="$(report_template_pg_conn)"
  local loaded=0
  local b64_tmp
  b64_tmp="$(mktemp)"

  # Stream latest template version as base64 (avoids shell truncation AND COPY \n escaping).
  if [[ -n "${TEMPLATE_ID:-}" ]]; then
    if psql "${pg_conn}" -v ON_ERROR_STOP=1 -t -A -c "
      SELECT encode(convert_to(content_ref, 'UTF8'), 'base64')
      FROM engagement_reporting.report_template_version
      WHERE report_template_id = '${TEMPLATE_ID}'::uuid
      ORDER BY
        CASE
          WHEN ltrim(content_ref) LIKE '<!%' THEN 0
          WHEN ltrim(content_ref) ILIKE '<html%' THEN 0
          WHEN ltrim(content_ref) LIKE '<%' THEN 0
          ELSE 1
        END,
        version_number DESC
      LIMIT 1
    " > "${b64_tmp}" 2>/dev/null \
      && report_template_decode_b64_to_file "${out_file}" < "${b64_tmp}" \
      && report_template_file_looks_like_html "${out_file}"; then
      loaded=1
    fi
  fi

  # Fallback: latest published template bound to this application (inline preferred).
  if [[ "${loaded}" -ne 1 && -n "${APPLICATION_ID:-}" ]]; then
    if psql "${pg_conn}" -v ON_ERROR_STOP=1 -t -A -c "
      SELECT encode(convert_to(rtv.content_ref, 'UTF8'), 'base64')
      FROM engagement_reporting.report_template_version rtv
      JOIN engagement_reporting.report_definition_version rdv
        ON rdv.config->>'template_id' = rtv.report_template_id::text
      WHERE rdv.config->>'application_id' = '${APPLICATION_ID}'
        AND COALESCE(rdv.config->>'status', 'published') = 'published'
      ORDER BY
        CASE
          WHEN ltrim(rtv.content_ref) LIKE '<!%' THEN 0
          WHEN ltrim(rtv.content_ref) ILIKE '<html%' THEN 0
          WHEN ltrim(rtv.content_ref) LIKE '<%' THEN 0
          ELSE 1
        END,
        rtv.version_number DESC,
        rdv.frozen_at DESC NULLS LAST
      LIMIT 1
    " > "${b64_tmp}" 2>/dev/null \
      && report_template_decode_b64_to_file "${out_file}" < "${b64_tmp}" \
      && report_template_file_looks_like_html "${out_file}"; then
      loaded=1
    fi
  fi

  rm -f "${b64_tmp}"

  if [[ "${loaded}" -eq 1 ]]; then
    return 0
  fi

  # Legacy: content_ref is a seed file path — copy from disk (may be stale vs Admin UI publish).
  local content_ref=""
  if [[ -n "${TEMPLATE_ID:-}" ]]; then
    content_ref="$(psql "${pg_conn}" -t -A -c "
      SELECT COALESCE((
        SELECT rtv.content_ref
        FROM engagement_reporting.report_template_version rtv
        WHERE rtv.report_template_id = '${TEMPLATE_ID}'::uuid
          AND ltrim(rtv.content_ref) NOT LIKE '<!%'
          AND ltrim(rtv.content_ref) NOT ILIKE '<html%'
          AND ltrim(rtv.content_ref) NOT LIKE '<%'
        ORDER BY rtv.version_number DESC
        LIMIT 1
      ), '');
    " 2>/dev/null | tr -d '\r' | head -c 512 || true)"
  fi

  if [[ -z "${content_ref}" || "${content_ref}" == \<* ]]; then
    content_ref="$(report_template_seed_for_app "${APPLICATION_ID:-}" || true)"
  fi

  [[ -n "${content_ref}" ]] || { rm -f "${out_file}"; return 1; }

  local abs="${content_ref}"
  if [[ "${abs}" != /* ]]; then
    abs="${repo}/${content_ref}"
  fi

  if [[ -f "${abs}" ]]; then
    cp "${abs}" "${out_file}"
    return 0
  fi

  rm -f "${out_file}"
  return 1
}

# Renders placeholders using apply-report-template.js
# Args: $1=output_html $2=vars_json_file $3=source_template_html_file
report_template_render() {
  local output_file="$1"
  local vars_file="$2"
  local template_file="$3"
  local repo script
  repo="$(report_template_repo_root)"
  script="${repo}/services/engagement-pipeline/scripts/apply-report-template.js"

  [[ -f "${script}" ]] || return 1
  [[ -f "${template_file}" ]] || return 1
  [[ -f "${vars_file}" ]] || return 1

  TEMPLATE_HTML_IN="${template_file}" \
  TEMPLATE_VARS_JSON="${vars_file}" \
  TEMPLATE_HTML_OUT="${output_file}" \
  node "${script}"
}
