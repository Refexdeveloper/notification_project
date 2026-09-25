#!/usr/bin/env bash
# ops/runbooks/28-deploy-backend-api-and-admin-ui-shadow.sh
#
# Shadow deploy of backend-api + admin-ui to Cloud Run (NO scheduler activation).
# Requires explicit approval — does not modify the legacy full-pipeline service.
#
# IMPORTANT — service name isolation:
#   Cloud Run service "refex-backend-api" is OWNED by this engagement project.
#   Images MUST come from Artifact Registry path:
#     …/refex-engagement-report/backend-api:…
#   Never attach Cloud Run "continuous deployment from source" from other GitHub
#   repos (e.g. Refexdeveloper/P2P) to this service name — that overwrites the
#   API with an SPA and Admin UI breaks with HTML/JSON parse errors.
#   P2P must deploy only to service "p2p-backend".
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
#   BACKEND_UPSTREAM_URL — Cloud Run URL for backend-api (nginx proxy target in admin-ui image)
#   BACKEND_HOST — Host header for backend-api (default: refex-backend-api-645830234926.asia-south1.run.app)
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
BACKEND_API_URL="${BACKEND_API_URL:-/api/v1}"
BACKEND_UPSTREAM_URL="${BACKEND_UPSTREAM_URL:-https://refex-backend-api-dhwffeu7pq-el.a.run.app}"
BACKEND_HOST="${BACKEND_HOST:-refex-backend-api-dhwffeu7pq-el.a.run.app}"
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

