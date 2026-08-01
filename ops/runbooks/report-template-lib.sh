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

# Writes resolved template HTML to $1 (output file path).
report_template_load_html() {
  local out_file="$1"
  local repo
  repo="$(report_template_repo_root)"
  local content_ref=""
  local pg_conn
  pg_conn="$(report_template_pg_conn)"

  if [[ -n "${TEMPLATE_ID:-}" ]]; then
    content_ref="$(psql "${pg_conn}" -t -A -c "
      SELECT COALESCE(
        (
          SELECT rtv.content_ref
          FROM engagement_reporting.report_template_version rtv
          WHERE rtv.report_template_id = '${TEMPLATE_ID}'::uuid
          ORDER BY rtv.version_number DESC
          LIMIT 1
        ),
        ''
      );
    " 2>/dev/null | tr -d '\r' || true)"
  fi

  if [[ -z "${content_ref}" && -n "${APPLICATION_ID:-}" ]]; then
    content_ref="$(report_template_seed_for_app "${APPLICATION_ID}" || true)"
  fi

  [[ -n "${content_ref}" ]] || return 1

  if [[ "${content_ref}" == \<* ]]; then
    printf '%s' "${content_ref}" > "${out_file}"
    return 0
  fi

  local abs="${content_ref}"
  if [[ "${abs}" != /* ]]; then
    abs="${repo}/${content_ref}"
  fi

  if [[ -f "${abs}" ]]; then
    cp "${abs}" "${out_file}"
    return 0
  fi

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
