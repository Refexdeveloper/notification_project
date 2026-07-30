#!/usr/bin/env bash
# ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh
#
# Shadow deploy of backend-api + admin-ui to Cloud Run (NO scheduler activation).
# Requires explicit approval — does not modify the legacy full-pipeline service.
#
# Usage:
#   bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh plan
#   DEPLOY_APPROVED=true bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh build
#   DEPLOY_APPROVED=true bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh deploy
#   DEPLOY_APPROVED=true bash ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh verify
#
# Environment overrides (optional):
#   GCP_PROJECT, GCP_REGION, COMMIT_SHA, CLOUD_SQL_INSTANCE
#   BACKEND_SERVICE, ADMIN_UI_SERVICE, ARTIFACT_REPO
#   BACKEND_API_URL — required for admin-ui build (public /api/v1 base)
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-aasik-refex-engagement-report-live-it-service-request-a00-pg}"
CLOUD_SQL_CONNECTION="${GCP_PROJECT}:${GCP_REGION}:${CLOUD_SQL_INSTANCE}"
ARTIFACT_REPO="${ARTIFACT_REPO:-asia-south1-docker.pkg.dev/${GCP_PROJECT}/refex-engagement-report}"
BACKEND_SERVICE="${BACKEND_SERVICE:-refex-backend-api}"
ADMIN_UI_SERVICE="${ADMIN_UI_SERVICE:-refex-admin-ui}"
BACKEND_IMAGE="${ARTIFACT_REPO}/backend-api:${COMMIT_SHA}"
ADMIN_IMAGE="${ARTIFACT_REPO}/admin-ui:${COMMIT_SHA}"
BACKEND_API_URL="${BACKEND_API_URL:-}"
PG_SECRET="${PG_SECRET:-engagement-report-pg-root-password}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-645830234926-compute@developer.gserviceaccount.com}"

log() { printf '[runbook-28] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_approval() {
  if [[ "${DEPLOY_APPROVED:-}" != "true" ]]; then
    die "Set DEPLOY_APPROVED=true to mutate GCP (build/deploy/verify deploy steps). Run 'plan' first."
  fi
}

require_gcloud() {
  command -v gcloud >/dev/null 2>&1 || die "gcloud CLI required"
  gcloud config get-value project >/dev/null 2>&1 || die "gcloud not authenticated"
}

plan() {
  log "Shadow deploy plan (no GCP changes)"
  log "Project:     ${GCP_PROJECT}"
  log "Region:      ${GCP_REGION}"
  log "Commit:      ${COMMIT_SHA}"
  log "Cloud SQL:   ${CLOUD_SQL_CONNECTION}"
  log "Backend Svc: ${BACKEND_SERVICE}"
  log "Admin UI:    ${ADMIN_UI_SERVICE}"
  log ""
  log "Images:"
  log "  ${BACKEND_IMAGE}"
  log "  ${ADMIN_IMAGE}"
  log ""
  log "Stack (single production path):"
  log "  admin-ui (Cloud Run + IAP) → backend-api (Cloud Run + IAP) → PostgreSQL (Cloud SQL)"
  log ""
  log "NOT touched by this runbook:"
  log "  - Legacy full-pipeline Cloud Run (aasik-refex-report-itsm-a00-svcreq-a00-full-pipeline)"
  log "  - Cloud Scheduler jobs"
  log "  - MySQL prototype (archived under archive/prototype-mysql-api/)"
  log ""
  log "Pre-deploy checklist:"
  log "  [ ] Migrations applied (db/migrations/*.sql)"
  log "  [ ] Secret Manager secrets exist (config/secrets.manifest.yaml)"
  log "  [ ] BACKEND_API_URL set to target backend Cloud Run URL for admin-ui build"
  log "  [ ] IAP configured on both services (production)"
  log "  [ ] DEPLOY_APPROVED=true for build/deploy"
}

build_images() {
  require_approval
  require_gcloud
  log "Building backend-api image"
  docker build \
    -t "${BACKEND_IMAGE}" \
    -f services/backend-api/Dockerfile \
    .

  if [[ -z "${BACKEND_API_URL}" ]]; then
    die "Set BACKEND_API_URL (e.g. https://refex-backend-api-xxx.run.app/api/v1) before building admin-ui"
  fi

  log "Building admin-ui image (VITE_USE_BACKEND_API=true)"
  docker build \
    -t "${ADMIN_IMAGE}" \
    --build-arg "VITE_API_BASE_URL=${BACKEND_API_URL}" \
    --build-arg "VITE_USE_BACKEND_API=true" \
    -f apps/admin-ui/Dockerfile \
    apps/admin-ui

  log "Pushing images to Artifact Registry"
  gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
  docker push "${BACKEND_IMAGE}"
  docker push "${ADMIN_IMAGE}"
  log "Build complete"
}

