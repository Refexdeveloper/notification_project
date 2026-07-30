#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)}"
if [[ -z "${REPO_ROOT}" || ! -f "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
fi
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh"

TEMPLATES_DIR="${REPO_ROOT}/templates/generated"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-17"

GROUP_NAME="${GROUP_NAME:-Sales Team Modepro}"
WEBSITE_FILTER="${WEBSITE_FILTER:-Modepro}"
GROUP_SLUG="${GROUP_SLUG:-modepro}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || stop "node is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"

log "Rendering Lead Tracker report (${GROUP_NAME} · ${WEBSITE_FILTER})"

export REPO_ROOT GROUP_NAME WEBSITE_FILTER GROUP_SLUG
node "${REPO_ROOT}/services/engagement-pipeline/scripts/render-lead-tracker-report.js" \
  || stop "Lead Tracker render failed."

LATEST_FILE="${TEMPLATES_DIR}/lead-tracker-${GROUP_SLUG}-latest.html"
[[ -f "${LATEST_FILE}" ]] || stop "Expected output not found: ${LATEST_FILE}"

log "Lead Tracker report rendered: ${LATEST_FILE}"
