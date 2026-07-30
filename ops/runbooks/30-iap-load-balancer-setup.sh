#!/usr/bin/env bash
# ops/runbooks/30-iap-load-balancer-setup.sh
#
# Production auth: External HTTPS LB + Serverless NEG + IAP (single origin for UI + API).
# After IAP works, remove ALLOW_DEV_AUTH_STUB from refex-backend-api.
#
# Usage:
#   bash ops/runbooks/30-iap-load-balancer-setup.sh plan
#   DEPLOY_APPROVED=true LB_DOMAIN=engagement.example.com bash ops/runbooks/30-iap-load-balancer-setup.sh deploy
#
# Prerequisites (manual in GCP Console if gcloud blocked):
#   - OAuth consent screen configured for project
#   - IAP API enabled: gcloud services enable iap.googleapis.com compute.googleapis.com
#   - DNS A record -> LB IP (after deploy)
#
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
LB_NAME="${LB_NAME:-refex-engagement-lb}"
NEG_ADMIN="${NEG_ADMIN:-refex-admin-ui-neg}"
NEG_API="${NEG_API:-refex-backend-api-neg}"
BACKEND_ADMIN="${BACKEND_ADMIN:-refex-admin-ui-backend}"
BACKEND_API="${BACKEND_API:-refex-backend-api-backend}"
URL_MAP="${URL_MAP:-refex-engagement-url-map}"
CERT_NAME="${CERT_NAME:-refex-engagement-cert}"
ADMIN_SERVICE="${ADMIN_SERVICE:-refex-admin-ui}"
API_SERVICE="${API_SERVICE:-refex-backend-api}"
LB_DOMAIN="${LB_DOMAIN:-}"
SUPPORT_EMAIL="${SUPPORT_EMAIL:-support@refexone.com}"

log() { printf '[runbook-30] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_approval() {
  [[ "${DEPLOY_APPROVED:-}" == "true" ]] || die "Set DEPLOY_APPROVED=true to create LB/IAP resources"
}

plan() {
  log "IAP + Load Balancer plan"
  log "Project: ${GCP_PROJECT}  Region: ${GCP_REGION}"
  log ""
  log "Target architecture (single origin — IAP headers reach both services):"
  log "  https://\${LB_DOMAIN}/           → ${ADMIN_SERVICE} (Cloud Run)"
  log "  https://\${LB_DOMAIN}/api/v1/*  → ${API_SERVICE} (Cloud Run)"
  log ""
  log "Steps when DEPLOY_APPROVED=true and LB_DOMAIN set:"
  log "  1. Enable iap.googleapis.com + compute.googleapis.com"
  log "  2. Create serverless NEGs for admin-ui + backend-api"
  log "  3. Create backend services; enable IAP on both"
  log "  4. URL map path rules: /api/v1/* → API backend, default → admin-ui"
  log "  5. Managed SSL cert for LB_DOMAIN"
  log "  6. Global external HTTPS forwarding rule"
  log "  7. Rebuild admin-ui with VITE_API_BASE_URL=https://\${LB_DOMAIN}/api/v1"
  log "  8. Grant roles/iap.httpsResourceAccessor to @refex.co.in users"
  log "  9. Remove ALLOW_DEV_AUTH_STUB from ${API_SERVICE}"
  log ""
  log "Current shadow auth (until IAP live):"
  log "  ALLOW_DEV_AUTH_STUB=true on ${API_SERVICE}"
  log ""
  if [[ -z "${LB_DOMAIN}" ]]; then
    log "Set LB_DOMAIN (e.g. engagement.refex.co.in) before deploy"
  fi
  log ""
  log "Console fallback (if API permissions insufficient):"
  log "  https://console.cloud.google.com/security/iap?project=${GCP_PROJECT}"
  log "  https://console.cloud.google.com/net-services/loadbalancing/list/loadBalancers?project=${GCP_PROJECT}"
}

create_neg() {
  local neg_name="$1" run_service="$2"
  if gcloud compute network-endpoint-groups describe "${neg_name}" --region="${GCP_REGION}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
    log "NEG exists: ${neg_name}"
    return 0
  fi
  gcloud compute network-endpoint-groups create "${neg_name}" \
    --project="${GCP_PROJECT}" \
    --region="${GCP_REGION}" \
    --network-endpoint-type=serverless \
    --cloud-run-service="${run_service}"
  log "Created NEG: ${neg_name}"
}

deploy() {
  require_approval
  [[ -n "${LB_DOMAIN}" ]] || die "Set LB_DOMAIN for managed certificate and public URL"

  gcloud services enable iap.googleapis.com compute.googleapis.com --project="${GCP_PROJECT}"

  create_neg "${NEG_ADMIN}" "${ADMIN_SERVICE}"
  create_neg "${NEG_API}" "${API_SERVICE}"

  if ! gcloud compute backend-services describe "${BACKEND_ADMIN}" --global --project="${GCP_PROJECT}" >/dev/null 2>&1; then
    gcloud compute backend-services create "${BACKEND_ADMIN}" \
      --project="${GCP_PROJECT}" \
      --global \
      --load-balancing-scheme=EXTERNAL_MANAGED \
      --protocol=HTTPS
    gcloud compute backend-services add-backend "${BACKEND_ADMIN}" \
      --project="${GCP_PROJECT}" \
      --global \
      --network-endpoint-group="${NEG_ADMIN}" \
      --network-endpoint-group-region="${GCP_REGION}"
    log "Created backend: ${BACKEND_ADMIN}"
  fi

  if ! gcloud compute backend-services describe "${BACKEND_API}" --global --project="${GCP_PROJECT}" >/dev/null 2>&1; then
    gcloud compute backend-services create "${BACKEND_API}" \
      --project="${GCP_PROJECT}" \
      --global \
      --load-balancing-scheme=EXTERNAL_MANAGED \
      --protocol=HTTPS
    gcloud compute backend-services add-backend "${BACKEND_API}" \
      --project="${GCP_PROJECT}" \
      --global \
      --network-endpoint-group="${NEG_API}" \
      --network-endpoint-group-region="${GCP_REGION}"
    log "Created backend: ${BACKEND_API}"
  fi

  log "Enable IAP on backend services (requires OAuth brand — may need Console):"
  log "  gcloud iap web enable --resource-type=backend-services --service=${BACKEND_ADMIN} --project=${GCP_PROJECT}"
  log "  gcloud iap web enable --resource-type=backend-services --service=${BACKEND_API} --project=${GCP_PROJECT}"

  log ""
  log "After IAP + DNS live:"
  log "  gcloud run services update ${API_SERVICE} --region=${GCP_REGION} --remove-env-vars=ALLOW_DEV_AUTH_STUB"
  log "  Rebuild admin-ui: VITE_API_BASE_URL=https://${LB_DOMAIN}/api/v1"
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  deploy) deploy ;;
  *) die "Usage: $0 {plan|deploy}" ;;
esac
