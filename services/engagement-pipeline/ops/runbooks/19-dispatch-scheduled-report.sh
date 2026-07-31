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
  export RECIPIENT="${TEST_RECIPIENT}"
  export TO_LIST="${TEST_RECIPIENT}"
  export CC=""
  log "Test send: delivering only to ${RECIPIENT} (Cc cleared)"
else
  export RECIPIENT="${TO_LIST}"
  export CC="${CC_LIST}"
fi

export APPLICATION_ID
export PROCESS_ID
export ENVIRONMENT="${ENVIRONMENT:-production}"
export ITSM_PROCESS_ID="${PROCESS_ID:-Live_IT_Service_Request_A00}"
export PM_PROCESS_ID="${PROCESS_ID:-Project_Sub_Task_A01}"
export PM_APP_ID="${PM_APP_ID:-Project_Management_Tracker_A00}"
export ITSM_APP_ID="${ITSM_APP_ID:-IT_Service_Management_A00}"

[[ -n "${APPLICATION_ID}" ]] || stop "Schedule ${SCHEDULE_ID} has no application_id in config"
[[ -n "${TO_LIST}" ]] || stop "No To recipients on schedule ${SCHEDULE_ID}. Configure in Admin UI first."
[[ -n "${FROM_EMAIL}" ]] || stop "No from_email on schedule ${SCHEDULE_ID}. Configure in Admin UI first."

log "Dispatching ${APPLICATION_ID} schedule ${SCHEDULE_ID}${TEMPLATE_NAME:+ · template ${TEMPLATE_NAME}}${PROCESS_ID:+ · process ${PROCESS_ID}}"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh"
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-smtp-creds.sh"

case "${APPLICATION_ID}" in
  Lead_Trcaker_A00)
    exec bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/18-render-and-send-lead-tracker-report.sh"
    ;;
  IT_Service_Management_A00)
    export SUBJECT="${SUBJECT:-Kissflow - User Signin Report}"
    log "Step 1/3: Ingest latest Kissflow data into PostgreSQL"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/09-ingest-and-load.sh"
    log "Step 2/3: Rendering ITSM report"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/06-render-html-report.sh"
    log "Step 3/3: Sending ITSM report"
    export REPORT_FILE_OVERRIDE="${REPO_ROOT}/templates/generated/report-latest.html"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
    log "ITSM ingest-render-send completed"
    ;;
  Project_Management_Tracker_A00)
    export SUBJECT="${SUBJECT:-Kissflow - Project Task Report}"
    log "Step 1/3: Ingest latest Kissflow PM data into PostgreSQL"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/12-ingest-pm-and-load.sh"
    log "Step 2/3: Rendering PM report"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/14-render-pm-html-report.sh"
    log "Step 3/3: Sending PM report"
    export REPORT_FILE_OVERRIDE="${REPO_ROOT}/templates/generated/pm-report-latest.html"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
    log "PM ingest-render-send completed"
    ;;
  *)
    stop "Unsupported application_id for scheduled send: ${APPLICATION_ID}"
    ;;
esac