deploy_backend() {
  require_approval
  require_gcloud
  log "Deploying ${BACKEND_SERVICE} (shadow — no traffic shift on first revision if new service)"
  gcloud run deploy "${BACKEND_SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --image="${BACKEND_IMAGE}" \
    --platform=managed \
    --port=8080 \
    --allow-unauthenticated \
    --add-cloudsql-instances="${CLOUD_SQL_CONNECTION}" \
    --set-env-vars="NODE_ENV=production,GCP_PROJECT=${GCP_PROJECT},CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION},PGUSER=postgres,PGDATABASE=engagement_reporting,CORS_ORIGIN=*,ALLOW_DEV_AUTH_STUB=true,DEV_AUTH_EMAIL=dev@refex.co.in,DEV_AUTH_NAME=Dev Operator,DEV_AUTH_ROLE=ADMIN" \
    --set-secrets="PGPASSWORD=${PG_SECRET}:latest" \
    --service-account="${SERVICE_ACCOUNT}" \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=3 \
    --tag="sha-${COMMIT_SHA}" \
    --no-traffic

  local url
  url="$(gcloud run services describe "${BACKEND_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  log "Backend deployed (no traffic on new revision). URL: ${url}"
  log "Health: ${url}/api/v1/health"
}

deploy_admin_ui() {
  require_approval
  require_gcloud
  log "Deploying ${ADMIN_UI_SERVICE}"
  gcloud run deploy "${ADMIN_UI_SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --image="${ADMIN_IMAGE}" \
    --platform=managed \
    --port=8080 \
    --allow-unauthenticated \
    --service-account="${SERVICE_ACCOUNT}" \
    --memory=256Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=3 \
    --tag="sha-${COMMIT_SHA}" \
    --no-traffic

  local url
  url="$(gcloud run services describe "${ADMIN_UI_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  log "Admin UI deployed (no traffic on new revision). URL: ${url}"
}

verify() {
  require_approval
  require_gcloud
  local backend_url admin_url
  backend_url="$(gcloud run services describe "${BACKEND_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  admin_url="$(gcloud run services describe "${ADMIN_UI_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"

  log "Verifying backend health"
  curl -fsS "${backend_url}/api/v1/health" | head -c 400
  echo ""

  log "Verifying backend ready (PostgreSQL)"
  curl -fsS "${backend_url}/api/v1/ready" | head -c 400 || log "WARN: /ready failed — check Cloud SQL binding and PGPASSWORD secret"
  echo ""

  log "Verifying admin-ui serves index"
  curl -fsS "${admin_url}/" | head -c 200
  echo ""

  log "Shadow verify complete. Move traffic only after manual UI check:"
  log "  gcloud run services update-traffic ${BACKEND_SERVICE} --to-tags=sha-${COMMIT_SHA}=100 --region=${GCP_REGION} --project=${GCP_PROJECT}"
  log "  gcloud run services update-traffic ${ADMIN_UI_SERVICE} --to-tags=sha-${COMMIT_SHA}=100 --region=${GCP_REGION} --project=${GCP_PROJECT}"
}

cloud_build() {
  require_approval
  require_gcloud
  if [[ -z "${BACKEND_API_URL}" ]]; then
    die "Set BACKEND_API_URL for Cloud Build admin-ui arg _API_BASE_URL"
  fi
  log "Submitting Cloud Build (services.yaml)"
  gcloud builds submit \
    --project="${GCP_PROJECT}" \
    --config=cloudbuild/services.yaml \
    --substitutions="COMMIT_SHA=${COMMIT_SHA},_API_BASE_URL=${BACKEND_API_URL},_VITE_USE_BACKEND_API=true"
}

usage() {
  cat <<EOF
Usage: $0 {plan|build|deploy|deploy-backend|deploy-admin|verify|cloud-build}

  plan           — show deploy plan (safe, read-only)
  build          — docker build + push (requires DEPLOY_APPROVED=true)
  deploy         — deploy backend-api then admin-ui with --no-traffic
  deploy-backend — backend-api only
  deploy-admin   — admin-ui only
  verify         — curl health/ready + admin index
  cloud-build    — gcloud builds submit using cloudbuild/services.yaml

Legacy pipeline and schedulers are NOT modified.
EOF
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  build) build_images ;;
  deploy) build_images; deploy_backend; deploy_admin_ui; verify ;;
  deploy-backend) deploy_backend ;;
  deploy-admin) deploy_admin_ui ;;
  verify) verify ;;
  cloud-build) cloud_build ;;
  *) usage; exit 1 ;;
esac
