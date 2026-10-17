#!/usr/bin/env bash
# Deploy refex-comment-mail Cloud Run (To/CC/HTML via existing supportone SMTP).
#
# Usage:
#   bash ops/runbooks/33-deploy-comment-mail-api.sh plan
#   DEPLOY_APPROVED=true bash ops/runbooks/33-deploy-comment-mail-api.sh build-deploy
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
ARTIFACT_REPO="asia-south1-docker.pkg.dev/${GCP_PROJECT}/refex-engagement-report"
SERVICE="${SERVICE:-refex-comment-mail}"
IMAGE="${ARTIFACT_REPO}/comment-mail-api:${COMMIT_SHA}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-645830234926-compute@developer.gserviceaccount.com}"
API_KEY_SECRET="${API_KEY_SECRET:-comment-mail-api-key}"

log() { printf '[runbook-33] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_approval() {
  [[ "${DEPLOY_APPROVED:-}" == "true" ]] || die "Set DEPLOY_APPROVED=true"
}

ensure_api_key_secret() {
  if gcloud secrets describe "${API_KEY_SECRET}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
    log "Secret ${API_KEY_SECRET} already exists"
    return
  fi
  local key="${COMMENT_MAIL_API_KEY:-cmk_7f3a9c2e1b84d6f0a5e8c193b2470d6e}"
  printf '%s' "${key}" | gcloud secrets create "${API_KEY_SECRET}" \
    --project="${GCP_PROJECT}" \
    --replication-policy=automatic \
    --data-file=-
  log "Created secret ${API_KEY_SECRET}"
}

plan() {
  log "Comment mail API deploy plan"
  log "Service: ${SERVICE}"
  log "Image:   ${IMAGE}"
  log "SMTP:    engagement-report-smtp-user + engagement-report-smtp-app-password"
  log "Auth:    X-API-Key from ${API_KEY_SECRET}"
  log "Route:   POST /v1/send  { to, cc, subject, html }"
}

build_image() {
  require_approval
  command -v gcloud >/dev/null 2>&1 || die "gcloud CLI required"
  log "Building comment-mail-api (${COMMIT_SHA})"
  gcloud builds submit \
    --project="${GCP_PROJECT}" \
    --config=cloudbuild/comment-mail-api.yaml \
    --substitutions="COMMIT_SHA=${COMMIT_SHA}"
}

deploy_service() {
  require_approval
  ensure_api_key_secret
  gcloud run deploy "${SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --image="${IMAGE}" \
    --platform=managed \
    --port=8080 \
    --allow-unauthenticated \
    --set-env-vars="NODE_ENV=production,SMTP_HOST=smtp.gmail.com,SMTP_PORT=465,COMMENT_MAIL_FROM_NAME=Extrovis IT Support" \
    --set-secrets="SMTP_USER=engagement-report-smtp-user:latest,SMTP_APP_PASSWORD=engagement-report-smtp-app-password:latest,COMMENT_MAIL_API_KEY=${API_KEY_SECRET}:latest" \
    --service-account="${SERVICE_ACCOUNT}" \
    --memory=256Mi \
    --cpu=1 \
    --timeout=60 \
    --min-instances=0 \
    --max-instances=3

  gcloud run services update-traffic "${SERVICE}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --to-latest \
    --quiet

  local url
  url="$(gcloud run services describe "${SERVICE}" --project="${GCP_PROJECT}" --region="${GCP_REGION}" --format='value(status.url)')"
  log "Deployed ${SERVICE}: ${url}"
  log "POST ${url}/v1/send"
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  build) build_image ;;
  deploy) deploy_service ;;
  build-deploy) build_image; deploy_service ;;
  *) die "Usage: $0 {plan|build|deploy|build-deploy}" ;;
esac
