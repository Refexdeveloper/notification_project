#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)}"
if [[ -z "${REPO_ROOT}" || ! -f "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
fi
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh"

GROUP_NAME="${GROUP_NAME:-Sales Team Modepro}"
WEBSITE_FILTER="${WEBSITE_FILTER:-Modepro}"
GROUP_SLUG="${GROUP_SLUG:-modepro}"
SCHEDULE_ID="${SCHEDULE_ID:-}"
export SCHEDULE_ID
ENVIRONMENT="${ENVIRONMENT:-production}"
APPLICATION_ID="${APPLICATION_ID:-Lead_Trcaker_A00}"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || stop "psql is not installed."

if [[ -n "${SCHEDULE_ID}" ]]; then
  log "Loading schedule ${SCHEDULE_ID} from PostgreSQL"
  SCHEDULE_JSON="$(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -t -A -c "
    SELECT row_to_json(t)::text FROM (
      SELECT
        rs.report_schedule_id::text AS schedule_id,
        rd.name AS schedule_name,
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
  GROUP_NAME="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.user_group_filter // .schedule_name // empty')"
  WEBSITE_FILTER="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.website_filter // empty')"
  GROUP_SLUG="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.group_slug // "modepro"')"
  export SUBJECT="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.subject // empty')"
  export FROM_EMAIL="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.from_email // empty')"
  RECIPIENT="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.recipients_to[0] // empty')"
  CC_LIST="$(printf '%s' "${SCHEDULE_JSON}" | jq -r '.recipients_cc | join(",")')"
  [[ -n "${RECIPIENT}" ]] || stop "No To recipients on schedule ${SCHEDULE_ID}. Configure in Admin UI first."
  [[ -n "${FROM_EMAIL}" ]] || stop "No from_email on schedule ${SCHEDULE_ID}. Configure in Admin UI first."
  export RECIPIENT CC="${CC_LIST}"
fi

export GROUP_NAME WEBSITE_FILTER GROUP_SLUG
export SUBJECT="${SUBJECT:-Lead Tracker — ${GROUP_NAME} sales report}"

log "Step 1/2: Rendering Lead Tracker report"
bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/17-render-lead-tracker-html-report.sh"

log "Step 2/2: Sending Lead Tracker report"
export REPORT_FILE_OVERRIDE="${REPO_ROOT}/templates/generated/lead-tracker-${GROUP_SLUG}-latest.html"
bash "${REPO_ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"

log "Lead Tracker render-and-send completed (${GROUP_NAME})"
