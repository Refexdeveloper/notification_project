#!/usr/bin/env bash
# ops/runbooks/41-travel-full-ingest-dual-test-send.sh
#
# Queue full-ingest Travel test emails for Venwind + Refex (one report each).
# Requires backend-api + schedule-runner deployed with full_ingest support.
#
# Usage:
#   TEST_RECIPIENT=mohamedaasik.m@refex.co.in bash ops/runbooks/41-travel-full-ingest-dual-test-send.sh
#   BACKEND_API_URL=https://refex-backend-api-xxx.run.app TEST_RECIPIENT=you@refex.co.in bash ops/runbooks/41-travel-full-ingest-dual-test-send.sh
#
set -euo pipefail

BACKEND_API_URL="${BACKEND_API_URL:-https://refex-backend-api-dhwffeu7pq-el.a.run.app}"
TEST_RECIPIENT="${TEST_RECIPIENT:-mohamedaasik.m@refex.co.in}"
SYNC_TOKEN="${INCREMENTAL_SYNC_TOKEN:-refex-incremental-sync-master-diorama-489103-u2}"

VENWIND_ID="d4cc8f6d-c3da-4bc2-9f9b-ca0ae159fffe"
REFEX_ID="c5c3cc0c-2702-4018-a9eb-10fea3bde379"
APP_ID="Expense_and_Travel_Management_A00"

log() { printf '[41] %s\n' "$*"; }

queue_one() {
  local entity="$1" schedule_id="$2"
  log "Queue ${entity} full-ingest test → ${TEST_RECIPIENT}"
  curl -fsS -X POST \
    "${BACKEND_API_URL}/api/v1/applications/${APP_ID}/schedules/${schedule_id}/test-send?environment=production" \
    -H "Content-Type: application/json" \
    -H "x-sync-token: ${SYNC_TOKEN}" \
    -d "{\"test_recipient\":\"${TEST_RECIPIENT}\",\"full_ingest\":true,\"async\":true}" \
    | head -c 800
  echo ""
}

log "Queuing Venwind + Refex Travel reports (async; allow 5–15 min)"
queue_one "Venwind" "${VENWIND_ID}"
queue_one "Refex" "${REFEX_ID}"
log "Done. Check ${TEST_RECIPIENT} inbox and Admin UI → Sent history."
