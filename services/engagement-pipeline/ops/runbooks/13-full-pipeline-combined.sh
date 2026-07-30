#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

log "STAGE 1/4: Ingest ITSM data from Kissflow and load into PostgreSQL"
bash "${REPO_ROOT}/ops/runbooks/09-ingest-and-load.sh"

log "STAGE 2/4: Ingest Project Management data from Kissflow and load into PostgreSQL"
bash "${REPO_ROOT}/ops/runbooks/12-ingest-pm-and-load.sh"

log "STAGE 3/4: Render combined HTML report"
bash "${REPO_ROOT}/ops/runbooks/11-render-combined-report.sh"

log "STAGE 4/4: Send combined email report"
export REPORT_FILE_OVERRIDE="${REPO_ROOT}/templates/generated/combined-report-latest.html"
bash "${REPO_ROOT}/ops/runbooks/07-send-email-report.sh"

log "Combined full pipeline completed successfully"
