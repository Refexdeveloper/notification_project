#!/usr/bin/env bash
# ops/runbooks/01-inspect-repository-convergence-state.sh
#
# Purpose: Read-only repository convergence inspection.
# Mutations: NONE to application source. Writes audit artifacts only.
# Idempotent: Safe to re-run; overwrites same-run audit outputs with fresh scan.
# Bash 3.2 compatible.
#
set -euo pipefail

RUNBOOK_ID="runbook-01"
RUNBOOK_NAME="inspect-repository-convergence-state"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Resolve repository root (must be inside a git work tree).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "ERROR: Not inside a git repository." >&2
  exit 1
fi
cd "${REPO_ROOT}"

AUDIT_DIR="${REPO_ROOT}/data/audit/${RUNBOOK_ID}"
DOCS_DIR="${REPO_ROOT}/docs/architecture"
CONTRACT_DIR="${REPO_ROOT}/db/contracts"
mkdir -p "${AUDIT_DIR}" "${DOCS_DIR}" "${CONTRACT_DIR}"

SUMMARY_JSON="${AUDIT_DIR}/${RUNBOOK_NAME}-${TIMESTAMP}.json"
MUTATION_REPORT="${AUDIT_DIR}/${RUNBOOK_NAME}-${TIMESTAMP}-mutation-report.txt"

echo "Runbook ${RUNBOOK_ID}: ${RUNBOOK_NAME}" | tee "${MUTATION_REPORT}"
echo "Repository root: ${REPO_ROOT}" | tee -a "${MUTATION_REPORT}"
echo "Timestamp (UTC): ${TIMESTAMP}" | tee -a "${MUTATION_REPORT}"
echo "Working directory: $(pwd)" | tee -a "${MUTATION_REPORT}"
echo "Mutation policy: audit outputs only" | tee -a "${MUTATION_REPORT}"

# --- Git context ---
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_REMOTE="$(git remote get-url origin 2>/dev/null || echo none)"
GIT_STATUS_LINES="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

# --- Locate candidate roots ---
FRONTEND_ROOT=""
BACKEND_ROOT=""
LEGACY_PIPELINE_ROOT=""

if [[ -d "${REPO_ROOT}/NotifictaionEngine/client" ]]; then
  FRONTEND_ROOT="${REPO_ROOT}/NotifictaionEngine/client"
fi
if [[ -d "${REPO_ROOT}/NotifictaionEngine/server" ]]; then
  BACKEND_ROOT="${REPO_ROOT}/NotifictaionEngine/server"
fi
if [[ -d "${REPO_ROOT}/refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report" ]]; then
  LEGACY_PIPELINE_ROOT="${REPO_ROOT}/refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report"
fi

# --- Count tracked artifacts ---
TRACKED_FILES="$(git ls-files 2>/dev/null | wc -l | tr -d ' ')"
DISCOVERY_FILES=0
if [[ -n "${LEGACY_PIPELINE_ROOT}" ]]; then
  DISCOVERY_FILES="$(git ls-files "${LEGACY_PIPELINE_ROOT}/data/discovery/" 2>/dev/null | wc -l | tr -d ' ')"
fi

# --- Detect frameworks (best-effort from package.json presence) ---
FE_FRAMEWORK="unknown"
BE_FRAMEWORK="unknown"
if [[ -f "${FRONTEND_ROOT}/package.json" ]]; then
  if grep -q '"react"' "${FRONTEND_ROOT}/package.json" 2>/dev/null; then
    FE_FRAMEWORK="react-vite-typescript"
  fi
fi
if [[ -f "${BACKEND_ROOT}/package.json" ]]; then
  if grep -q '"express"' "${BACKEND_ROOT}/package.json" 2>/dev/null; then
    BE_FRAMEWORK="express-sequelize-mysql"
  fi
fi

PIPELINE_RUNTIME="unknown"
if [[ -f "${LEGACY_PIPELINE_ROOT}/entrypoint.py" ]]; then
  PIPELINE_RUNTIME="bash-runbooks-python-http-entrypoint"
