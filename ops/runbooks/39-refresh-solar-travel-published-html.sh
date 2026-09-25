#!/usr/bin/env bash
# ops/runbooks/39-refresh-solar-travel-published-html.sh
#
# Pushes current seed HTML into PostgreSQL report_template_version so Admin UI
# Preview / test-send and schedule-runner stop using stale published layouts.
# Also ensures Travel has separate Refex + Venwind templates and schedules.
#
# Safe: only updates engagement_reporting report_template* rows (not Kissflow, not P2P MySQL).
#
# Usage:
#   PGHOST=... PGPASSWORD=... bash ops/runbooks/39-refresh-solar-travel-published-html.sh
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

ENVIRONMENT="${ENVIRONMENT:-production}"
KISSFLOW_ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-AcCMptlq60zH}"
TRAVEL_APP_ID="Expense_and_Travel_Management_A00"
SOLAR_APP_ID="Solar_Site_Expense_Governance_Syst_A00"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || stop "psql is not installed."
command -v node >/dev/null 2>&1 || stop "node is not installed."

publish_seed_html() {
  local template_name="$1"
  local seed_rel="$2"
  local abs="${REPO_ROOT}/${seed_rel}"
  [[ -f "${abs}" ]] || stop "Missing seed: ${abs}"

  log "Publishing seed HTML → template \"${template_name}\" (${seed_rel})"
  local tmp_sql
  tmp_sql="$(mktemp)"
  SEED_ABS="${abs}" TEMPLATE_NAME="${template_name}" OUT_SQL="${tmp_sql}" node <<'NODE'
const fs = require('fs');
const html = fs.readFileSync(process.env.SEED_ABS, 'utf8');
const name = process.env.TEMPLATE_NAME.replace(/'/g, "''");
// Dollar-quote tag that cannot appear in HTML
const tag = 'seedhtml_' + Date.now();
const sql = `
BEGIN;
INSERT INTO engagement_reporting.report_template (report_template_id, name)
VALUES (gen_random_uuid(), '${name}')
ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;

WITH t AS (
  SELECT report_template_id FROM engagement_reporting.report_template WHERE name = '${name}'
),
nextv AS (
  SELECT COALESCE(MAX(version_number), 0) + 1 AS v
  FROM engagement_reporting.report_template_version rtv, t
  WHERE rtv.report_template_id = t.report_template_id
)
INSERT INTO engagement_reporting.report_template_version (
  report_template_id, version_number, content_ref, checksum
)
SELECT t.report_template_id, nextv.v, \$${tag}\$${html}\$${tag}\$, md5(\$${tag}\$${html}\$${tag}\$)
FROM t, nextv;
COMMIT;
`;
fs.writeFileSync(process.env.OUT_SQL, sql);
NODE
  psql "${PG_CONN}" -v ON_ERROR_STOP=1 -f "${tmp_sql}"
  rm -f "${tmp_sql}"
}

ensure_travel_schedule() {
  local schedule_name="$1"
  local entity="$2"
  local template_name="$3"
  local schedule_uuid="$4"
  local def_uuid="$5"
  local ver_uuid="$6"
  local scope="$7"

  log "Ensuring schedule \"${schedule_name}\" (entity=${entity}, template=${template_name})"
  psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
INSERT INTO engagement_reporting.report_definition (
  report_definition_id, account_id, name, is_active
)
VALUES (
  '${def_uuid}'::uuid,
  (SELECT account_id FROM engagement_reporting.account WHERE kissflow_account_id = '${KISSFLOW_ACCOUNT_ID}' LIMIT 1),
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
  '${ver_uuid}'::uuid,
  '${def_uuid}'::uuid,
  1,
  jsonb_build_object(
    'application_id', '${TRAVEL_APP_ID}',
    'process_id', 'Travel_Management_A02',
    'template_id', (SELECT report_template_id::text FROM engagement_reporting.report_template WHERE name = '${template_name}'),
    'template_name', '${template_name}',
    'entity_filter', '${entity}',
    'subject', 'Kissflow - ${entity} Travel Management Daily Usage Report',
    'seed_runbook', '39-refresh-solar-travel-published-html'
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
  '${schedule_uuid}'::uuid,
  '${ver_uuid}'::uuid,
  '0 9 * * *',
  'Asia/Kolkata',
  true,
  '${scope}'
)
ON CONFLICT (report_schedule_id) DO UPDATE
  SET cron_expression = EXCLUDED.cron_expression,
      timezone = EXCLUDED.timezone,
      is_active = true,
      report_definition_version_id = EXCLUDED.report_definition_version_id;
COMMIT;
SQL
}

log "Refreshing Solar + Travel published HTML (${ENVIRONMENT})"

publish_seed_html "Solar Reinvestment Request Report" "db/seeds/solar-reinvestment-template.html"
publish_seed_html "Travel Management Report" "db/seeds/travel-engagement-template.html"
publish_seed_html "Travel Venwind Report" "db/seeds/travel-venwind-template.html"
publish_seed_html "Travel Refex Report" "db/seeds/travel-refex-template.html"

ensure_travel_schedule \
  "Daily Venwind Travel Management report" \
  "Venwind" \
  "Travel Venwind Report" \
  "f8f8f8f8-f8f8-4f8e-8f8e-f8f8f8f8f8f8" \
  "f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6" \
  "f7f7f7f7-f7f7-4f7f-8f7f-f7f7f7f7f7f7" \
  "daily:${TRAVEL_APP_ID}:venwind:${ENVIRONMENT}"

ensure_travel_schedule \
  "Daily Refex Travel Management report" \
  "Refex" \
  "Travel Refex Report" \
  "fbfbfbfb-fbfb-4bfb-8bfb-fbfbfbfbfbfb" \
  "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9" \
  "fafafafa-fafa-4afa-8afa-fafafafafafa" \
  "daily:${TRAVEL_APP_ID}:refex:${ENVIRONMENT}"

log "Verify Solar placeholder:"
psql "${PG_CONN}" -t -A -c "
SELECT CASE WHEN content_ref LIKE '%CategorySectionsHtml%' THEN 'OK CategorySectionsHtml' ELSE 'MISSING' END
FROM engagement_reporting.report_template_version rtv
JOIN engagement_reporting.report_template rt ON rt.report_template_id = rtv.report_template_id
WHERE rt.name = 'Solar Reinvestment Request Report'
ORDER BY rtv.version_number DESC LIMIT 1;
"

log "Verify Travel schedules:"
psql "${PG_CONN}" -t -A -c "
SELECT rd.name || ' | entity=' || COALESCE(rdv.config->>'entity_filter','') || ' | template=' || COALESCE(rdv.config->>'template_name','') || ' | active=' || rs.is_active::text
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition_version rdv ON rdv.report_definition_version_id = rs.report_definition_version_id
JOIN engagement_reporting.report_definition rd ON rd.report_definition_id = rdv.report_definition_id
WHERE rdv.config->>'application_id' = '${TRAVEL_APP_ID}'
ORDER BY rd.name;
"

log "Done. Deploy schedule-runner so render runbooks pick up seed fallbacks + CategorySectionsHtml builder."
log "  DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh build-deploy"