# Refuse wrong-repo / P2P source-deploy images on the engagement backend service.
assert_backend_live_image_safe() {
  local live_rev live_image
  # Prefer explicit percent>0; fall back to latestReady when traffic is 100% LATEST.
  live_rev="$(gcloud run services describe "${BACKEND_SERVICE}" \
    --project="${GCP_PROJECT}" --region="${GCP_REGION}" \
    --format='value(status.traffic[?percent>0].revisionName)' | awk 'NF{print; exit}')"
  if [[ -z "${live_rev}" ]]; then
    live_rev="$(gcloud run services describe "${BACKEND_SERVICE}" \
      --project="${GCP_PROJECT}" --region="${GCP_REGION}" \
      --format='value(status.latestReadyRevisionName)')"
  fi
  [[ -n "${live_rev}" ]] || die "No live-traffic revision found on ${BACKEND_SERVICE}"
  live_image="$(gcloud run revisions describe "${live_rev}" \
    --project="${GCP_PROJECT}" --region="${GCP_REGION}" \
    --format='value(spec.containers[0].image)')"
  log "Live ${BACKEND_SERVICE} revision=${live_rev}"
  log "Live image=${live_image}"
  if [[ "${live_image}" == *"/cloud-run-source-deploy/"* ]] || [[ "${live_image}" == *"/p2p/"* ]]; then
    die "REFUSING: live image is not engagement backend (looks like P2P/source-deploy). Restore traffic to a refex-engagement-report/backend-api revision."
  fi
  if [[ "${live_image}" != *"/refex-engagement-report/backend-api"* ]]; then
    die "REFUSING: live image must be under refex-engagement-report/backend-api (got: ${live_image})"
  fi
  # JSON health must not be HTML
  local url body
  url="$(gcloud run services describe "${BACKEND_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  body="$(curl -fsS "${url}/api/v1/health" | head -c 200 || true)"
  if [[ "${body}" == *"<!DOCTYPE"* ]] || [[ "${body}" != *'"success"'* ]]; then
    die "REFUSING: /api/v1/health did not return JSON success envelope (got: ${body})"
  fi
  log "Backend live image + health OK"
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
  log "  [ ] No Cloud Build CD from other repos targeting ${BACKEND_SERVICE} (P2P → p2p-backend only)"
}

build_images() {
  require_approval
  require_gcloud
  if command -v docker >/dev/null 2>&1; then
    log "Building backend-api image (local docker)"
    docker build \
      -t "${BACKEND_IMAGE}" \
      -f services/backend-api/Dockerfile \
      .

    if [[ "${BACKEND_API_URL}" != "/api/v1" && -z "${BACKEND_API_URL##http*}" ]]; then
      log "NOTE: Using same-origin /api/v1 in Admin UI build (nginx proxies to backend). BACKEND_API_URL=${BACKEND_API_URL} is ignored for Vite."
    fi

    log "Building admin-ui image (VITE_USE_BACKEND_API=true, same-origin /api/v1 proxy)"
    docker build \
      -t "${ADMIN_IMAGE}" \
      --build-arg "VITE_API_BASE_URL=/api/v1" \
      --build-arg "VITE_USE_BACKEND_API=true" \
      --build-arg "BACKEND_UPSTREAM=${BACKEND_UPSTREAM_URL}" \
      --build-arg "BACKEND_HOST=${BACKEND_HOST}" \
      -f apps/admin-ui/Dockerfile \
      apps/admin-ui

    log "Pushing images to Artifact Registry"
    gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
    docker push "${BACKEND_IMAGE}"
    docker push "${ADMIN_IMAGE}"
    log "Build complete"
    return
  fi

  log "docker not found — using Cloud Build (cloudbuild/services.yaml)"
  cloud_build
}

SCHEDULE_RUNNER_URL="${SCHEDULE_RUNNER_URL:-https://refex-schedule-runner-645830234926.asia-south1.run.app}"

deploy_backend() {
  require_approval
  require_gcloud
  case "${BACKEND_IMAGE}" in
    */refex-engagement-report/backend-api:*) ;;
    *) die "BACKEND_IMAGE must be under refex-engagement-report/backend-api (got: ${BACKEND_IMAGE})" ;;
  esac
  local -a deploy_extra=()
  if [[ "${DEPLOY_LIVE_TRAFFIC:-}" != "true" ]]; then
    deploy_extra+=(--no-traffic --tag="sha-${COMMIT_SHA}")
  fi
  # IMAGE-ONLY by default: never --set-env-vars / --set-secrets here — those REPLACE
  # the whole env map and wipe P2P_DB_* (MySQL RO) that were added out-of-band.
  # Opt-in full env reset only with BACKEND_RESET_ENV=true (dangerous).
  log "Deploying ${BACKEND_SERVICE}$([[ "${DEPLOY_LIVE_TRAFFIC:-}" == "true" ]] && echo ' (live traffic)' || echo ' (shadow — tagged, no live traffic)')"
  local -a env_args=()
  if [[ "${BACKEND_RESET_ENV:-}" == "true" ]]; then
    log "WARNING: BACKEND_RESET_ENV=true — replacing env/secrets (will drop P2P_DB_* unless re-added)"
    env_args+=(
      --set-env-vars="NODE_ENV=production,GCP_PROJECT=${GCP_PROJECT},CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION},PGUSER=postgres,PGDATABASE=engagement_reporting,CORS_ORIGIN=*,ALLOW_DEV_AUTH_STUB=true,DEV_AUTH_EMAIL=mohamedaasik.m@refex.co.in,DEV_AUTH_NAME=Mohamed Asaik,DEV_AUTH_ROLE=ADMIN,PLATFORM_BOOTSTRAP_EMAIL=mohamedaasik.m@refex.co.in,PLATFORM_BOOTSTRAP_NAME=Mohamed Asaik,INCREMENTAL_SYNC_TOKEN=refex-incremental-sync-${GCP_PROJECT},ENGAGEMENT_CACHE_TTL_MS=3600000,KISSFLOW_ACCOUNT_ID=AcCMptlq60zH,KISSFLOW_SUBDOMAIN=refexgroup,REPORT_TIMEZONE=Asia/Kolkata,SCHEDULE_RUNNER_URL=${SCHEDULE_RUNNER_URL},VERTEX_LOCATION=us-central1,GEMINI_MODEL=gemini-2.0-flash-001,P2P_DB_USER=p2p_reporting_ro,P2P_INSTANCE_CONNECTION_NAME=${GCP_PROJECT}:${GCP_REGION}:p2p-mysql,P2P_DB_NAME=p2p_system"
      --set-secrets="PGPASSWORD=${PG_SECRET}:latest,KISSFLOW_KEY=engagement-report-kissflow-key-id:latest,KISSFLOW_SECRET=engagement-report-kissflow-secret:latest,PLATFORM_SESSION_SECRET=engagement-report-platform-session-secret:latest,P2P_DB_PASSWORD=p2p-reporting-ro-password:latest"
      --add-cloudsql-instances="${CLOUD_SQL_CONNECTION},${GCP_PROJECT}:${GCP_REGION}:p2p-mysql"
    )
  else
    log "Image-only deploy (preserves existing Cloud Run env/secrets including P2P_DB_*)"
    env_args+=(--add-cloudsql-instances="${CLOUD_SQL_CONNECTION},${GCP_PROJECT}:${GCP_REGION}:p2p-mysql")
  fi
  gcloud run deploy "${BACKEND_SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --image="${BACKEND_IMAGE}" \
    --platform=managed \
    --port=8080 \
    --allow-unauthenticated \
    --service-account="${SERVICE_ACCOUNT}" \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=3 \
    ${env_args[@]+"${env_args[@]}"} \
    ${deploy_extra[@]+"${deploy_extra[@]}"}

  if [[ "${DEPLOY_LIVE_TRAFFIC:-}" == "true" ]]; then
    log "Routing 100% live traffic to latest ${BACKEND_SERVICE} revision"
    gcloud run services update-traffic "${BACKEND_SERVICE}" \
      --project="${GCP_PROJECT}" \
      --region="${GCP_REGION}" \
      --to-latest
    # Safety: refuse to keep traffic on a non-engagement (P2P/source-deploy) image.
    assert_backend_live_image_safe
  fi

  local url
  url="$(gcloud run services describe "${BACKEND_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  log "Backend deployed. URL: ${url}"
  log "Health: ${url}/api/v1/health"
}

