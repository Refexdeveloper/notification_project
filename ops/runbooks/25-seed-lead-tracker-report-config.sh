#!/usr/bin/env bash
# ops/runbooks/25-seed-lead-tracker-report-config.sh
#
# Idempotent seed: Lead Tracker sales report template + one schedule per sales group.
# Source HTML: db/seeds/lead-tracker-report-template.html (from seedRefexLeadTracker.ts)
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

TEMPLATE_HTML="${REPO_ROOT}/db/seeds/lead-tracker-report-template.html"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-25"
TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"

ENVIRONMENT="${ENVIRONMENT:-production}"
KISSFLOW_ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-AcCMptlq60zH}"
APPLICATION_ID="${APPLICATION_ID:-Lead_Trcaker_A00}"
PROCESS_ID="${PROCESS_ID:-Lead_tracker_1_A00}"

TEMPLATE_ID="${SEED_TEMPLATE_ID:-aaaa1111-1111-4111-8111-111111111001}"
TEMPLATE_NAME="Lead Tracker Sales Report"
CONTENT_REF="db/seeds/lead-tracker-report-template.html"
CRON_EXPRESSION="${CRON_EXPRESSION:-5 17 * * *}"
TIMEZONE="${TIMEZONE:-Asia/Kolkata}"
FROM_EMAIL="${FROM_EMAIL:-reports@refex.co.in}"
# Comma-separated To recipients (override for production rollout)
LEAD_TRACKER_RECIPIENTS="${LEAD_TRACKER_RECIPIENTS:-raghul.je@refex.co.in,murugesh.k@refex.co.in,pravinkumar.raja@refex.co.in}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || stop "psql is not installed."
[[ -f "${TEMPLATE_HTML}" ]] || stop "Template HTML not found: ${TEMPLATE_HTML}"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

CHECKSUM="$(md5 -q "${TEMPLATE_HTML}" 2>/dev/null || md5sum "${TEMPLATE_HTML}" | awk '{print $1}')"
mkdir -p "${AUDIT_DIR}"

