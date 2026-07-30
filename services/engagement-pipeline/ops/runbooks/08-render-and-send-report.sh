#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

log "Step 1/2: Rendering report"
bash "${REPO_ROOT}/ops/runbooks/06-render-html-report.sh"

log "Step 2/2: Sending report"
bash "${REPO_ROOT}/ops/runbooks/07-send-email-report.sh"

log "Combined render-and-send completed successfully"
