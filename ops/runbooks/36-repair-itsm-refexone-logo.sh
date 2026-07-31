#!/usr/bin/env bash
# Replace legacy refex-logo.png with refexone-logo.png in PostgreSQL templates + clear stale HTML cache.
set -Eeuo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

log() { printf '[runbook-36] %s\n' "$*"; }

PSQL=(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1)

log "Updating published template HTML to refexOne logo"
"${PSQL[@]}" -c "
UPDATE engagement_reporting.report_template_version
SET content_ref = replace(
  replace(content_ref, 'refex-logo.png', 'refexone-logo.png'),
  'alt=\"Refex\"',
  'alt=\"refexOne\"'
)
WHERE content_ref ILIKE '%refex-logo%'
   OR content_ref ILIKE '%alt=\"Refex\"%';
"

log "Re-seeding ITSM template from db/seeds/itsm-engagement-template.html (if runbook 23 available)"
if [[ -f "${REPO_ROOT}/ops/runbooks/23-seed-itsm-report-config.sh" ]]; then
  bash "${REPO_ROOT}/ops/runbooks/23-seed-itsm-report-config.sh" || log "Warning: ITSM seed runbook failed (non-fatal)"
fi

log "Clearing cached ITSM report HTML so next send uses fresh refexOne branding"
"${PSQL[@]}" -c "
DELETE FROM engagement_reporting.report_html_cache
WHERE cache_key LIKE 'itsm:%';
" 2>/dev/null || log "report_html_cache table not present yet — skipped"

log "Done. Redeploy schedule-runner or trigger one ITSM send to verify refexOne logo in live email."
