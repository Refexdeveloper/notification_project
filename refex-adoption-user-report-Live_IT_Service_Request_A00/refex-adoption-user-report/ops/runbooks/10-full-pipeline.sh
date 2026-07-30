#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

log "STAGE 1/3: Ingest from Kissflow and load into PostgreSQL"
bash "${REPO_ROOT}/ops/runbooks/09-ingest-and-load.sh"

log "STAGE 2/3: Render HTML report"
bash "${REPO_ROOT}/ops/runbooks/06-render-html-report.sh"

log "STAGE 3/3: Send email report"
bash "${REPO_ROOT}/ops/runbooks/07-send-email-report.sh"

log "Full pipeline completed successfully"
