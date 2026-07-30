#!/usr/bin/env bash
# ops/runbooks/29-shadow-compare-cloud-vs-legacy.sh
#
# Read-only shadow comparison: new backend-api (Cloud Run) vs legacy pipeline data.
# Does not mutate GCP or send emails.
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

BACKEND_URL="${BACKEND_URL:-https://refex-backend-api-645830234926.asia-south1.run.app}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${REPO_ROOT}/data/audit/runbook-29/shadow-compare-${TIMESTAMP}.json"
mkdir -p "$(dirname "${OUT}")"

log() { printf '[runbook-29] %s\n' "$*"; }

fetch_json() {
  local path="$1"
  curl -fsS "${BACKEND_URL}${path}" 2>/dev/null || echo '{"success":false}'
}

log "Backend: ${BACKEND_URL}"

APPS="$(fetch_json '/api/v1/applications')"
APP_COUNT="$(printf '%s' "$APPS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('count',0) if d.get('success') else 'ERR')" 2>/dev/null || echo ERR)"

LT_PROCESSES="$(fetch_json '/api/v1/applications/Lead_Trcaker_A00/processes?environment=production')"
LT_PROC_COUNT="$(printf '%s' "$LT_PROCESSES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('count',0) if d.get('success') else 'ERR')" 2>/dev/null || echo ERR)"

LT_FIELDS="$(fetch_json '/api/v1/applications/Lead_Trcaker_A00/processes/Lead_tracker_1_A00/fields?environment=production')"
LT_FIELD_COUNT="$(printf '%s' "$LT_FIELDS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('fields',[])) if d.get('success') else 'ERR')" 2>/dev/null || echo ERR)"

LT_ENG="$(fetch_json '/api/v1/applications/Lead_Trcaker_A00/engagement?environment=production')"
LT_USER_COUNT="$(printf '%s' "$LT_ENG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('items',[])) if d.get('success') else 'ERR')" 2>/dev/null || echo ERR)"

LT_TEMPLATES="$(fetch_json '/api/v1/applications/Lead_Trcaker_A00/templates?environment=production')"
LT_TEMPLATE_COUNT="$(printf '%s' "$LT_TEMPLATES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('items',[])) if d.get('success') else 'ERR')" 2>/dev/null || echo ERR)"

LT_SCHEDULES="$(fetch_json '/api/v1/applications/Lead_Trcaker_A00/schedules?environment=production')"
LT_SCHEDULE_COUNT="$(printf '%s' "$LT_SCHEDULES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('items',[])) if d.get('success') else 'ERR')" 2>/dev/null || echo ERR)"

READY="$(fetch_json '/api/v1/ready')"
DB_READY="$(printf '%s' "$READY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success',False))" 2>/dev/null || echo false)"

LEGACY_SCHEDULER="${LEGACY_SCHEDULER:-aasik-refex-report-itsm-a00-svcreq-a00-scheduler}"
LEGACY_SERVICE="${LEGACY_SERVICE:-aasik-refex-report-itsm-a00-svcreq-a00-full-pipeline}"
LEGACY_SCHEDULER_STATE="unknown"
if command -v gcloud >/dev/null 2>&1; then
  LEGACY_SCHEDULER_STATE="$(gcloud scheduler jobs describe "${LEGACY_SCHEDULER}" --location=asia-south1 --project=master-diorama-489103-u2 --format='value(state)' 2>/dev/null || echo unknown)"
fi

cat > "${OUT}" <<EOF
{
  "generated_at": "${TIMESTAMP}",
  "mode": "SHADOW_COMPARE_READ_ONLY",
  "backend_url": "${BACKEND_URL}",
  "database_ready": ${DB_READY},
  "cloud_api_counts": {
    "applications": ${APP_COUNT},
    "lead_tracker_processes": ${LT_PROC_COUNT},
    "lead_tracker_fields": ${LT_FIELD_COUNT},
    "lead_tracker_engagement_users": ${LT_USER_COUNT},
    "lead_tracker_templates": ${LT_TEMPLATE_COUNT},
    "lead_tracker_schedules": ${LT_SCHEDULE_COUNT}
  },
  "legacy_pipeline": {
    "cloud_run_service": "${LEGACY_SERVICE}",
    "scheduler_job": "${LEGACY_SCHEDULER}",
    "scheduler_state": "${LEGACY_SCHEDULER_STATE}"
  },
  "expected_baseline_from_local_ingest": {
    "lead_tracker_fields": 63,
    "lead_tracker_users": 17,
    "lead_tracker_templates_min": 1,
    "lead_tracker_schedules_min": 1
  },
  "cutover_gate": "Do not pause legacy scheduler until report checksum + test-recipient send match",
  "next_runbooks": [
    "30-iap-load-balancer-setup.sh plan",
    "31-scheduler-cutover-checklist.sh plan"
  ]
}
EOF

log "Report: ${OUT}"
log "Database ready: ${DB_READY}"
log "Applications (cloud): ${APP_COUNT}"
log "Lead Tracker — processes: ${LT_PROC_COUNT}, fields: ${LT_FIELD_COUNT}, users: ${LT_USER_COUNT}, templates: ${LT_TEMPLATE_COUNT}, schedules: ${LT_SCHEDULE_COUNT}"
log "Legacy scheduler state: ${LEGACY_SCHEDULER_STATE} (unchanged)"
log ""
log "Shadow compare complete (read-only). Review JSON before scheduler cutover."

python3 -m json.tool "${OUT}" 2>/dev/null | head -40
