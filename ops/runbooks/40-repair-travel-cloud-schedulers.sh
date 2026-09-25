#!/usr/bin/env bash
# ops/runbooks/40-repair-travel-cloud-schedulers.sh
#
# Travel scheduled emails stopped when Admin UI schedules lost legacy Cloud Scheduler
# job names (sch-refex-travel-daily / sch-refex-travel-daily-refex). This runbook:
#   1. Binds legacy_scheduler_id on active Travel schedules in PostgreSQL
#   2. Syncs Cloud Scheduler jobs → refex-schedule-runner with the live schedule UUIDs
#
# Usage (Cloud SQL proxy or PGHOST set):
#   PGHOST=... PGPASSWORD=... bash ops/runbooks/40-repair-travel-cloud-schedulers.sh plan
#   PGHOST=... PGPASSWORD=... SCHEDULE_RUNNER_URL=https://refex-schedule-runner-xxx.run.app \
#     PROVISION_APPROVED=true bash ops/runbooks/40-repair-travel-cloud-schedulers.sh sync
#
# Or after backend-api deploy (runs on GCP with metadata token):
#   curl -X POST "https://refex-backend-api-xxx.run.app/api/v1/ops/sync-cloud-schedulers?environment=production&application_id=Expense_and_Travel_Management_A00" \
#     -H "Cookie: ..." 
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

ENVIRONMENT="${ENVIRONMENT:-production}"
TRAVEL_APP_ID="Expense_and_Travel_Management_A00"
PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-127.0.0.1} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "STOP: $*"; exit 1; }

command -v psql >/dev/null 2>&1 || die "psql required"

MODE="${1:-plan}"

bind_legacy_jobs() {
  log "Binding legacy Cloud Scheduler job names on active Travel schedules"
  psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
UPDATE engagement_reporting.report_definition_version rdv
SET config = COALESCE(rdv.config, '{}'::jsonb) || '{"legacy_scheduler_id":"sch-refex-travel-daily"}'::jsonb
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition rd ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a ON a.account_id = rd.account_id
WHERE rs.report_definition_version_id = rdv.report_definition_version_id
  AND a.environment = '${ENVIRONMENT}'
  AND rdv.config->>'application_id' = '${TRAVEL_APP_ID}'
  AND lower(coalesce(rdv.config->>'entity_filter', 'venwind')) IN ('venwind', '')
  AND rs.is_active = true;

UPDATE engagement_reporting.report_definition_version rdv
SET config = COALESCE(rdv.config, '{}'::jsonb) || '{"legacy_scheduler_id":"sch-refex-travel-daily-refex"}'::jsonb
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition rd ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a ON a.account_id = rd.account_id
WHERE rs.report_definition_version_id = rdv.report_definition_version_id
  AND a.environment = '${ENVIRONMENT}'
  AND rdv.config->>'application_id' = '${TRAVEL_APP_ID}'
  AND lower(coalesce(rdv.config->>'entity_filter', '')) = 'refex'
  AND rs.is_active = true;
COMMIT;
SQL
}

show_schedules() {
  psql "${PG_CONN}" -t -A -c "
SELECT rd.name
  || ' | id=' || rs.report_schedule_id::text
  || ' | entity=' || coalesce(rdv.config->>'entity_filter','')
  || ' | cron=' || rs.cron_expression || ' ' || rs.timezone
  || ' | active=' || rs.is_active::text
  || ' | legacy=' || coalesce(rdv.config->>'legacy_scheduler_id','(none)')
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition_version rdv ON rdv.report_definition_version_id = rs.report_definition_version_id
JOIN engagement_reporting.report_definition rd ON rd.report_definition_id = rdv.report_definition_id
JOIN engagement_reporting.account a ON a.account_id = rd.account_id
WHERE a.environment = '${ENVIRONMENT}'
  AND rdv.config->>'application_id' = '${TRAVEL_APP_ID}'
ORDER BY rd.name;
"
}

case "${MODE}" in
  plan)
    log "Travel schedules (${ENVIRONMENT}) before repair:"
    show_schedules
    log "Would bind sch-refex-travel-daily (Venwind) and sch-refex-travel-daily-refex (Refex), then run runbook 32 sync."
    log "Sync: PROVISION_APPROVED=true SCHEDULE_RUNNER_URL=... APPLICATION_ID=${TRAVEL_APP_ID} bash ops/runbooks/40-repair-travel-cloud-schedulers.sh sync"
    ;;
  sync)
    bind_legacy_jobs
    log "Travel schedules after legacy bind:"
    show_schedules
    export APPLICATION_ID="${TRAVEL_APP_ID}"
    export ENVIRONMENT
    exec bash "${REPO_ROOT}/ops/runbooks/32-provision-schedulers-from-postgresql.sh" sync
    ;;
  bind-only)
    bind_legacy_jobs
    show_schedules
    ;;
  *)
    die "Usage: $0 plan|sync|bind-only"
    ;;
esac