deploy_admin_ui() {
  require_approval
  require_gcloud
  local -a deploy_extra=()
  if [[ "${DEPLOY_LIVE_TRAFFIC:-}" != "true" ]]; then
    deploy_extra+=(--no-traffic --tag="sha-${COMMIT_SHA}")
  fi
  log "Deploying ${ADMIN_UI_SERVICE}$([[ "${DEPLOY_LIVE_TRAFFIC:-}" == "true" ]] && echo ' (live traffic)' || echo ' (shadow — tagged, no live traffic)')"
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
    ${deploy_extra[@]+"${deploy_extra[@]}"}

  if [[ "${DEPLOY_LIVE_TRAFFIC:-}" == "true" ]]; then
    log "Routing 100% live traffic to latest ${ADMIN_UI_SERVICE} revision"
    gcloud run services update-traffic "${ADMIN_UI_SERVICE}" \
      --project="${GCP_PROJECT}" \
      --region="${GCP_REGION}" \
      --to-latest
  fi

  local url
  url="$(gcloud run services describe "${ADMIN_UI_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  log "Admin UI deployed. URL: ${url}"
}

verify() {
  require_approval
  require_gcloud
  local backend_url admin_url
  backend_url="$(gcloud run services describe "${BACKEND_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  admin_url="$(gcloud run services describe "${ADMIN_UI_SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"

  log "Verifying live backend image is engagement (not P2P/source-deploy)"
  assert_backend_live_image_safe

  log "Verifying backend health"
  curl -fsS "${backend_url}/api/v1/health" | head -c 400
  echo ""

  log "Verifying backend ready (PostgreSQL)"
  curl -fsS "${backend_url}/api/v1/ready" | head -c 400 || log "WARN: /ready failed — check Cloud SQL binding and PGPASSWORD secret"
  echo ""

  log "Verifying admin-ui serves index"
  curl -fsS "${admin_url}/" | head -c 200
  echo ""

  log "Verifying admin-ui same-origin API proxy (/api/v1/health)"
  curl -fsS "${admin_url}/api/v1/health" | head -c 400 || log "WARN: admin-ui /api/v1 proxy failed — check nginx BACKEND_UPSTREAM in image"
  echo ""

  log "Shadow verify complete. Move traffic only after manual UI check:"
  log "  gcloud run services update-traffic ${BACKEND_SERVICE} --to-tags=sha-${COMMIT_SHA}=100 --region=${GCP_REGION} --project=${GCP_PROJECT}"
  log "  gcloud run services update-traffic ${ADMIN_UI_SERVICE} --to-tags=sha-${COMMIT_SHA}=100 --region=${GCP_REGION} --project=${GCP_PROJECT}"
}

cloud_build() {
  require_approval
  require_gcloud
  if [[ -z "${BACKEND_UPSTREAM_URL}" ]]; then
    die "Set BACKEND_UPSTREAM_URL (e.g. https://refex-backend-api-xxx.run.app) for admin-ui nginx proxy"
  fi
  log "Submitting Cloud Build (services.yaml)"
  gcloud builds submit \
    --project="${GCP_PROJECT}" \
    --config=cloudbuild/services.yaml \
    --substitutions="COMMIT_SHA=${COMMIT_SHA},_API_BASE_URL=/api/v1,_VITE_USE_BACKEND_API=true,_BACKEND_UPSTREAM=${BACKEND_UPSTREAM_URL},_BACKEND_HOST=${BACKEND_HOST}"
}

usage() {
  cat <<EOF
Usage: $0 {plan|build|deploy|deploy-backend|deploy-admin|verify|cloud-build}

  plan           — show deploy plan (safe, read-only)
  build          — docker build + push, or Cloud Build when docker is unavailable
  build-deploy   — cloud-build (or docker build) then deploy both services with live traffic
  deploy         — deploy backend-api then admin-ui with --no-traffic (builds first if needed)
  deploy-backend — backend-api only
  deploy-admin   — admin-ui only
  verify         — curl health/ready + admin index
  shift-traffic — route 100% to tag sha-\${COMMIT_SHA} (after shadow deploy)

Legacy pipeline and schedulers are NOT modified.
EOF
}

shift_live_traffic() {
  require_gcloud
  log "Moving live traffic to latest revisions (clears tag-only routing)"
  gcloud run services update-traffic "${BACKEND_SERVICE}" \
    --project="${GCP_PROJECT}" --region="${GCP_REGION}" \
    --to-latest --quiet
  gcloud run services update-traffic "${ADMIN_UI_SERVICE}" \
    --project="${GCP_PROJECT}" --region="${GCP_REGION}" \
    --to-latest --quiet
}

build_deploy_live() {
  build_images
  DEPLOY_LIVE_TRAFFIC=true deploy_backend
  DEPLOY_LIVE_TRAFFIC=true deploy_admin_ui
  shift_live_traffic
  verify
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  build) build_images ;;
  build-deploy) build_deploy_live ;;
  deploy) build_images; deploy_backend; deploy_admin_ui; verify ;;
  deploy-backend) deploy_backend ;;
  deploy-admin) deploy_admin_ui ;;
  verify) verify ;;
  shift-traffic) shift_live_traffic ;;
  cloud-build) cloud_build ;;
  *) usage; exit 1 ;;
esac
