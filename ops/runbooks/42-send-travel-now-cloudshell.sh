#!/usr/bin/env bash
# ops/runbooks/42-send-travel-now-cloudshell.sh
#
# Run in Google Cloud Shell (gcloud + psql to Cloud SQL work there).
# 1) Bind Travel schedules to legacy Cloud Scheduler job names
# 2) Sync scheduler jobs → live schedule UUIDs
# 3) Send Venwind + Refex test emails (incremental ingest → render → SMTP)
#
# Usage:
#   TEST_RECIPIENT=mohamedaasik.m@refex.co.in bash ops/runbooks/42-send-travel-now-cloudshell.sh
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
RUNNER="${SCHEDULE_RUNNER_URL:-https://refex-schedule-runner-645830234926.asia-south1.run.app}"
TEST_RECIPIENT="${TEST_RECIPIENT:-mohamedaasik.m@refex.co.in}"
TRAVEL_APP="Expense_and_Travel_Management_A00"
VENWIND_ID="d4cc8f6d-c3da-4bc2-9f9b-ca0ae159fffe"
REFEX_ID="c5c3cc0c-2702-4018-a9eb-10fea3bde379"

log() { printf '\n[%s] %s\n' "$(date -u +'%H:%M:%SZ')" "$*"; }
die() { log "STOP: $*"; exit 1; }

command -v gcloud >/dev/null 2>&1 || die "Run this in Cloud Shell (gcloud required)."
command -v curl >/dev/null 2>&1 || die "curl required."
command -v psql >/dev/null 2>&1 || die "psql required."

# Cloud SQL via proxy socket (Cloud Shell: use public IP or existing proxy)
if [[ -z "${PGHOST:-}" ]]; then
  export PGHOST="${PGHOST:-127.0.0.1}"
  log "PGHOST not set — ensure Cloud SQL proxy is running or export PGHOST/PGPASSWORD"
fi
export PGDATABASE="${PGDATABASE:-engagement_reporting}"
export PGUSER="${PGUSER:-postgres}"

log "Step 1/3: Bind legacy Cloud Scheduler names on active Travel schedules"
psql "host=${PGHOST} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1 <<SQL
UPDATE engagement_reporting.report_definition_version rdv
SET config = COALESCE(rdv.config, '{}'::jsonb) || '{"legacy_scheduler_id":"sch-refex-travel-daily"}'::jsonb
FROM engagement_reporting.report_schedule rs
WHERE rs.report_definition_version_id = rdv.report_definition_version_id
  AND rdv.config->>'application_id' = '${TRAVEL_APP}'
  AND lower(coalesce(rdv.config->>'entity_filter', 'venwind')) IN ('venwind', '')
  AND rs.is_active = true;

UPDATE engagement_reporting.report_definition_version rdv
SET config = COALESCE(rdv.config, '{}'::jsonb) || '{"legacy_scheduler_id":"sch-refex-travel-daily-refex"}'::jsonb
FROM engagement_reporting.report_schedule rs
WHERE rs.report_definition_version_id = rdv.report_definition_version_id
  AND rdv.config->>'application_id' = '${TRAVEL_APP}'
  AND lower(coalesce(rdv.config->>'entity_filter', '')) = 'refex'
  AND rs.is_active = true;
SQL

log "Step 2/3: Sync Cloud Scheduler jobs (fixes daily 3 PM sends)"
export SCHEDULE_RUNNER_URL="${RUNNER}"
export APPLICATION_ID="${TRAVEL_APP}"
export PROVISION_APPROVED=true
bash "${REPO_ROOT}/ops/runbooks/32-provision-schedulers-from-postgresql.sh" sync

log "Step 3/3: Test send Venwind + Refex → ${TEST_RECIPIENT} (incremental ingest on schedule-runner)"
TOKEN="$(gcloud auth print-identity-token --audiences="${RUNNER}")"

send_one() {
  local label="$1" sid="$2"
  log "Sending ${label} (schedule ${sid})…"
  local out rc=0
  out="$(curl -sS -m 900 -H "Authorization: Bearer ${TOKEN}" \
    "${RUNNER}/?schedule_id=${sid}&test_recipient=${TEST_RECIPIENT}" 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    log "curl exit ${rc}"
  fi
  if grep -q "Email sent successfully\|test send completed\|Travel Management test send completed" <<< "${out}"; then
    log "${label}: SENT OK"
  elif grep -q "STOP:" <<< "${out}"; then
    log "${label}: FAILED"
    grep "STOP:" <<< "${out}" | tail -3
    die "${label} failed — see STOP above"
  else
    log "${label}: response tail:"
    tail -20 <<< "${out}"
  fi
}

send_one "Venwind" "${VENWIND_ID}"
send_one "Refex" "${REFEX_ID}"

log "Done. Check inbox ${TEST_RECIPIENT} and Admin UI → Travel → Sent."
