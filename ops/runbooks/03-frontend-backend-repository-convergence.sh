#!/usr/bin/env bash
# ops/runbooks/03-frontend-backend-repository-convergence.sh
#
# Purpose: Establish canonical monorepo layout; preserve working FE and BE pipeline.
# Idempotent: skips moves when target already exists.
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-03"
mkdir -p "${AUDIT_DIR}" \
  apps services packages \
  cloudbuild config tests openapi \
  db/migrations db/seeds

REPORT="${AUDIT_DIR}/convergence-${TIMESTAMP}.txt"
exec > >(tee -a "${REPORT}") 2>&1

echo "Runbook 03: frontend/backend repository convergence @ ${TIMESTAMP}"

move_if_needed() {
  local src="$1"
  local dst="$2"
  if [[ -e "${dst}" ]]; then
    echo "SKIP (exists): ${dst}"
    return 0
  fi
  if [[ ! -e "${src}" ]]; then
    echo "SKIP (missing source): ${src}"
    return 0
  fi
  mkdir -p "$(dirname "${dst}")"
  git mv "${src}" "${dst}"
  echo "MOVED: ${src} -> ${dst}"
}

# --- Canonical layout ---
move_if_needed "NotifictaionEngine/client" "apps/admin-ui"
move_if_needed "NotifictaionEngine/server" "services/prototype-mysql-api"
move_if_needed \
  "refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report" \
  "services/engagement-pipeline"

# --- Consolidate db assets at repo root ---
if [[ -f "services/engagement-pipeline/db/migrations/001-canonical-engagement-model.sql" ]]; then
  if [[ ! -f "db/migrations/001-canonical-engagement-model.sql" ]]; then
    git mv "services/engagement-pipeline/db/migrations/001-canonical-engagement-model.sql" \
      "db/migrations/001-canonical-engagement-model.sql"
  fi
fi
if [[ -f "services/engagement-pipeline/db/contracts/canonical-load-contract.json" ]]; then
  if [[ ! -f "db/contracts/canonical-load-contract.json" ]]; then
    git mv "services/engagement-pipeline/db/contracts/canonical-load-contract.json" \
      "db/contracts/canonical-load-contract.json"
  fi
fi

# --- Docs ---
if [[ -f "NotifictaionEngine/project_plan.md" ]]; then
  move_if_needed "NotifictaionEngine/project_plan.md" "docs/architecture/notification-engine-project-plan.md"
fi

# --- Cleanup empty wrappers ---
rmdir NotifictaionEngine 2>/dev/null || true
rmdir refex-adoption-user-report-Live_IT_Service_Request_A00 2>/dev/null || true

# --- Admin UI runtime API config ---
ADMIN_ENV_EXAMPLE="apps/admin-ui/.env.example"
if [[ -f "${ADMIN_ENV_EXAMPLE}" ]] && ! grep -q 'VITE_API_BASE_URL' "${ADMIN_ENV_EXAMPLE}"; then
  cat >> "${ADMIN_ENV_EXAMPLE}" <<'EOF'

# Backend API base URL (runtime — never hardcode private IPs)
VITE_API_BASE_URL=http://localhost:8080/api/v1
EOF
fi

# --- Package placeholders ---
for pkg in api-contracts database-models kissflow-client event-contracts shared-observability; do
  mkdir -p "packages/${pkg}"
  if [[ ! -f "packages/${pkg}/README.md" ]]; then
    cat > "packages/${pkg}/README.md" <<EOF
# packages/${pkg}

Placeholder for converged Refex User Engagement Report Engine shared package.
See \`docs/architecture/target-architecture.md\`.
EOF
    git add "packages/${pkg}/README.md"
  fi
done

# --- Root package.json for workspace orchestration ---
if [[ ! -f "package.json" ]]; then
  cat > "package.json" <<'EOF'
{
  "name": "refex-user-engagement-report-engine",
  "private": true,
  "version": "0.1.0",
  "description": "Refex User Engagement Report platform — admin UI, backend API, ingestion, rendering, delivery",
  "workspaces": [
    "apps/admin-ui",
    "services/prototype-mysql-api",
    "packages/*"
  ],
  "scripts": {
    "preflight:secrets": "bash ops/runbooks/02-secret-and-sensitive-data-preflight.sh",
    "test:repo": "bash tests/run-repo-tests.sh"
  }
}
EOF
  git add package.json
fi

echo "Runbook 03 complete."
