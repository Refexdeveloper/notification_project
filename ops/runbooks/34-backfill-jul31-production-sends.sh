#!/usr/bin/env bash
# Backfill report_run rows for sends that completed before delivery logging was deployed.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)}"
if [[ -z "${REPO_ROOT}" || ! -f "${REPO_ROOT}/ops/runbooks/record-report-delivery.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

ENVIRONMENT="${ENVIRONMENT:-production}"
log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

record_send() {
  local report_run_id="$1"
  local completed_at="$2"
  local application_id="$3"
  local process_id="$4"
  local recipient="$5"
  local schedule_id="${6:-}"

  export APPLICATION_ID="${application_id}"
  export PROCESS_ID="${process_id}"
  export ENVIRONMENT="${ENVIRONMENT}"
  export DELIVERY_STATUS="SENT"
  export RECIPIENTS="${recipient}"
  export REPORT_RUN_ID="${report_run_id}"
  export COMPLETED_AT="${completed_at}"
  export SCHEDULE_ID="${schedule_id}"

  bash "${REPO_ROOT}/ops/runbooks/record-report-delivery.sh"
}

log "Backfilling Jul 31 production sends (pre-logging deploy)"

record_send \
  "report-run-20260731T043333Z" \
  "2026-07-31T04:33:33Z" \
  "IT_Service_Management_A00" \
  "Live_IT_Service_Request_A00" \
  "mugesh.m@refex.co.in" \
  "55555555-5555-4555-8555-555555555555"

record_send \
  "report-run-20260731T053246Z" \
  "2026-07-31T05:32:46Z" \
  "IT_Service_Management_A00" \
  "Live_IT_Service_Request_A00" \
  "mugesh.m@refex.co.in" \
  "55555555-5555-4555-8555-555555555555"

record_send \
  "report-run-20260731T054627Z" \
  "2026-07-31T05:46:27Z" \
  "Project_Management_Tracker_A00" \
  "Project_Sub_Task_A01" \
  "pravinkumar.raja@refex.co.in" \
  "99999999-9999-4999-8999-999999999999"

record_send \
  "report-run-20260731T055513Z" \
  "2026-07-31T05:55:13Z" \
  "Project_Management_Tracker_A00" \
  "Project_Sub_Task_A01" \
  "mohamedaasik.m@refex.co.in" \
  "99999999-9999-4999-8999-999999999999"

record_send \
  "report-run-20260731T055817Z" \
  "2026-07-31T05:58:17Z" \
  "Project_Management_Tracker_A00" \
  "Project_Sub_Task_A01" \
  "mohamedaasik.m@refex.co.in" \
  "99999999-9999-4999-8999-999999999999"

record_send \
  "report-run-20260731T073616Z" \
  "2026-07-31T07:36:16Z" \
  "Project_Management_Tracker_A00" \
  "Project_Sub_Task_A01" \
  "pravinkumar.raja@refex.co.in" \
  "99999999-9999-4999-8999-999999999999"

record_send \
  "report-run-20260731T073910Z" \
  "2026-07-31T07:39:10Z" \
  "Project_Management_Tracker_A00" \
  "Project_Sub_Task_A01" \
  "mohamedaasik.m@refex.co.in" \
  "99999999-9999-4999-8999-999999999999"

log "Jul 31 send backfill complete"
