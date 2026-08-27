#!/usr/bin/env bash
# ops/runbooks/40-deploy-p2p-backend-kpi-fix.sh
#
# Backend-only deploy for P2P KPI fix. Preserves existing Cloud Run env/secrets
# (including P2P_DB_*). Safe to run from Cloud Shell after repo is up to date.
#
# Usage (Cloud Shell):
#   cd ~/notification_project   # or clone/pull first
#   git pull origin main
#   DEPLOY_APPROVED=true bash ops/runbooks/40-deploy-p2p-backend-kpi-fix.sh
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
COMMIT_SHA="${COMMIT_SHA:-p2p-kpi-$(date -u +%Y%m%dT%H%M%SZ)}"
BACKEND_SERVICE="${BACKEND_SERVICE:-refex-backend-api}"
IMAGE="asia-south1-docker.pkg.dev/${GCP_PROJECT}/refex-engagement-report/backend-api:${COMMIT_SHA}"

log() { printf '[runbook-40] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

[[ "${DEPLOY_APPROVED:-}" == "true" ]] || die "Set DEPLOY_APPROVED=true"

command -v gcloud >/dev/null 2>&1 || die "gcloud required (use Cloud Shell)"

[[ -f services/backend-api/src/lib/p2pDashboard.js ]] || die "p2pDashboard.js missing — git pull origin main first"

log "Building ${IMAGE}"
gcloud builds submit \
  --project="${GCP_PROJECT}" \
  --config=cloudbuild/backend-api-only.yaml \
  --substitutions="COMMIT_SHA=${COMMIT_SHA}"

log "Deploying image only (keeps P2P_DB_* env + secrets)"
gcloud run deploy "${BACKEND_SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${GCP_REGION}" \
  --image="${IMAGE}"

log "Routing live traffic to latest revision"
gcloud run services update-traffic "${BACKEND_SERVICE}" \
  --project="${GCP_PROJECT}" \
  --region="${GCP_REGION}" \
  --to-latest

URL="$(gcloud run services describe "${BACKEND_SERVICE}" \
  --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
log "Verify P2P KPIs:"
log "  curl -sS \"${URL}/api/v1/dashboard/application/Procurement_to_Pay_A00?environment=production\" | python3 -m json.tool | grep -E '\"total\"|\"open\"|\"closed\"|\"rejected\"|process_label'"