fi

# --- Existing runbooks ---
LEGACY_RUNBOOK_COUNT=0
ROOT_RUNBOOK_COUNT=0
if [[ -d "${LEGACY_PIPELINE_ROOT}/ops/runbooks" ]]; then
  LEGACY_RUNBOOK_COUNT="$(find "${LEGACY_PIPELINE_ROOT}/ops/runbooks" -maxdepth 1 -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')"
fi
if [[ -d "${REPO_ROOT}/ops/runbooks" ]]; then
  ROOT_RUNBOOK_COUNT="$(find "${REPO_ROOT}/ops/runbooks" -maxdepth 1 -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')"
fi

# --- Cloud build / docker detection ---
HAS_ROOT_DOCKER="false"
HAS_LEGACY_DOCKER="false"
HAS_CLOUDBUILD="false"
[[ -f "${REPO_ROOT}/Dockerfile" ]] && HAS_ROOT_DOCKER="true"
[[ -f "${LEGACY_PIPELINE_ROOT}/Dockerfile" ]] && HAS_LEGACY_DOCKER="true"
if find "${REPO_ROOT}" -name 'cloudbuild*.yaml' -o -name 'cloudbuild*.yml' 2>/dev/null | grep -q .; then
  HAS_CLOUDBUILD="true"
fi

# --- Migration tooling ---
PG_MIGRATION=""
if [[ -f "${LEGACY_PIPELINE_ROOT}/db/migrations/001-canonical-engagement-model.sql" ]]; then
  PG_MIGRATION="${LEGACY_PIPELINE_ROOT}/db/migrations/001-canonical-engagement-model.sql"
fi
MYSQL_SYNC="sequelize.sync"
if [[ -f "${BACKEND_ROOT}/scripts/sync_db.js" ]]; then
  MYSQL_SYNC="${BACKEND_ROOT}/scripts/sync_db.js"
fi

# --- Duplicate package detection ---
DUPLICATE_PACKAGE_ROOTS=""
if [[ -n "${FRONTEND_ROOT}" && -n "${BACKEND_ROOT}" ]]; then
  DUPLICATE_PACKAGE_ROOTS="NotifictaionEngine/{client,server} under single monorepo folder"
fi

# --- Risk flags (pattern names only, no secret values) ---
RISK_HARDCODED_DB_PASSWORD="false"
if [[ -f "${BACKEND_ROOT}/config/config.js" ]]; then
  if grep -q "RefexAdmin@123" "${BACKEND_ROOT}/config/config.js" 2>/dev/null; then
    RISK_HARDCODED_DB_PASSWORD="true"
  fi
fi

RISK_KISSFLOW_CREDS_IN_MYSQL_MODEL="false"
if [[ -f "${BACKEND_ROOT}/models/Application.js" ]]; then
  if grep -q "access_key_secret" "${BACKEND_ROOT}/models/Application.js" 2>/dev/null; then
    RISK_KISSFLOW_CREDS_IN_MYSQL_MODEL="true"
  fi
fi

RISK_CUSTOMER_PAYLOAD_IN_GIT="false"
if [[ "${DISCOVERY_FILES}" -gt 0 ]]; then
  RISK_CUSTOMER_PAYLOAD_IN_GIT="true"
fi

RISK_FE_KISSFLOW_DIRECT="false"
if [[ -f "${FRONTEND_ROOT}/vite-kissflow-proxy.ts" ]]; then
  RISK_FE_KISSFLOW_DIRECT="true"
fi

RISK_BINARY_IN_GIT="false"
if git ls-files 2>/dev/null | grep -q 'google-cloud-cli.*\.tar\.gz'; then
  RISK_BINARY_IN_GIT="true"
fi

