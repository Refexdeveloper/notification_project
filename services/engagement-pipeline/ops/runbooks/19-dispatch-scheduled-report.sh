#!/usr/bin/env bash
# Route PostgreSQL schedule_id → app-specific render + send runbook.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)}"
if [[ -z "${REPO_ROOT}" || ! -f "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
fi

SCHEDULE_ID="${SCHEDULE_ID:-}"
export SCHEDULE_ID

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || stop "psql is not installed."
command -v jq >/dev/null 2>&1 || stop "jq is not installed."
[[ -n "${SCHEDULE_ID}" ]] || stop "SCHEDULE_ID is required"

log "Loading schedule ${SCHEDULE_ID} from PostgreSQL"
SCHEDULE_JSON="$(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -t -A -c "
  SELECT row_to_json(t)::text FROM (
    SELECT
      rs.report_schedule_id::text AS schedule_id,
      rd.name AS schedule_name,
      rdv.config->>'application_id' AS application_id,
      rdv.config->>'process_id' AS process_id,
      rdv.config->>'template_id' AS template_id,
      rdv.config->>'template_name' AS template_name,
      (
        SELECT tb.config->>'application_id'
        FROM engagement_reporting.report_definition_version tb
        WHERE tb.config->>'template_id' = rdv.config->>'template_id'
          AND tb.config->>'application_id' IS NOT NULL
        ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
        LIMIT 1
      ) AS template_application_id,
      rdv.config->>'subject' AS subject,
      rdv.config->>'from_email' AS from_email,
      rdv.config->>'website_filter' AS website_filter,
      rdv.config->>'user_group_filter' AS user_group_filter,
      rdv.config->>'entity_filter' AS entity_filter,
      rdv.config->>'group_slug' AS group_slug,
      COALESCE(
        json_agg(DISTINCT rr.recipient_email) FILTER (WHERE rr.recipient_type = 'TO'),
        '[]'::json
      ) AS recipients_to,
      COALESCE(
        json_agg(DISTINCT rr.recipient_email) FILTER (WHERE rr.recipient_type = 'CC'),
        '[]'::json
      ) AS recipients_cc
    FROM engagement_reporting.report_schedule rs
    JOIN engagement_reporting.report_definition_version rdv
      ON rdv.report_definition_version_id = rs.report_definition_version_id
    JOIN engagement_reporting.report_definition rd
      ON rd.report_definition_id = rdv.report_definition_id
    LEFT JOIN engagement_reporting.report_recipient rr
      ON rr.report_schedule_id = rs.report_schedule_id
    WHERE rs.report_schedule_id = '${SCHEDULE_ID}'::uuid
    GROUP BY rs.report_schedule_id, rd.name, rdv.config
  ) t;
")"
[[ -n "${SCHEDULE_JSON}" ]] || stop "Schedule not found: ${SCHEDULE_ID}"

APPLICATION_ID="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.application_id // empty')"
TEMPLATE_APP_ID="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.template_application_id // empty')"
TEMPLATE_NAME="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.template_name // empty')"
PROCESS_ID="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.process_id // empty')"
TO_LIST="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.recipients_to | join(",")')"
CC_LIST="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.recipients_cc | join(",")')"
export TEMPLATE_ID="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.template_id // empty')"
export TEMPLATE_NAME
export FROM_EMAIL="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.from_email // empty')"
export SUBJECT="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.subject // empty')"
export TO_LIST RECIPIENT="${TO_LIST}"

# Prefer live template name from PostgreSQL (Admin UI rename) over stale schedule config.
if [[ "${TEMPLATE_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  LIVE_TEMPLATE_NAME="$(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -t -A -c "
    SELECT COALESCE(NULLIF(rt.name, ''), '')
    FROM engagement_reporting.report_template rt
    WHERE rt.report_template_id = '${TEMPLATE_ID}'::uuid
    LIMIT 1;
  " 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "${LIVE_TEMPLATE_NAME}" ]]; then
    export TEMPLATE_NAME="${LIVE_TEMPLATE_NAME}"
    log "Report title source: live template name '${TEMPLATE_NAME}'"
  fi
fi
if [[ -z "${TEMPLATE_NAME}" && -n "${SUBJECT}" ]]; then
  log "Report title source: schedule subject '${SUBJECT}'"
fi

if [[ -n "${TEMPLATE_APP_ID}" && "${TEMPLATE_APP_ID}" != "${APPLICATION_ID}" ]]; then
  log "Schedule config application_id=${APPLICATION_ID} does not match template binding (${TEMPLATE_APP_ID}). Using template application."
  APPLICATION_ID="${TEMPLATE_APP_ID}"
fi

if [[ -n "${TEST_RECIPIENT:-}" ]]; then
  export TEST_SEND=true
  export RECIPIENT="${TEST_RECIPIENT}"
  export TO_LIST="${TEST_RECIPIENT}"
  export CC=""
  log "Test send: delivering only to ${RECIPIENT} (Cc cleared)"
else
  export TEST_SEND=false
  export RECIPIENT="${TO_LIST}"
  export CC="${CC_LIST}"
fi

report_cache_key() {
  case "${APPLICATION_ID}" in
    Lead_Trcaker_A00) echo "lead-tracker:${GROUP_SLUG:-modepro}" ;;
    IT_Service_Management_A00)
      # v6: Source panels built via Node (raw HTML styles) for Refex + Extrovis
      echo "itsm:v6:${ITSM_PROCESS_ID:-Live_IT_Service_Request_A00}:${ENTITY_FILTER:-all}:${ENVIRONMENT:-production}"
      ;;
    Project_Management_Tracker_A00) echo "pm:${ENVIRONMENT:-production}" ;;
    Solar_Site_Expense_Governance_Syst_A00)
      echo "solar:v1:${SOLAR_PROCESS_ID:-${PROCESS_ID:-Technician_Reimbursement__YTLM}}:${ENVIRONMENT:-production}"
      ;;
    EMS_001_A00) echo "expense:${ENVIRONMENT:-production}" ;;
    Expense_and_Travel_Management_A00)
      echo "travel:v2:${ENTITY_FILTER:-both}:${ENVIRONMENT:-production}"
      ;;
    *) echo "${APPLICATION_ID}:${ENVIRONMENT:-production}" ;;
  esac
}

