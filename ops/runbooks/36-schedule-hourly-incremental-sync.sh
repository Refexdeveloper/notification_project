#!/usr/bin/env bash
# ops/runbooks/36-schedule-hourly-incremental-sync.sh
#
# Create/update Cloud Scheduler job that hits backend-api hourly for
# in-progress + newly modified field sync (+ stale engagement refresh).
# Default: weekdays Mon–Fri, 09:00–18:00 Asia/Kolkata (no weekends).
#
# Usage:
#   DEPLOY_APPROVED=true bash ops/runbooks/36-schedule-hourly-incremental-sync.sh
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
BACKEND_URL="${BACKEND_URL:-https://refex-backend-api-645830234926.asia-south1.run.app}"
JOB_NAME="${JOB_NAME:-refex-hourly-incremental-sync}"
SYNC_TOKEN="${INCREMENTAL_SYNC_TOKEN:-refex-incremental-sync-${GCP_PROJECT}}"
# Minute 0 of hours 9–18, Monday–Friday
SCHEDULE="${SCHEDULE:-0 9-18 * * 1-5}"
TIME_ZONE="${TIME_ZONE:-Asia/Kolkata}"

log() { printf '[runbook-36] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

[[ "${DEPLOY_APPROVED:-}" == "true" ]] || die "Set DEPLOY_APPROVED=true"

URI="${BACKEND_URL}/api/v1/ops/incremental-sync?environment=production&token=${SYNC_TOKEN}"

if gcloud scheduler jobs describe "${JOB_NAME}" --location="${GCP_REGION}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  log "Updating scheduler job ${JOB_NAME}"
  gcloud scheduler jobs update http "${JOB_NAME}" \
    --project="${GCP_PROJECT}" \
    --location="${GCP_REGION}" \
    --schedule="${SCHEDULE}" \
    --time-zone="${TIME_ZONE}" \
    --uri="${URI}" \
    --http-method=POST \
    --update-headers="Content-Type=application/json,X-Sync-Token=${SYNC_TOKEN}" \
    --message-body='{"refresh_engagement":true,"environment":"production"}' \
    --attempt-deadline=540s
else
  log "Creating scheduler job ${JOB_NAME}"
  gcloud scheduler jobs create http "${JOB_NAME}" \
    --project="${GCP_PROJECT}" \
    --location="${GCP_REGION}" \
    --schedule="${SCHEDULE}" \
    --time-zone="${TIME_ZONE}" \
    --uri="${URI}" \
    --http-method=POST \
    --headers="Content-Type=application/json,X-Sync-Token=${SYNC_TOKEN}" \
    --message-body='{"refresh_engagement":true,"environment":"production"}' \
    --attempt-deadline=540s
fi

log "Done. Job: ${JOB_NAME} (${SCHEDULE} ${TIME_ZONE})"
log "Target: ${BACKEND_URL}/api/v1/ops/incremental-sync"