# --- Write machine-readable contract ---
cat > "${CONTRACT_DIR}/repository-convergence.json" <<EOF
{
  "contract_version": "1.0.0",
  "generated_at": "${TIMESTAMP}",
  "runbook_id": "${RUNBOOK_ID}",
  "git": {
    "root": "${REPO_ROOT}",
    "branch": "${GIT_BRANCH}",
    "sha": "${GIT_SHA}",
    "remote_origin": "${GIT_REMOTE}",
    "dirty_file_count": ${GIT_STATUS_LINES},
    "tracked_file_count": ${TRACKED_FILES}
  },
  "discovered_roots": {
    "frontend_admin_ui": "${FRONTEND_ROOT}",
    "prototype_mysql_backend": "${BACKEND_ROOT}",
    "legacy_engagement_pipeline": "${LEGACY_PIPELINE_ROOT}"
  },
  "frameworks": {
    "frontend": "${FE_FRAMEWORK}",
    "prototype_backend": "${BE_FRAMEWORK}",
    "legacy_pipeline": "${PIPELINE_RUNTIME}"
  },
  "runbooks": {
    "repository_root_count": ${ROOT_RUNBOOK_COUNT},
    "legacy_pipeline_count": ${LEGACY_RUNBOOK_COUNT},
    "legacy_runbook_range": "01-13"
  },
  "deployment_artifacts": {
    "root_dockerfile": ${HAS_ROOT_DOCKER},
    "legacy_dockerfile": ${HAS_LEGACY_DOCKER},
    "cloudbuild_present": ${HAS_CLOUDBUILD}
  },
  "schema_authority": {
    "postgresql_migration": "${PG_MIGRATION}",
    "mysql_prototype_sync": "${MYSQL_SYNC}",
    "canonical_operational_store": "postgresql engagement_reporting",
    "prototype_config_store": "mysql notification_engine"
  },
  "convergence_risks": {
    "hardcoded_db_password_fallback": ${RISK_HARDCODED_DB_PASSWORD},
    "kissflow_credentials_in_mysql_model": ${RISK_KISSFLOW_CREDS_IN_MYSQL_MODEL},
    "customer_discovery_payload_tracked": ${RISK_CUSTOMER_PAYLOAD_IN_GIT},
    "customer_discovery_file_count": ${DISCOVERY_FILES},
    "frontend_direct_kissflow_proxy": ${RISK_FE_KISSFLOW_DIRECT},
    "binary_artifact_tracked": ${RISK_BINARY_IN_GIT}
  },
  "duplicate_package_roots": "${DUPLICATE_PACKAGE_ROOTS}",
  "next_runbook": "02-secret-and-sensitive-data-preflight",
  "stop_conditions_triggered": []
}
EOF

# --- Write audit summary ---
cat > "${SUMMARY_JSON}" <<EOF
{
  "runbook_id": "${RUNBOOK_ID}",
  "runbook_name": "${RUNBOOK_NAME}",
  "completed_at": "${TIMESTAMP}",
  "repo_root": "${REPO_ROOT}",
  "outputs": {
    "assessment": "${DOCS_DIR}/repository-convergence-assessment.md",
    "ownership_map": "${DOCS_DIR}/component-ownership-map.md",
    "contract": "${CONTRACT_DIR}/repository-convergence.json",
    "audit_dir": "${AUDIT_DIR}"
  },
  "mutations_applied": []
}
EOF

echo "" | tee -a "${MUTATION_REPORT}"
echo "Outputs written:" | tee -a "${MUTATION_REPORT}"
echo "  - ${CONTRACT_DIR}/repository-convergence.json" | tee -a "${MUTATION_REPORT}"
echo "  - ${SUMMARY_JSON}" | tee -a "${MUTATION_REPORT}"
echo "  - ${MUTATION_REPORT}" | tee -a "${MUTATION_REPORT}"
echo "" | tee -a "${MUTATION_REPORT}"
echo "NOTE: Human-readable docs (repository-convergence-assessment.md," | tee -a "${MUTATION_REPORT}"
echo "component-ownership-map.md) are maintained alongside this runbook." | tee -a "${MUTATION_REPORT}"
echo "Runbook ${RUNBOOK_ID} completed successfully (read-only)." | tee -a "${MUTATION_REPORT}"