process_has_snapshot() {
  local n
  n="$(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -t -A -c "
    SELECT count(*)::text
    FROM engagement_reporting.snapshot_run
    WHERE application_id = '${APPLICATION_ID}'
      AND process_id = '${PROCESS_ID}'
      AND environment = '${ENVIRONMENT:-production}'
      AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  " 2>/dev/null | tr -d '[:space:]')"
  [[ "${n:-0}" =~ ^[0-9]+$ ]] && [[ "${n}" -gt 0 ]]
}

dispatch_pm_style_process() {
  local slug="$1"
  local default_process="$2"
  local app_name="$3"
  local process_name="$4"
  local default_subject="$5"
  local report_body="$6"
  local render_script="${7:-${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/23-render-process-html-report.sh}"
  export REPORT_SLUG="${slug}"
  if [[ -z "${PROCESS_ID}" ]]; then
    export PROCESS_ID="${default_process}"
  fi
  export APPLICATION_NAME="${app_name}"
  export PROCESS_NAME="${process_name}"
  export SUBJECT="${SUBJECT:-${default_subject}}"
  export REPORT_BODY="${report_body}"
  local latest="${REPO_ROOT}/templates/generated/${slug}-report-latest.html"
  if [[ "${TEST_SEND}" == "true" ]]; then
    log "Test send: live Kissflow ingest for ${APPLICATION_ID}/${PROCESS_ID}"
    export FULL_INGEST=true
    if ! bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/22-ingest-process-and-load.sh"; then
      log "Live ingest failed for ${app_name} — trying last cached HTML"
      if bash "${REPO_ROOT}/ops/runbooks/load-cached-report-html.sh" "$(report_cache_key)" "${latest}" \
        || bash "${REPO_ROOT}/ops/runbooks/load-latest-cached-report-html.sh" "${APPLICATION_ID}" "${latest}" "${slug}:"; then
        export REPORT_FILE_OVERRIDE="${latest}"
        export DELIVERY_KIND="test"
        bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
        log "${app_name} test send completed from last cache"
        return 0
      fi
      stop "Live ingest failed and no cached ${app_name} report exists. Fix ingest, then retry Test Send."
    fi
    send_test_report \
      "${latest}" \
      "$(report_cache_key)" \
      "${render_script}"
    log "${app_name} test send completed"
  else
    log "Step 1/3: Ingest latest Kissflow data for ${app_name}"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/22-ingest-process-and-load.sh"
    log "Step 2/3: Rendering ${app_name} report"
    bash "${render_script}"
    log "Step 3/3: Sending ${app_name} report"
    send_cached_report "${latest}"
    log "${app_name} ingest-render-send completed"
  fi
}

