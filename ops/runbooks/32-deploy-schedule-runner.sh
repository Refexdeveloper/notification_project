#!/usr/bin/env bash
# ops/runbooks/32-deploy-schedule-runner.sh
#
# Deploy refex-schedule-runner Cloud Run service (PostgreSQL schedule → render + send).
#
# Usage:
#   bash ops/runbooks/32-deploy-schedule-runner.sh plan
#   DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh build
#   DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh deploy
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
CLOUD_SQL_CONNECTION="${GCP_PROJECT}:${GCP_REGION}:aasik-refex-engagement-report-live-it-service-request-a00-pg"
ARTIFACT_REPO="asia-south1-docker.pkg.dev/${GCP_PROJECT}/refex-engagement-report"
SERVICE="${SERVICE:-refex-schedule-runner}"
IMAGE="${ARTIFACT_REPO}/schedule-runner:${COMMIT_SHA}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-645830234926-compute@developer.gserviceaccount.com}"
PG_SECRET="${PG_SECRET:-engagement-report-pg-root-password}"

log() { printf '[runbook-32-deploy] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_approval() {
  [[ "${DEPLOY_APPROVED:-}" == "true" ]] || die "Set DEPLOY_APPROVED=true"
}

plan() {
  log "Schedule runner deploy plan"
  log "Service:   ${SERVICE}"
  log "Image:     ${IMAGE}"
  log "Cloud SQL: ${CLOUD_SQL_CONNECTION}"
  log "Runbook:   19-dispatch-scheduled-report.sh (ingest → render → send)"
  log "Trigger:   GET /?schedule_id=<report_schedule_id>"
  log ""
  log "After deploy:"
  log "  SCHEDULE_RUNNER_URL=<service-url> bash ops/runbooks/32-provision-schedulers-from-postgresql.sh plan"
}

build_image() {
  require_approval
  command -v gcloud >/dev/null 2>&1 || die "gcloud CLI required for Cloud Build"
  log "Building schedule-runner image via Cloud Build (${COMMIT_SHA})"
  gcloud builds submit \
    --project="${GCP_PROJECT}" \
    --config=cloudbuild/schedule-runner-only.yaml \
    --substitutions="COMMIT_SHA=${COMMIT_SHA}"
}

image_exists() {
  gcloud artifacts docker images describe "${IMAGE}" \
    --project="${GCP_PROJECT}" >/dev/null 2>&1
}

deploy_service() {
  require_approval
  if ! image_exists; then
    log "Image not found: ${IMAGE}"
    log "Run build first: DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh build"
    log "Or build+deploy:  DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh build-deploy"
    die "Schedule-runner image missing in Artifact Registry"
  fi
  gcloud run deploy "${SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --image="${IMAGE}" \
    --platform=managed \
    --port=8080 \
    --no-allow-unauthenticated \
    --add-cloudsql-instances="${CLOUD_SQL_CONNECTION}" \
    --set-env-vars="NODE_ENV=production,GCP_PROJECT=${GCP_PROJECT},CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION},PGUSER=postgres,PGDATABASE=engagement_reporting,REPO_ROOT=/app,RUNBOOK_TO_RUN=19-dispatch-scheduled-report.sh,KISSFLOW_ACCOUNT_ID=AcCMptlq60zH,REPORT_TIMEZONE=Asia/Kolkata" \
    --set-secrets="PGPASSWORD=${PG_SECRET}:latest,KISSFLOW_KEY=engagement-report-kissflow-key-id:latest,KISSFLOW_SECRET=engagement-report-kissflow-secret:latest,SMTP_USER=engagement-report-smtp-user:latest,SMTP_APP_PASSWORD=engagement-report-smtp-app-password:latest" \
    --service-account="${SERVICE_ACCOUNT}" \
    --memory=1Gi \
    --cpu=1 \
    --timeout=1800 \
    --min-instances=0 \
    --max-instances=3

  log "Routing 100% live traffic to latest ${SERVICE} revision"
  gcloud run services update-traffic "${SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --to-latest \
    --quiet

  local url
  url="$(gcloud run services describe "${SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  log "Granting Cloud Scheduler SA invoker on ${SERVICE}"
  gcloud run services add-iam-policy-binding "${SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --member="serviceAccount:aasik-refex-report-scheduler@${GCP_PROJECT}.iam.gserviceaccount.com" \
    --role="roles/run.invoker" \
    --quiet
  log "Deployed ${SERVICE}: ${url}"
  log "Next: SCHEDULE_RUNNER_URL=${url} bash ops/runbooks/32-provision-schedulers-from-postgresql.sh plan"
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  build) build_image ;;
  deploy) deploy_service ;;
  build-deploy) build_image; deploy_service ;;
  *) die "Usage: $0 {plan|build|deploy|build-deploy}" ;;
esac
