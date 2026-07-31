#!/usr/bin/env bash
# Backfill engagement_reporting.report_run from runbook-07 audit JSON files.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)}"
if [[ -z "${REPO_ROOT}" || ! -f "${REPO_ROOT}/ops/runbooks/record-report-delivery.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

AUDIT_DIR="${AUDIT_DIR_OVERRIDE:-${REPO_ROOT}/services/engagement-pipeline/data/audit/runbook-07}"
ENVIRONMENT="${ENVIRONMENT:-production}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || stop "jq is required"
[[ -d "${AUDIT_DIR}" ]] || stop "Audit directory not found: ${AUDIT_DIR}"

infer_app_and_process() {
  local report_file="$1"
  local subject="$2"
  local application_id process_id

  if [[ "${report_file}" == *lead-tracker* || "${subject}" == *Lead\ Tracker* ]]; then
    application_id="Lead_Trcaker_A00"
    process_id="Lead_tracker_1_A00"
  elif [[ "${report_file}" == *pm-report* || "${subject}" == *Project*Task* ]]; then
    application_id="Project_Management_Tracker_A00"
    process_id="Project_Sub_Task_A01"
  else
    application_id="IT_Service_Management_A00"
    process_id="Live_IT_Service_Request_A00"
  fi

  printf '%s %s' "${application_id}" "${process_id}"
}

count=0
skipped=0

while IFS= read -r audit_file; do
  status="$(jq -r '.status // empty' "${audit_file}")"
  [[ "${status}" == "SENT" ]] || { ((skipped+=1)) || true; continue; }

  generated_at="$(jq -r '.generated_at // empty' "${audit_file}")"
  recipient="$(jq -r '.recipient // empty' "${audit_file}")"
  subject="$(jq -r '.subject // empty' "${audit_file}")"
  report_file="$(jq -r '.report_file // empty' "${audit_file}")"
  application_id="$(jq -r '.application_id // empty' "${audit_file}")"
  process_id="$(jq -r '.process_id // empty' "${audit_file}")"
  schedule_id="$(jq -r '.schedule_id // empty' "${audit_file}")"

  if [[ -z "${application_id}" || -z "${process_id}" ]]; then
    read -r application_id process_id <<< "$(infer_app_and_process "${report_file}" "${subject}")"
  fi

  ts="$(basename "${audit_file}" .json | sed 's/runbook-07-//')"
  export APPLICATION_ID="${application_id}"
  export PROCESS_ID="${process_id}"
  export ENVIRONMENT="${ENVIRONMENT}"
  export DELIVERY_STATUS="SENT"
  export RECIPIENTS="${recipient}"
  export REPORT_RUN_ID="report-run-backfill-${ts}"
  export COMPLETED_AT="${generated_at}"
  export SCHEDULE_ID="${schedule_id}"
  export SUBJECT="${subject}"

  if bash "${REPO_ROOT}/ops/runbooks/record-report-delivery.sh"; then
    ((count+=1)) || true
  else
    log "Failed to backfill ${audit_file}"
    ((skipped+=1)) || true
  fi
done < <(find "${AUDIT_DIR}" -maxdepth 1 -name 'runbook-07-*.json' | sort)

log "Backfill complete: ${count} recorded, ${skipped} skipped"
