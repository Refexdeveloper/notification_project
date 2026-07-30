#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

log "Step 1/2: Rendering PM report"
bash "${REPO_ROOT}/ops/runbooks/14-render-pm-html-report.sh"

log "Step 2/2: Sending PM report"
export REPORT_FILE_OVERRIDE="${REPO_ROOT}/templates/generated/pm-report-latest.html"
export SUBJECT="${SUBJECT:-Kissflow - Project Task Report}"
bash "${REPO_ROOT}/ops/runbooks/07-send-email-report.sh"

log "PM render-and-send completed successfully"