schedule_cache_key() {
  echo "schedule:${SCHEDULE_ID}"
}

resolve_test_report_file() {
  local report_file="$1"
  local cache_key="$2"
  local cache_prefix="${3:-}"
  mkdir -p "$(dirname "${report_file}")"

  local key
  for key in "$(schedule_cache_key)" "${cache_key}"; do
    if bash "${REPO_ROOT}/ops/runbooks/load-cached-report-html.sh" "${key}" "${report_file}"; then
      log "Test send: loaded cached report from PostgreSQL (${key})"
      return 0
    fi
  done

  if bash "${REPO_ROOT}/ops/runbooks/load-latest-cached-report-html.sh" \
    "${APPLICATION_ID}" "${report_file}" "${cache_prefix}"; then
    log "Test send: loaded latest cached report for ${APPLICATION_ID}${cache_prefix:+ (${cache_prefix}*)}"
    return 0
  fi

  if [[ -f "${report_file}" ]]; then
    log "Test send: using on-disk report ${report_file}"
    return 0
  fi
  return 1
}

send_test_report() {
  local report_file="$1"
  local cache_key="$2"
  local render_runbook="${3:-}"
  local cache_prefix="${4:-}"
  export REPORT_CACHE_KEY="${cache_key}"
  export REPORT_CACHE_KEY_SCHEDULE="$(schedule_cache_key)"
  # Prefer re-render so a newly published template is used. Cached HTML is only a
  # fallback when no render runbook is available (avoids sending stale schedule:* cache).
  if [[ -n "${render_runbook}" ]]; then
    log "Test send: rendering with latest published template from PostgreSQL snapshot (no Kissflow ingest)"
    bash "${render_runbook}"
    [[ -f "${report_file}" ]] || stop "Render did not produce ${report_file}"
    bash "${REPO_ROOT}/ops/runbooks/cache-report-html.sh" "${report_file}" "${cache_key}" \
      || log "Warning: failed to cache rendered report (non-fatal)"
    bash "${REPO_ROOT}/ops/runbooks/cache-report-html.sh" "${report_file}" "${REPORT_CACHE_KEY_SCHEDULE}" \
      || true
  elif ! resolve_test_report_file "${report_file}" "${cache_key}" "${cache_prefix}"; then
    stop "No cached report for ${cache_key}. Run one full scheduled send first, then retry test email."
  fi
  export REPORT_FILE_OVERRIDE="${report_file}"
  export DELIVERY_KIND="test"
  bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
}

send_cached_report() {
  local report_file="$1"
  [[ -f "${report_file}" ]] || stop "No cached report at ${report_file}. Run a full scheduled send once, then retry test email."
  export REPORT_CACHE_KEY="$(report_cache_key)"
  export REPORT_CACHE_KEY_SCHEDULE="$(schedule_cache_key)"
  export REPORT_FILE_OVERRIDE="${report_file}"
  bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
}

export APPLICATION_ID
export PROCESS_ID
export ENVIRONMENT="${ENVIRONMENT:-production}"
export ITSM_PROCESS_ID="${PROCESS_ID:-Live_IT_Service_Request_A00}"
export PM_PROCESS_ID="${PROCESS_ID:-Project_Sub_Task_A01}"
export PM_APP_ID="${PM_APP_ID:-Project_Management_Tracker_A00}"
export SOLAR_APP_ID="${SOLAR_APP_ID:-Solar_Site_Expense_Governance_Syst_A00}"
export SOLAR_PROCESS_ID="${PROCESS_ID:-Technician_Reimbursement__YTLM}"
export ITSM_APP_ID="${ITSM_APP_ID:-IT_Service_Management_A00}"

