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
RECIPIENT="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.recipients_to[0] // empty')"
CC_LIST="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.recipients_cc | join(",")')"
export FROM_EMAIL="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.from_email // empty')"
export SUBJECT="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.subject // empty')"
export RECIPIENT CC="${CC_LIST}"

[[ -n "${APPLICATION_ID}" ]] || stop "Schedule ${SCHEDULE_ID} has no application_id in config"
[[ -n "${RECIPIENT}" ]] || stop "No To recipients on schedule ${SCHEDULE_ID}. Configure in Admin UI first."
[[ -n "${FROM_EMAIL}" ]] || stop "No from_email on schedule ${SCHEDULE_ID}. Configure in Admin UI first."

log "Dispatching ${APPLICATION_ID} schedule ${SCHEDULE_ID}"

case "${APPLICATION_ID}" in
  Lead_Trcaker_A00)
    exec bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/18-render-and-send-lead-tracker-report.sh"
    ;;
  IT_Service_Management_A00)
    export SUBJECT="${SUBJECT:-Kissflow - User Signin Report}"
    log "Step 1/2: Rendering ITSM report"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/06-render-html-report.sh"
    log "Step 2/2: Sending ITSM report"
    export REPORT_FILE_OVERRIDE="${REPO_ROOT}/templates/generated/report-latest.html"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
    log "ITSM render-and-send completed"
    ;;
  Project_Management_Tracker_A00)
    export SUBJECT="${SUBJECT:-Kissflow - Project Task Report}"
    log "Step 1/2: Rendering PM report"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/14-render-pm-html-report.sh"
    log "Step 2/2: Sending PM report"
    export REPORT_FILE_OVERRIDE="${REPO_ROOT}/templates/generated/pm-report-latest.html"
    bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
    log "PM render-and-send completed"
    ;;
  *)
    stop "Unsupported application_id for scheduled send: ${APPLICATION_ID}"
    ;;
esac
