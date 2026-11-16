#!/usr/bin/env bash
# ops/runbooks/44-seed-itsm-nonrefex-entity-reports.sh
#
# Seed / repair Tech Helpdesk entity schedules on Live_IT_Service_Request_Extrovis_A00:
#   - Extrovis  → entity_filter Extrovis only (fix "all tickets")
#   - Kavispharma → To / CC / BCC from product request
#   - Modepro     → To / CC / BCC from product request
#
# Does not change incremental sync, Me matchers, or RefexOne login.
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-44"
TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"

ENVIRONMENT="${ENVIRONMENT:-production}"
KISSFLOW_ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-AcCMptlq60zH}"
APPLICATION_ID="${APPLICATION_ID:-IT_Service_Management_A00}"
PROCESS_ID="${PROCESS_ID:-Live_IT_Service_Request_Extrovis_A00}"
CRON_EXPRESSION="${CRON_EXPRESSION:-0 9 * * *}"
TIMEZONE="${TIMEZONE:-Asia/Kolkata}"

# Stable UUIDs (idempotent upserts)
TEMPLATE_ID_EXTROVIS="${SEED_TEMPLATE_ID_EXTROVIS:-a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1}"
TEMPLATE_ID_KAVIS="${SEED_TEMPLATE_ID_KAVIS:-a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2}"
# Avoid patterned UUIDs already used by Expense/RMC seeds (e.g. c3c3… / d4d4…).
TEMPLATE_ID_MODEPRO="${SEED_TEMPLATE_ID_MODEPRO:-51b63c4e-9558-434e-82c4-7571d5d5b3fa}"

REPORT_DEF_ID_EXTROVIS="${SEED_REPORT_DEF_ID_EXTROVIS:-b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1}"
REPORT_DEF_ID_KAVIS="${SEED_REPORT_DEF_ID_KAVIS:-b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2}"
REPORT_DEF_ID_MODEPRO="${SEED_REPORT_DEF_ID_MODEPRO:-103fa795-e03e-4aab-a501-10c45b541233}"

REPORT_DEF_VERSION_ID_EXTROVIS="${SEED_REPORT_DEF_VERSION_ID_EXTROVIS:-c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1}"
REPORT_DEF_VERSION_ID_KAVIS="${SEED_REPORT_DEF_VERSION_ID_KAVIS:-c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2}"
REPORT_DEF_VERSION_ID_MODEPRO="${SEED_REPORT_DEF_VERSION_ID_MODEPRO:-423a2b29-feb8-4611-b59b-b5ff0b58db9a}"

# Prefer the known live Extrovis Cloud Scheduler UUID when present.
SCHEDULE_ID_EXTROVIS="${SEED_SCHEDULE_ID_EXTROVIS:-18e6c3a0-df09-473e-9c52-8993b7b1ea9b}"
SCHEDULE_ID_KAVIS="${SEED_SCHEDULE_ID_KAVIS:-d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2}"
SCHEDULE_ID_MODEPRO="${SEED_SCHEDULE_ID_MODEPRO:-c922425f-3ac2-4236-92ec-001b36b07a11}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || stop "psql is not installed."

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

mkdir -p "${AUDIT_DIR}"

