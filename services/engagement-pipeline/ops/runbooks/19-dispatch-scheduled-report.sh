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
export FROM_EMAIL="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.from_email // empty')"
export SUBJECT="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.subject // empty')"
export TO_LIST RECIPIENT="${TO_LIST}"

if [[ -n "${TEMPLATE_APP_ID}" && "${TEMPLATE_APP_ID}" != "${APPLICATION_ID}" ]]; then
  log "Schedule config application_id=${APPLICATION_ID} does not match template binding (${TEMPLATE_APP_ID}). Using template application."
  APPLICATION_ID="${TEMPLATE_APP_ID}"
fi

if [[ -n "${TEST_RECIPIENT:-}" ]]; then
  export TEST_SEND=true
  export RECIPIENT="${TEST_RECIPIENT}"
  export TO_LIST="${TEST_RECIPIENT}"
  export CC=""
  log "Test send: delivering only to ${RECIPIENT} (Cc cleared, skipping Kissflow ingest/render)"
else
  export TEST_SEND=false
  export RECIPIENT="${TO_LIST}"
  export CC="${CC_LIST}"
fi

report_cache_key() {
  case "${APPLICATION_ID}" in
    Lead_Trcaker_A00) echo "lead-tracker:${GROUP_SLUG:-modepro}" ;;
    IT_Service_Management_A00) echo "itsm:${ENVIRONMENT:-production}" ;;
    Project_Management_Tracker_A00) echo "pm:${ENVIRONMENT:-production}" ;;
    *) echo "${APPLICATION_ID}:${ENVIRONMENT:-production}" ;;
  esac
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
  if ! resolve_test_report_file "${report_file}" "${cache_key}" "${cache_prefix}"; then
    if [[ -n "${render_runbook}" ]]; then
      log "Test send: no cache yet — rendering from last PostgreSQL snapshot (no Kissflow ingest)"
      bash "${render_runbook}"
      [[ -f "${report_file}" ]] || stop "Render did not produce ${report_file}"
      bash "${REPO_ROOT}/ops/runbooks/cache-report-html.sh" "${report_file}" "${cache_key}" \
        || log "Warning: failed to cache rendered report (non-fatal)"
      bash "${REPO_ROOT}/ops/runbooks/cache-report-html.sh" "${report_file}" "${REPORT_CACHE_KEY_SCHEDULE}" \
        || true
    else
      stop "No cached report for ${cache_key}. Run one full scheduled send first, then retry test email."
    fi
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
export ITSM_APP_ID="${ITSM_APP_ID:-IT_Service_Management_A00}"

[[ -n "${APPLICATION_ID}" ]] || stop "Schedule ${SCHEDULE_ID} has no application_id in config"
if [[ "${TEST_SEND}" != "true" ]]; then
  [[ -n "${TO_LIST}" ]] || stop "No To recipients on schedule ${SCHEDULE_ID}. Configure in Admin UI first."
fi
[[ -n "${FROM_EMAIL}" ]] || stop "No from_email on schedule ${SCHEDULE_ID}. Configure in Admin UI first."

log "Dispatching ${APPLICATION_ID} schedule ${SCHEDULE_ID}${TEMPLATE_NAME:+ · template ${TEMPLATE_NAME}}${PROCESS_ID:+ · process ${PROCESS_ID}}"

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
    if [[ "${TEST_SEND}" == "true" ]]; then
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
  *)
    stop "Unsupported application_id for scheduled send: ${APPLICATION_ID}"
    ;;
esac