# Entity scope comes from the schedule. ITSM still defaults classic process → Refex.
# Travel defaults to both (separate Refex / Venwind sections). Other apps leave it empty.
ENTITY_FILTER="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.entity_filter // empty')"
if [[ "${APPLICATION_ID}" == "IT_Service_Management_A00" ]]; then
  if [[ -z "${ENTITY_FILTER}" ]]; then
    if [[ "${ITSM_PROCESS_ID}" == *[Ee]xtrovis* ]]; then
      ENTITY_FILTER=""
    else
      ENTITY_FILTER="Refex"
    fi
  fi
  if [[ "${ENTITY_FILTER}" == "all" || "${ENTITY_FILTER}" == "*" ]]; then
    ENTITY_FILTER=""
  fi
elif [[ "${APPLICATION_ID}" == "Expense_and_Travel_Management_A00" ]]; then
  if [[ -z "${ENTITY_FILTER}" || "${ENTITY_FILTER}" == "all" || "${ENTITY_FILTER}" == "*" ]]; then
    ENTITY_FILTER="both"
  fi
fi
export ENTITY_FILTER

[[ -n "${APPLICATION_ID}" ]] || stop "Schedule ${SCHEDULE_ID} has no application_id in config"
if [[ "${TEST_SEND}" != "true" ]]; then
  [[ -n "${TO_LIST}" ]] || stop "No To recipients on schedule ${SCHEDULE_ID}. Configure in Admin UI first."
fi
[[ -n "${FROM_EMAIL}" ]] || stop "No from_email on schedule ${SCHEDULE_ID}. Configure in Admin UI first."

log "Dispatching ${APPLICATION_ID} schedule ${SCHEDULE_ID}${TEMPLATE_NAME:+ · template ${TEMPLATE_NAME}}${PROCESS_ID:+ · process ${PROCESS_ID}}${ENTITY_FILTER:+ · entity ${ENTITY_FILTER}}"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh"
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-smtp-creds.sh"