seed_entity() {
  local entity="$1"
  local template_name="$2"
  local template_id="$3"
  local seed_html="$4"
  local report_def_id="$5"
  local report_def_version_id="$6"
  local schedule_id="$7"
  local subject="$8"
  local to_list="$9"
  local cc_list="${10}"
  local bcc_list="${11}"
  local content_ref="db/seeds/${seed_html}"
  local html_path="${REPO_ROOT}/${content_ref}"
  [[ -f "${html_path}" ]] || stop "Missing seed HTML: ${html_path}"
  local checksum
  checksum="$(md5 -q "${html_path}" 2>/dev/null || md5sum "${html_path}" | awk '{print $1}')"
  local schedule_name="${template_name} · daily"

  log "Seeding ${entity} → ${template_name}"

  psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

INSERT INTO engagement_reporting.report_template (report_template_id, name)
VALUES ('${template_id}'::uuid, '${template_name}')
ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO engagement_reporting.report_template_version (
  report_template_id, version_number, content_ref, checksum
)
SELECT rt.report_template_id, 1, '${content_ref}', '${checksum}'
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
  '${report_def_version_id}'::uuid,
  '${report_def_id}'::uuid,
  1,
  jsonb_build_object(
    'application_id', '${APPLICATION_ID}',
    'process_id', '${PROCESS_ID}',
    'template_id', (SELECT report_template_id::text FROM engagement_reporting.report_template WHERE name = '${template_name}'),
    'template_name', '${template_name}',
    'entity_filter', '${entity}',
    'subject', '${subject}',
    'seed_runbook', '44-seed-itsm-nonrefex-entity-reports'
  ),
  now()
)
ON CONFLICT (report_definition_version_id) DO UPDATE
  SET report_definition_id = EXCLUDED.report_definition_id,
      version_number = EXCLUDED.version_number,
      config = EXCLUDED.config,
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
  '${CRON_EXPRESSION}',
  '${TIMEZONE}',
  false,
  'daily:${APPLICATION_ID}:${entity}:${ENVIRONMENT}'
)
ON CONFLICT (report_schedule_id) DO UPDATE
  SET cron_expression = EXCLUDED.cron_expression,
      timezone = EXCLUDED.timezone,
      report_definition_version_id = EXCLUDED.report_definition_version_id;

COMMIT;
SQL

  # Only replace recipients when To addresses were provided (keep Extrovis existing To list).
  if [[ -n "$(printf '%s' "${to_list}" | xargs)" ]]; then
    psql "${PG_CONN}" -v ON_ERROR_STOP=1 -c "
DELETE FROM engagement_reporting.report_recipient
WHERE report_schedule_id = '${schedule_id}'::uuid;"
    local email
    IFS=',' read -r -a _to <<< "${to_list}"
    for email in "${_to[@]}"; do
      email="$(printf '%s' "${email}" | xargs)"
      [[ -z "${email}" ]] && continue
      psql "${PG_CONN}" -v ON_ERROR_STOP=1 -c "
INSERT INTO engagement_reporting.report_recipient (report_schedule_id, recipient_email, recipient_type)
VALUES ('${schedule_id}'::uuid, '${email}', 'TO')
ON CONFLICT DO NOTHING;"
    done
    IFS=',' read -r -a _cc <<< "${cc_list}"
    for email in "${_cc[@]}"; do
      email="$(printf '%s' "${email}" | xargs)"
      [[ -z "${email}" ]] && continue
      psql "${PG_CONN}" -v ON_ERROR_STOP=1 -c "
INSERT INTO engagement_reporting.report_recipient (report_schedule_id, recipient_email, recipient_type)
VALUES ('${schedule_id}'::uuid, '${email}', 'CC')
ON CONFLICT DO NOTHING;"
    done
    IFS=',' read -r -a _bcc <<< "${bcc_list}"
    for email in "${_bcc[@]}"; do
      email="$(printf '%s' "${email}" | xargs)"
      [[ -z "${email}" ]] && continue
      psql "${PG_CONN}" -v ON_ERROR_STOP=1 -c "
INSERT INTO engagement_reporting.report_recipient (report_schedule_id, recipient_email, recipient_type)
VALUES ('${schedule_id}'::uuid, '${email}', 'BCC')
ON CONFLICT DO NOTHING;"
    done
  fi
}

log "Seeding non-Refex Tech Helpdesk entity reports (${ENVIRONMENT})"

# Repair any Extrovis-process schedule still scoped to all tickets.
psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
UPDATE engagement_reporting.report_definition_version rdv
SET config = jsonb_set(
  COALESCE(rdv.config, '{}'::jsonb),
  '{entity_filter}',
  '"Extrovis"'::jsonb,
  true
)
FROM engagement_reporting.report_schedule rs
WHERE rs.report_definition_version_id = rdv.report_definition_version_id
  AND rdv.config->>'application_id' = '${APPLICATION_ID}'
  AND rdv.config->>'process_id' ILIKE '%extrovis%'
  AND (
    COALESCE(rdv.config->>'entity_filter', '') = ''
    OR lower(COALESCE(rdv.config->>'entity_filter', '')) IN ('all', '*')
  )
  AND COALESCE(rdv.config->>'template_name', '') ILIKE '%extrovis%'
  AND COALESCE(rdv.config->>'template_name', '') NOT ILIKE '%kavis%'
  AND COALESCE(rdv.config->>'template_name', '') NOT ILIKE '%modepro%';
