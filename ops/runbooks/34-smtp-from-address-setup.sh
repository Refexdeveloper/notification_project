#!/usr/bin/env bash
# ops/runbooks/34-smtp-from-address-setup.sh
#
# Verify Gmail / Google Workspace sender authorization for scheduled reports.
# The Admin UI "From" field must match an SMTP-authorized mailbox or verified alias.
#
# Usage:
#   bash ops/runbooks/34-smtp-from-address-setup.sh plan
#   FROM_EMAIL=reports@refex.co.in bash ops/runbooks/34-smtp-from-address-setup.sh check
#   FROM_EMAIL=reports@refex.co.in TEST_RECIPIENT=you@refex.co.in bash ops/runbooks/34-smtp-from-address-setup.sh test-send
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

FROM_EMAIL="${FROM_EMAIL:-reports@refex.co.in}"
TEST_RECIPIENT="${TEST_RECIPIENT:-}"
GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"

log() { printf '[runbook-34] %s\n' "$*"; }

plan() {
  log "SMTP From address setup"
  log ""
  log "Problem: Gmail rejects or rewrites From when it differs from the authenticated SMTP user."
  log ""
  log "Fix (pick one):"
  log "  A) Dedicated mailbox — set engagement-report-smtp-user to reports@refex.co.in + app password"
  log "  B) Send mail as — add reports@ as verified alias on the SMTP login user in Gmail settings"
  log "  C) Test — set schedule From to the same address as SMTP login until A/B is done"
  log ""
  log "Secrets (GCP Secret Manager, project ${GCP_PROJECT}):"
  log "  engagement-report-smtp-user"
  log "  engagement-report-smtp-app-password"
  log ""
  log "Verify:"
  log "  FROM_EMAIL=${FROM_EMAIL} $0 check"
  log "  SCHEDULE_ID=<uuid> TEST_RECIPIENT=you@refex.co.in bash ops/runbooks/33-test-schedule-send.sh"
}

check() {
  # shellcheck source=/dev/null
  source "${REPO_ROOT}/ops/runbooks/load-smtp-creds.sh"
  log "SMTP login (Secret Manager): ${SMTP_USER:-<not set>}"
  log "Desired From (schedule):      ${FROM_EMAIL}"
  if [[ -z "${SMTP_USER:-}" ]]; then
    log "WARN: SMTP_USER not loaded"
    exit 1
  fi
  local smtp_lc from_lc
  smtp_lc="$(printf '%s' "${SMTP_USER}" | tr '[:upper:]' '[:lower:]')"
  from_lc="$(printf '%s' "${FROM_EMAIL}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${smtp_lc}" == "${from_lc}" ]]; then
    log "OK: From matches SMTP login — sends should work"
    exit 0
  fi
  log "ACTION REQUIRED: From differs from SMTP login."
  log "  Either change schedule From to ${SMTP_USER}"
  log "  Or authorize ${FROM_EMAIL} as 'Send mail as' on ${SMTP_USER} in Google Workspace"
  exit 2
}

test_send() {
  [[ -n "${TEST_RECIPIENT}" ]] || { log "Set TEST_RECIPIENT for test send"; exit 1; }
  [[ -n "${SCHEDULE_ID:-}" ]] || { log "Set SCHEDULE_ID (PostgreSQL report_schedule_id)"; exit 1; }
  export FROM_EMAIL
  export RECIPIENT="${TEST_RECIPIENT}"
  bash "${REPO_ROOT}/ops/runbooks/33-test-schedule-send.sh"
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  check) check ;;
  test-send) test_send ;;
  *) log "Usage: $0 {plan|check|test-send}"; exit 1 ;;
esac