seed_group() {
  local GROUP_NAME="$1"
  local WEBSITE_FILTER="$2"
  local SLUG="$3"
  local SUFFIX="$4"
  local REPORT_DEF_ID="bbbb1111-1111-4111-8111-111111111${SUFFIX}"
  local REPORT_DEF_VERSION_ID="cccc1111-1111-4111-8111-111111111${SUFFIX}"
  local SCHEDULE_ID="dddd1111-1111-4111-8111-111111111${SUFFIX}"
  local SCHEDULE_NAME="Lead Tracker — ${GROUP_NAME}"
  local SUBJECT="Lead Tracker — ${GROUP_NAME} sales report"
  local LEGACY_SCHEDULER_ID="sch-refex-lead-prod-${SLUG}"

  psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO engagement_reporting.report_definition (
  report_definition_id, account_id, name, is_active
)
VALUES (
  '${REPORT_DEF_ID}'::uuid,
  (SELECT account_id FROM engagement_reporting.account WHERE kissflow_account_id = '${KISSFLOW_ACCOUNT_ID}'),
  '${SCHEDULE_NAME}',
  false
)
ON CONFLICT (report_definition_id) DO UPDATE
  SET name = EXCLUDED.name,
      account_id = EXCLUDED.account_id;

INSERT INTO engagement_reporting.report_definition_version (
  report_definition_version_id,
  report_definition_id,
  version_number,
  config,
  frozen_at
)
VALUES (
  '${REPORT_DEF_VERSION_ID}'::uuid,
  '${REPORT_DEF_ID}'::uuid,
  1,
  jsonb_build_object(
    'application_id', '${APPLICATION_ID}',
    'process_id', '${PROCESS_ID}',
    'template_id', (SELECT report_template_id::text FROM engagement_reporting.report_template WHERE name = '${TEMPLATE_NAME}'),
    'template_name', '${TEMPLATE_NAME}',
    'subject', '${SUBJECT}',
    'user_group_filter', '${GROUP_NAME}',
    'website_filter', '${WEBSITE_FILTER}',
    'group_slug', '${SLUG}',
    'from_email', '${FROM_EMAIL}',
    'legacy_template_id', 'tpl-refex-lead-tracker-prod',
    'legacy_scheduler_id', '${LEGACY_SCHEDULER_ID}',
    'seed_runbook', '25-seed-lead-tracker-report-config'
  ),
  now()
)
ON CONFLICT (report_definition_id, version_number) DO UPDATE
  SET config = EXCLUDED.config,
      frozen_at = EXCLUDED.frozen_at;

INSERT INTO engagement_reporting.report_schedule (
  report_schedule_id,
  report_definition_version_id,
  cron_expression,
  timezone,
  is_active,
  idempotency_scope
)
VALUES (
  '${SCHEDULE_ID}'::uuid,
  '${REPORT_DEF_VERSION_ID}'::uuid,
  '${CRON_EXPRESSION}',
  '${TIMEZONE}',
  false,
  'daily:${APPLICATION_ID}:${SLUG}:${ENVIRONMENT}'
)
ON CONFLICT (report_schedule_id) DO UPDATE
  SET cron_expression = EXCLUDED.cron_expression,
      timezone = EXCLUDED.timezone,
      is_active = EXCLUDED.is_active,
      report_definition_version_id = EXCLUDED.report_definition_version_id;

DELETE FROM engagement_reporting.report_recipient
WHERE report_schedule_id = '${SCHEDULE_ID}'::uuid;
SQL

  IFS=',' read -r -a _recipients <<< "${LEAD_TRACKER_RECIPIENTS}"
  for _email in "${_recipients[@]}"; do
    _email="${_email#"${_email%%[![:space:]]*}"}"
    _email="${_email%"${_email##*[![:space:]]}"}"
    [[ -z "${_email}" ]] && continue
    psql "${PG_CONN}" -v ON_ERROR_STOP=1 -c "
INSERT INTO engagement_reporting.report_recipient (report_schedule_id, recipient_email, recipient_type)
VALUES ('${SCHEDULE_ID}'::uuid, '${_email}', 'TO')
ON CONFLICT DO NOTHING;
"
  done
}

log "Seeding Lead Tracker report config (${ENVIRONMENT} · ${APPLICATION_ID})"

psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

INSERT INTO engagement_reporting.report_template (report_template_id, name)
VALUES ('${TEMPLATE_ID}'::uuid, '${TEMPLATE_NAME}')
ON CONFLICT (name) DO UPDATE
  SET name = EXCLUDED.name;

INSERT INTO engagement_reporting.report_template_version (
  report_template_id, version_number, content_ref, checksum
)
SELECT
  rt.report_template_id,
  1,
  '${CONTENT_REF}',
  '${CHECKSUM}'
FROM engagement_reporting.report_template rt
WHERE rt.name = '${TEMPLATE_NAME}'
ON CONFLICT (report_template_id, version_number) DO UPDATE
  SET content_ref = EXCLUDED.content_ref,
      checksum = EXCLUDED.checksum;

COMMIT;
SQL

seed_group "3i Sales Team" "3iMedtech" "3i" "001"
seed_group "Sales Team Modepro" "Modepro" "modepro" "002"
seed_group "Sales Team Adonis" "Adonis" "adonis" "003"
seed_group "Sales Team Refex Mobility" "Refex Mobility" "refex-mobility" "004"

TEMPLATE_COUNT="$(psql "${PG_CONN}" -t -A -c "
SELECT count(*)
FROM engagement_reporting.report_template rt
JOIN engagement_reporting.report_definition_version rdv
  ON rdv.config->>'template_id' = rt.report_template_id::text
JOIN engagement_reporting.report_definition rd
  ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a ON a.account_id = rd.account_id
WHERE rdv.config->>'application_id' = '${APPLICATION_ID}'
  AND a.environment = '${ENVIRONMENT}';
")"

SCHEDULE_COUNT="$(psql "${PG_CONN}" -t -A -c "
SELECT count(*)
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition_version rdv
  ON rdv.report_definition_version_id = rs.report_definition_version_id
JOIN engagement_reporting.report_definition rd ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a ON a.account_id = rd.account_id
WHERE rdv.config->>'application_id' = '${APPLICATION_ID}'
  AND a.environment = '${ENVIRONMENT}';
")"

cat > "${AUDIT_DIR}/runbook-25-${TIMESTAMP}.json" <<EOF
{
  "runbook": "25-seed-lead-tracker-report-config",
  "timestamp": "${TIMESTAMP}",
  "environment": "${ENVIRONMENT}",
  "application_id": "${APPLICATION_ID}",
  "process_id": "${PROCESS_ID}",
  "template_name": "${TEMPLATE_NAME}",
  "content_ref": "${CONTENT_REF}",
  "checksum": "${CHECKSUM}",
  "template_rows_linked": ${TEMPLATE_COUNT:-0},
  "schedule_rows": ${SCHEDULE_COUNT:-0},
  "cron_expression": "${CRON_EXPRESSION}",
  "timezone": "${TIMEZONE}",
  "sales_groups": [
    {"group_name": "3i Sales Team", "website_filter": "3iMedtech", "slug": "3i"},
    {"group_name": "Sales Team Modepro", "website_filter": "Modepro", "slug": "modepro"},
    {"group_name": "Sales Team Adonis", "website_filter": "Adonis", "slug": "adonis"},
    {"group_name": "Sales Team Refex Mobility", "website_filter": "Refex Mobility", "slug": "refex-mobility"}
  ],
  "schedule_active": false
}
EOF

log "Seed complete. Templates linked: ${TEMPLATE_COUNT:-0}, Schedules: ${SCHEDULE_COUNT:-0}"
log "Audit: ${AUDIT_DIR}/runbook-25-${TIMESTAMP}.json"

[[ "${TEMPLATE_COUNT:-0}" -ge 1 ]] || stop "Expected at least 1 template row for ${APPLICATION_ID}"
[[ "${SCHEDULE_COUNT:-0}" -ge 4 ]] || stop "Expected 4 schedule rows for ${APPLICATION_ID} (got ${SCHEDULE_COUNT:-0})"

log "Verify:"
log "  curl -s \"http://localhost:8080/api/v1/applications/${APPLICATION_ID}/templates?environment=${ENVIRONMENT}\" | python3 -m json.tool"
log "  curl -s \"http://localhost:8080/api/v1/applications/${APPLICATION_ID}/schedules?environment=${ENVIRONMENT}\" | python3 -m json.tool"