case "${APPLICATION_ID}" in
  Lead_Trcaker_A00)
    export GROUP_SLUG="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.group_slug // "modepro"')"
    export GROUP_NAME="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.user_group_filter // .schedule_name // "Sales Team"')"
    export WEBSITE_FILTER="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.website_filter // empty')"
    if [[ "${TEST_SEND}" == "true" ]]; then
      send_test_report \
        "${REPO_ROOT}/templates/generated/lead-tracker-${GROUP_SLUG}-latest.html" \
        "$(report_cache_key)" \
        "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/17-render-lead-tracker-html-report.sh" \
        "lead-tracker:"
      log "Lead Tracker test send completed"
    else
      exec bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/18-render-and-send-lead-tracker-report.sh"
    fi
    ;;
  IT_Service_Management_A00)
    export SUBJECT="${SUBJECT:-Kissflow - User Signin Report}"
    itsm_has_snapshot() {
      local n
      n="$(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -t -A -c "
        SELECT count(*)::text
        FROM engagement_reporting.snapshot_run
        WHERE application_id = '${ITSM_APP_ID}'
          AND process_id = '${ITSM_PROCESS_ID}'
          AND environment = '${ENVIRONMENT:-production}'
          AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
      " 2>/dev/null | tr -d '[:space:]')"
      [[ "${n:-0}" =~ ^[0-9]+$ ]] && [[ "${n}" -gt 0 ]]
    }
    if [[ "${TEST_SEND}" == "true" ]]; then
      # Extrovis (and any new process) has no snapshot until the first ingest.
      # Test send previously skipped Kissflow → empty KPIs / "No users" table.
      if ! itsm_has_snapshot; then
        log "No usable snapshot for process ${ITSM_PROCESS_ID} — running full Kissflow ingest before test send"
        export FULL_INGEST=true
        bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/09-ingest-and-load.sh"
      fi
      send_test_report \
        "${REPO_ROOT}/templates/generated/report-latest.html" \
        "$(report_cache_key)" \
        "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/06-render-html-report.sh"
      log "ITSM test send completed"
    else
      log "Step 1/3: Ingest latest Kissflow data into PostgreSQL"
      bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/09-ingest-and-load.sh"
      log "Step 2/3: Rendering ITSM report"
      bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/06-render-html-report.sh"
      log "Step 3/3: Sending ITSM report"
      send_cached_report "${REPO_ROOT}/templates/generated/report-latest.html"
      log "ITSM ingest-render-send completed"
    fi
    ;;
  Project_Management_Tracker_A00)
    export SUBJECT="${SUBJECT:-Kissflow - Project Task Report}"
    if [[ "${TEST_SEND}" == "true" ]]; then
      send_test_report \
        "${REPO_ROOT}/templates/generated/pm-report-latest.html" \
        "$(report_cache_key)" \
        "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/14-render-pm-html-report.sh"
      log "PM test send completed"
    else
      log "Step 1/3: Ingest latest Kissflow PM data into PostgreSQL"
      bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/12-ingest-pm-and-load.sh"
      log "Step 2/3: Rendering PM report"
      bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/14-render-pm-html-report.sh"
      log "Step 3/3: Sending PM report"
      send_cached_report "${REPO_ROOT}/templates/generated/pm-report-latest.html"
      log "PM ingest-render-send completed"
    fi
    ;;
  Solar_Site_Expense_Governance_Syst_A00)
    export SUBJECT="${SUBJECT:-Kissflow - Solar Reinvestment Request Report}"
    export SOLAR_APP_ID="${APPLICATION_ID}"
    export SOLAR_PROCESS_ID="${PROCESS_ID:-Technician_Reimbursement__YTLM}"
    solar_has_snapshot() {
      local n
      n="$(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -t -A -c "
        SELECT count(*)::text
        FROM engagement_reporting.snapshot_run
        WHERE application_id = '${SOLAR_APP_ID}'
          AND process_id = '${SOLAR_PROCESS_ID}'
          AND environment = '${ENVIRONMENT:-production}'
          AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
      " 2>/dev/null | tr -d '[:space:]')"
      [[ "${n:-0}" =~ ^[0-9]+$ ]] && [[ "${n}" -gt 0 ]]
    }
    if [[ "${TEST_SEND}" == "true" ]]; then
      if ! solar_has_snapshot; then
        log "No usable Solar snapshot for ${SOLAR_PROCESS_ID} — running full Kissflow ingest before test send"
        export FULL_INGEST=true
        bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/20-ingest-solar-and-load.sh"
      fi
      send_test_report \
        "${REPO_ROOT}/templates/generated/solar-report-latest.html" \
        "$(report_cache_key)" \
        "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/21-render-solar-html-report.sh"
      log "Solar test send completed"
    else
      log "Step 1/3: Ingest latest Kissflow Solar Reinvestment Request data"
      bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/20-ingest-solar-and-load.sh"
      log "Step 2/3: Rendering Solar report"
      bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/21-render-solar-html-report.sh"
      log "Step 3/3: Sending Solar report"
      send_cached_report "${REPO_ROOT}/templates/generated/solar-report-latest.html"
      log "Solar ingest-render-send completed"
    fi
    ;;
  EMS_001_A00)
    dispatch_pm_style_process \
      "expense" \
      "Travel_Expense_A00" \
      "Expense Management System" \
      "Expense Request" \
      "Kissflow - Expense Management Report" \
      "Expense Management covers pending and closed claims from Kissflow."
    ;;
  Expense_and_Travel_Management_A00)
    dispatch_pm_style_process \
      "travel" \
      "Copy_of_Venwind_Travel_Request_A00" \
      "Travel Management" \
      "Travel Request" \
      "Kissflow - Travel Management Daily Usage Report" \
      "Requester-wise Travel Management usage. Refex and Venwind are reported separately." \
      "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/24-render-travel-html-report.sh"
    ;;
  *)
    FALLBACK_SLUG="$(printf '%s' "${APPLICATION_ID}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')"
    FALLBACK_SLUG="${FALLBACK_SLUG#-}"
    FALLBACK_SLUG="${FALLBACK_SLUG%-}"
    [[ -n "${PROCESS_ID}" ]] || stop "Unsupported application_id for scheduled send: ${APPLICATION_ID} (no process_id on the schedule)"
    log "No dedicated dispatcher for ${APPLICATION_ID} — using generic process ingest/render (${FALLBACK_SLUG})"
    dispatch_pm_style_process \
      "${FALLBACK_SLUG:-process}" \
      "${PROCESS_ID}" \
      "${APPLICATION_ID}" \
      "${PROCESS_ID}" \
      "${SUBJECT:-Kissflow Report}" \
      "Live Kissflow process data for this application."
    ;;
esac