SQL

# Extrovis: do NOT upsert schedule 18e6c3a0… (live Cloud Scheduler already owns it).
# entity_filter repair above is the Extrovis fix; refresh HTML template by name only.
log "Refreshing Extrovis ITSM Report template HTML (no schedule re-link)"
EXTROVIS_HTML="${REPO_ROOT}/db/seeds/itsm-extrovis-engagement-template.html"
[[ -f "${EXTROVIS_HTML}" ]] || stop "Missing ${EXTROVIS_HTML}"
EXTROVIS_CHECKSUM="$(md5 -q "${EXTROVIS_HTML}" 2>/dev/null || md5sum "${EXTROVIS_HTML}" | awk '{print $1}')"
psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO engagement_reporting.report_template (report_template_id, name)
VALUES ('${TEMPLATE_ID_EXTROVIS}'::uuid, 'Extrovis ITSM Report')
ON CONFLICT (name) DO NOTHING;

INSERT INTO engagement_reporting.report_template_version (
  report_template_id, version_number, content_ref, checksum
)
SELECT rt.report_template_id, 1, 'db/seeds/itsm-extrovis-engagement-template.html', '${EXTROVIS_CHECKSUM}'
FROM engagement_reporting.report_template rt
WHERE rt.name = 'Extrovis ITSM Report'
ON CONFLICT (report_template_id, version_number) DO UPDATE
  SET content_ref = EXCLUDED.content_ref,
      checksum = EXCLUDED.checksum;
SQL

seed_entity \
  "KavisPharma" \
  "Kavis Pharma ITSM Report" \
  "${TEMPLATE_ID_KAVIS}" \
  "itsm-kavispharma-engagement-template.html" \
  "${REPORT_DEF_ID_KAVIS}" \
  "${REPORT_DEF_VERSION_ID_KAVIS}" \
  "${SCHEDULE_ID_KAVIS}" \
  "Kavis Pharma / Kissflow ITSM Report" \
  "jon.hudanich@kavispharma.com,vidhya.kumar@kavispharma.com" \
  "itsupport@extrovis.com" \
  "mohamedaasik.m@refex.co.in,gowtham.s@refex.co.in,srivaths.varadharajan@refex.co.in"

seed_entity \
  "ModePro" \
  "Modepro ITSM Report" \
  "${TEMPLATE_ID_MODEPRO}" \
  "itsm-modepro-engagement-template.html" \
  "${REPORT_DEF_ID_MODEPRO}" \
  "${REPORT_DEF_VERSION_ID_MODEPRO}" \
  "${SCHEDULE_ID_MODEPRO}" \
  "ModePro / Kissflow ITSM Report" \
  "pradip.kakade@modepro.com" \
  "itsupport@extrovis.com" \
  "mohamedaasik.m@refex.co.in,gowtham.s@refex.co.in,srivaths.varadharajan@refex.co.in"

cat > "${AUDIT_DIR}/runbook-44-${TIMESTAMP}.json" <<EOF
{
  "runbook": "44-seed-itsm-nonrefex-entity-reports",
  "timestamp": "${TIMESTAMP}",
  "environment": "${ENVIRONMENT}",
  "application_id": "${APPLICATION_ID}",
  "process_id": "${PROCESS_ID}",
  "schedules": {
    "Extrovis": "${SCHEDULE_ID_EXTROVIS}",
    "KavisPharma": "${SCHEDULE_ID_KAVIS}",
    "ModePro": "${SCHEDULE_ID_MODEPRO}"
  },
  "note": "Schedules created inactive — Activate in Admin UI after review. Extrovis entity_filter repaired from all→Extrovis."
}
EOF

log "Done. Audit: ${AUDIT_DIR}/runbook-44-${TIMESTAMP}.json"
log "Activate each schedule in Admin UI (Tech Helpdesk → Schedules) after verifying recipients."
