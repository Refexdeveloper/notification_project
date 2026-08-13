#!/usr/bin/env bash
# ops/runbooks/37-seed-expense-report-config.sh
#
# Idempotent seed: Expense Management template + daily schedule into PostgreSQL.
# Source HTML: db/seeds/expense-engagement-template.html
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

TEMPLATE_HTML="${REPO_ROOT}/db/seeds/expense-engagement-template.html"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-37"
TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"

ENVIRONMENT="${ENVIRONMENT:-production}"
KISSFLOW_ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-AcCMptlq60zH}"
APPLICATION_ID="${APPLICATION_ID:-EMS_001_A00}"
PROCESS_ID="${PROCESS_ID:-Travel_Expense_A00}"

TEMPLATE_ID="${SEED_TEMPLATE_ID:-e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5}"
REPORT_DEF_ID="${SEED_REPORT_DEF_ID:-e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6}"
REPORT_DEF_VERSION_ID="${SEED_REPORT_DEF_VERSION_ID:-e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7}"
SCHEDULE_ID="${SEED_SCHEDULE_ID:-e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8}"

TEMPLATE_NAME="Expense Claim Engagement Report"
SCHEDULE_NAME="Daily Expense Management report"
CONTENT_REF="db/seeds/expense-engagement-template.html"
CRON_EXPRESSION="0 9 * * *"
TIMEZONE="Asia/Kolkata"

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

log "Seeding Expense Management report config (${ENVIRONMENT} · ${APPLICATION_ID})"

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
    'subject', 'Kissflow - Expense Management Report',
    'legacy_template_id', 'tpl-refex-expense-engagement',
    'legacy_scheduler_id', 'sch-refex-expense-daily',
    'seed_runbook', '37-seed-expense-report-config'
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
  'daily:${APPLICATION_ID}:${ENVIRONMENT}'
)
ON CONFLICT (report_schedule_id) DO UPDATE
  SET cron_expression = EXCLUDED.cron_expression,
      timezone = EXCLUDED.timezone,
      is_active = EXCLUDED.is_active,
      report_definition_version_id = EXCLUDED.report_definition_version_id;

COMMIT;
SQL

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

cat > "${AUDIT_DIR}/runbook-37-${TIMESTAMP}.json" <<EOF
{
  "runbook": "37-seed-expense-report-config",
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
  "schedule_active": false
}
EOF

log "Seed complete. Templates linked: ${TEMPLATE_COUNT:-0}, Schedules: ${SCHEDULE_COUNT:-0}"
log "Audit: ${AUDIT_DIR}/runbook-37-${TIMESTAMP}.json"

[[ "${TEMPLATE_COUNT:-0}" -ge 1 ]] || stop "Expected at least 1 template row for ${APPLICATION_ID}"
[[ "${SCHEDULE_COUNT:-0}" -ge 1 ]] || stop "Expected at least 1 schedule row for ${APPLICATION_ID}"

log "Verify:"
log "  curl -s \"http://localhost:8080/api/v1/applications/${APPLICATION_ID}/templates?environment=${ENVIRONMENT}\" | python3 -m json.tool"
log "  curl -s \"http://localhost:8080/api/v1/applications/${APPLICATION_ID}/schedules?environment=${ENVIRONMENT}\" | python3 -m json.tool"
