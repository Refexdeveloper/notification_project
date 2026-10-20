#!/usr/bin/env bash
# ops/runbooks/43-seed-ril-rmc-report-config.sh
#
# Idempotent seed: active Asia/Kolkata RMC schedules for
# Lead Management, Travel Management, Expense Management, and Project Management.
# Staggered so the four jobs do not share the 17:00 Cloud Run slot (max 3 instances).
# To: anil.kulkarni@refex.co.in
# Cc: sudharshan.nc@refex.co.in, pravinkumar.raja@refex.co.in, gowtham.c@refex.co.in,
#     srivaths.varadharajan@refex.co.in, lalitha.u@refex.co.in
# Common schedules stay on their existing templates and exclude entity code RIL_RMC.
# PM schedule UUID d4d4d4d4 is live in production — do not reuse it for Solar.
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

ENVIRONMENT="${ENVIRONMENT:-production}"
KISSFLOW_ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-AcCMptlq60zH}"
CRON_EXPRESSION="0 17 * * *"
TIMEZONE="Asia/Kolkata"
FROM_EMAIL="${FROM_EMAIL:-reports@refex.co.in}"
TO_EMAIL="${TO_EMAIL:-anil.kulkarni@refex.co.in}"
CC_EMAILS="${CC_EMAILS:-sudharshan.nc@refex.co.in,pravinkumar.raja@refex.co.in,gowtham.c@refex.co.in,srivaths.varadharajan@refex.co.in,lalitha.u@refex.co.in}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || stop "psql is not installed."

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

