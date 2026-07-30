#!/usr/bin/env bash
# ops/runbooks/31-scheduler-cutover-checklist.sh
#
# Controlled scheduler cutover — legacy full-pipeline → new stack.
# Does NOT pause legacy scheduler unless CUTover_APPROVED=true.
#
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
LEGACY_SCHEDULER="${LEGACY_SCHEDULER:-aasik-refex-report-itsm-a00-svcreq-a00-scheduler}"
LEGACY_SERVICE="${LEGACY_SERVICE:-aasik-refex-report-itsm-a00-svcreq-a00-full-pipeline}"

log() { printf '[runbook-31] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

plan() {
  log "Scheduler cutover checklist"
  log ""
  log "Pre-cutover (must pass):"
  log "  [ ] Runbook 29 shadow compare — cloud counts match baseline"
  log "  [ ] Test-recipient email send via new pipeline (not production list)"
  log "  [ ] Report HTML checksum matches legacy for same period"
  log "  [ ] IAP live OR explicit approval to keep ALLOW_DEV_AUTH_STUB"
  log ""
  log "Legacy (do not delete):"
  log "  Service:  ${LEGACY_SERVICE}"
  log "  Scheduler: ${LEGACY_SCHEDULER}"
  if command -v gcloud >/dev/null 2>&1; then
    gcloud scheduler jobs describe "${LEGACY_SCHEDULER}" \
      --location="${GCP_REGION}" --project="${GCP_PROJECT}" \
      --format='table(name,schedule,state,httpTarget.uri)' 2>/dev/null || true
  fi
  log ""
  log "Cutover steps (require CUTover_APPROVED=true):"
  log "  1. Pause ${LEGACY_SCHEDULER}"
  log "  2. Activate new Cloud Scheduler jobs (per-app, PostgreSQL schedules)"
  log "  3. Observe 7+ days"
  log "  4. Decommission ${LEGACY_SERVICE} only after stability sign-off"
  log ""
  log "Rollback: re-enable ${LEGACY_SCHEDULER}, disable new schedulers"
}

pause_legacy() {
  [[ "${CUTover_APPROVED:-}" == "true" ]] || die "Set CUTover_APPROVED=true to pause legacy scheduler"
  gcloud scheduler jobs pause "${LEGACY_SCHEDULER}" \
    --location="${GCP_REGION}" --project="${GCP_PROJECT}"
  log "Paused ${LEGACY_SCHEDULER}"
}

resume_legacy() {
  [[ "${CUTover_APPROVED:-}" == "true" ]] || die "Set CUTover_APPROVED=true"
  gcloud scheduler jobs resume "${LEGACY_SCHEDULER}" \
    --location="${GCP_REGION}" --project="${GCP_PROJECT}"
  log "Resumed ${LEGACY_SCHEDULER}"
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  pause-legacy) pause_legacy ;;
  resume-legacy) resume_legacy ;;
  *) die "Usage: $0 {plan|pause-legacy|resume-legacy}" ;;
esac
