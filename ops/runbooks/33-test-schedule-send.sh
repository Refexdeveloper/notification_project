#!/usr/bin/env bash
# ops/runbooks/33-test-schedule-send.sh
#
# Manual test: render + send one PostgreSQL schedule (override recipient optional).
#
# Usage:
#   SCHEDULE_ID=dddd1111-1111-4111-8111-111111111002 bash ops/runbooks/33-test-schedule-send.sh
#   SCHEDULE_ID=... TEST_RECIPIENT=you@refex.co.in bash ops/runbooks/33-test-schedule-send.sh
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

SCHEDULE_ID="${SCHEDULE_ID:-}"
TEST_RECIPIENT="${TEST_RECIPIENT:-}"
DRY_RUN="${DRY_RUN:-false}"

[[ -n "${SCHEDULE_ID}" ]] || { echo "SCHEDULE_ID is required"; exit 1; }

export SCHEDULE_ID
export PGDATABASE="${PGDATABASE:-engagement_reporting}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"

if [[ -n "${TEST_RECIPIENT}" ]]; then
  export RECIPIENT="${TEST_RECIPIENT}"
  export CC=""
  echo "[33] Test mode: sending only to ${TEST_RECIPIENT}"
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "[33] DRY_RUN — would execute runbook 18 with SCHEDULE_ID=${SCHEDULE_ID}"
  exit 0
fi

exec bash "${REPO_ROOT}/ops/runbooks/18-render-and-send-lead-tracker-report.sh"