seed_one() {
  local template_id="$1"
  local template_name="$2"
  local content_ref="$3"
  local report_def_id="$4"
  local report_def_version_id="$5"
  local schedule_id="$6"
  local schedule_name="$7"
  local application_id="$8"
  local process_id="$9"
  local subject="${10}"
  local scope="${11}"
  local legacy_scheduler_id="${12}"
  local website_filter="${13:-}"
  local cron_expression="${14:-${CRON_EXPRESSION}}"
  local html="${REPO_ROOT}/${content_ref}"
  [[ -f "${html}" ]] || stop "Template HTML not found: ${html}"
  local checksum
  checksum="$(md5 -q "${html}" 2>/dev/null || md5sum "${html}" | awk '{print $1}')"

  local cc_values=""
  local cc
  IFS=',' read -ra cc_list <<< "${CC_EMAILS}"
  for cc in "${cc_list[@]}"; do
    cc="$(printf '%s' "${cc}" | tr -d '[:space:]')"
    [[ -n "${cc}" ]] || continue
    cc_values="${cc_values}
  ('${schedule_id}'::uuid, '${cc}', 'CC'),"
  done
  cc_values="${cc_values%,}"
  [[ -n "${cc_values}" ]] || stop "At least one Cc address is required."

  log "Seeding ${schedule_name} (${application_id}, ${cron_expression} ${TIMEZONE}, active)"
  psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

INSERT INTO engagement_reporting.report_template (report_template_id, name)
VALUES ('${template_id}'::uuid, '${template_name}')
ON CONFLICT (report_template_id) DO UPDATE
  SET name = EXCLUDED.name;

INSERT INTO engagement_reporting.report_template_version (
  report_template_id, version_number, content_ref, checksum
)
SELECT
  rt.report_template_id,
  1,
  '${content_ref}',
  '${checksum}'
FROM engagement_reporting.report_template rt
WHERE rt.name = '${template_name}'
ON CONFLICT (report_template_id, version_number) DO UPDATE
  SET content_ref = EXCLUDED.content_ref,
      checksum = EXCLUDED.checksum;

INSERT INTO engagement_reporting.report_definition (
  report_definition_id, account_id, name, is_active
)
VALUES (
  '${report_def_id}'::uuid,
  (SELECT account_id FROM engagement_reporting.account WHERE kissflow_account_id = '${KISSFLOW_ACCOUNT_ID}'),
  '${schedule_name}',
  true
)
ON CONFLICT (report_definition_id) DO UPDATE
  SET name = EXCLUDED.name,
      account_id = EXCLUDED.account_id,
      is_active = true;

INSERT INTO engagement_reporting.report_definition_version (
  report_definition_version_id,
  report_definition_id,
  version_number,
  config,
  frozen_at
)
VALUES (
  '${report_def_version_id}'::uuid,
  '${report_def_id}'::uuid,
  1,
  jsonb_build_object(
    'application_id', '${application_id}',
    'process_id', '${process_id}',
    'template_id', (SELECT report_template_id::text FROM engagement_reporting.report_template WHERE name = '${template_name}'),
    'template_name', '${template_name}',
    'entity_filter', 'RIL_RMC',
    'website_filter', NULLIF('${website_filter}', ''),
    'group_slug', NULLIF('${website_filter}', ''),
    'subject', '${subject}',
    'from_email', '${FROM_EMAIL}',
    'legacy_scheduler_id', '${legacy_scheduler_id}',
    'seed_runbook', '43-seed-ril-rmc-report-config'
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
  '${schedule_id}'::uuid,
  '${report_def_version_id}'::uuid,
  '${cron_expression}',
  '${TIMEZONE}',
  true,
  'daily:${application_id}:ril_rmc:${ENVIRONMENT}'
)
ON CONFLICT (report_schedule_id) DO UPDATE
  SET cron_expression = EXCLUDED.cron_expression,
      timezone = EXCLUDED.timezone,
      is_active = true,
      report_definition_version_id = EXCLUDED.report_definition_version_id,
      idempotency_scope = EXCLUDED.idempotency_scope;

DELETE FROM engagement_reporting.report_recipient
WHERE report_schedule_id = '${schedule_id}'::uuid;

INSERT INTO engagement_reporting.report_recipient (report_schedule_id, recipient_email, recipient_type)
VALUES
  ('${schedule_id}'::uuid, '${TO_EMAIL}', 'TO'),${cc_values};

COMMIT;
SQL

  local b64
  b64="$(base64 < "${html}" | tr -d '\n')"
  psql "${PG_CONN}" -v ON_ERROR_STOP=1 -c "
UPDATE engagement_reporting.report_template_version rtv
SET content_ref = convert_from(decode('${b64}', 'base64'), 'UTF8'),
    checksum = '${checksum}'
FROM engagement_reporting.report_template rt
WHERE rt.report_template_id = rtv.report_template_id
  AND rt.name = '${template_name}'
  AND rtv.version_number = 1;
"
  printf 'scope=%s schedule=%s cron=%s to=%s cc=%s\n' "${scope}" "${schedule_id}" "${cron_expression}" "${TO_EMAIL}" "${CC_EMAILS}"
}

seed_one \
  "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1" \
  "RMC - Lead Management - Report" \
  "db/seeds/lead-rmc-ril-rmc-template.html" \
  "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2" \
  "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3" \
  "f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4" \
  "RMC - Lead Management - Report" \
  "Lead_Trcaker_A00" \
  "Lead_tracker_1_A00" \
  "RMC - Lead Management - Report" \
  "lead" \
  "sch-rmc-lead-daily" \
  "RMC" \
  "0 17 * * *"

seed_one \
  "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1" \
  "RMC - Travel Management - Report" \
  "db/seeds/travel-ril-rmc-template.html" \
  "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2" \
  "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3" \
  "e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4" \
  "RMC - Travel Management - Report" \
  "Expense_and_Travel_Management_A00" \
  "Travel_Management_A02" \
  "RMC - Travel Management - Report" \
  "travel" \
  "sch-ril-rmc-travel-daily" \
  "" \
  "8 17 * * *"

seed_one \
  "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1" \
  "RMC - Expense Management - Report" \
  "db/seeds/expense-ril-rmc-template.html" \
  "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2" \
  "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3" \
  "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4" \
  "RMC - Expense Management - Report" \
  "EMS_001_A00" \
  "Travel_Expense_A00" \
  "RMC - Expense Management - Report" \
  "expense" \
  "sch-ril-rmc-expense-daily" \
  "" \
  "4 17 * * *"

seed_one \
  "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1" \
  "RMC - Project Management - Report" \
  "db/seeds/pm-ril-rmc-template.html" \
  "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2" \
  "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3" \
  "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4" \
  "RMC - Project Management - Report" \
  "Project_Management_Tracker_A00" \
  "Project_Sub_Task_A01" \
  "RMC - Project Management - Report" \
  "pm" \
  "sch-ril-rmc-pm-daily" \
  "" \
  "2 17 * * *"

log "RMC schedules seeded active ${TIMEZONE} (Lead 17:00, PM 17:02, Expense 17:04, Travel 17:08). To ${TO_EMAIL}, Cc ${CC_EMAILS}."
