#!/usr/bin/env bash
# Repair report_schedule rows whose config.application_id disagrees with template binding.
#
# Usage:
#   bash ops/runbooks/35-repair-schedule-application-ids.sh plan
#   REPAIR_APPROVED=true bash ops/runbooks/35-repair-schedule-application-ids.sh apply
#
set -euo pipefail

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

log() { printf '[runbook-35] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

command -v psql >/dev/null 2>&1 || die "psql required"

MISMATCH_SQL="
SELECT
  rs.report_schedule_id::text AS schedule_id,
  rd.name AS schedule_name,
  rdv.config->>'application_id' AS config_application_id,
  rdv.config->>'template_id' AS template_id,
  rdv.config->>'template_name' AS template_name,
  (
    SELECT tb.config->>'application_id'
    FROM engagement_reporting.report_definition_version tb
    WHERE tb.config->>'template_id' = rdv.config->>'template_id'
      AND tb.config->>'application_id' IS NOT NULL
    ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
    LIMIT 1
  ) AS template_application_id
FROM engagement_reporting.report_schedule rs
JOIN engagement_reporting.report_definition_version rdv
  ON rdv.report_definition_version_id = rs.report_definition_version_id
JOIN engagement_reporting.report_definition rd
  ON rd.report_definition_id = rdv.report_definition_id
WHERE rdv.config->>'template_id' IS NOT NULL
  AND (
    SELECT tb.config->>'application_id'
    FROM engagement_reporting.report_definition_version tb
    WHERE tb.config->>'template_id' = rdv.config->>'template_id'
      AND tb.config->>'application_id' IS NOT NULL
    ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
    LIMIT 1
  ) IS NOT NULL
  AND rdv.config->>'application_id' IS DISTINCT FROM (
    SELECT tb.config->>'application_id'
    FROM engagement_reporting.report_definition_version tb
    WHERE tb.config->>'template_id' = rdv.config->>'template_id'
      AND tb.config->>'application_id' IS NOT NULL
    ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
    LIMIT 1
  );
"

plan() {
  log "Schedules with application_id / template binding mismatch:"
  psql "${PG_CONN}" -c "${MISMATCH_SQL}"
}

apply() {
  [[ "${REPAIR_APPROVED:-}" == "true" ]] || die "Set REPAIR_APPROVED=true to apply fixes"
  log "Updating mismatched schedule configs from template bindings"
  psql "${PG_CONN}" -v ON_ERROR_STOP=1 <<'SQL'
UPDATE engagement_reporting.report_definition_version rdv
SET config = COALESCE(rdv.config, '{}'::jsonb) || jsonb_build_object(
  'application_id',
  (
    SELECT tb.config->>'application_id'
    FROM engagement_reporting.report_definition_version tb
    WHERE tb.config->>'template_id' = rdv.config->>'template_id'
      AND tb.config->>'application_id' IS NOT NULL
    ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
    LIMIT 1
  )
)
FROM engagement_reporting.report_schedule rs
WHERE rs.report_definition_version_id = rdv.report_definition_version_id
  AND rdv.config->>'template_id' IS NOT NULL
  AND (
    SELECT tb.config->>'application_id'
    FROM engagement_reporting.report_definition_version tb
    WHERE tb.config->>'template_id' = rdv.config->>'template_id'
      AND tb.config->>'application_id' IS NOT NULL
    ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
    LIMIT 1
  ) IS NOT NULL
  AND rdv.config->>'application_id' IS DISTINCT FROM (
    SELECT tb.config->>'application_id'
    FROM engagement_reporting.report_definition_version tb
    WHERE tb.config->>'template_id' = rdv.config->>'template_id'
      AND tb.config->>'application_id' IS NOT NULL
    ORDER BY CASE WHEN tb.config->>'kind' = 'template_only' THEN 0 ELSE 1 END
    LIMIT 1
  );
SQL
  log "Repair complete. Re-run: bash ops/runbooks/32-provision-schedulers-from-postgresql.sh plan"
}

case "${1:-plan}" in
  plan) plan ;;
  apply) apply ;;
  *) die "Usage: $0 {plan|apply}" ;;
esac
