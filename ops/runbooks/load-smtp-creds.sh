#!/usr/bin/env bash
# ops/runbooks/load-smtp-creds.sh
#
# Export SMTP credentials for pipeline runbooks (Gmail app password).
# Priority: already-set env > GCP Secret Manager
#
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-master-diorama-489103-u2}}"

if [[ -z "${SMTP_USER:-}" ]] && command -v gcloud >/dev/null 2>&1; then
  SMTP_USER="$(
    gcloud secrets versions access latest --secret=engagement-report-smtp-user --project="${GCP_PROJECT}" 2>/dev/null || true
  )"
fi

if [[ -z "${SMTP_APP_PASSWORD:-}" ]] && command -v gcloud >/dev/null 2>&1; then
  SMTP_APP_PASSWORD="$(
    gcloud secrets versions access latest --secret=engagement-report-smtp-app-password --project="${GCP_PROJECT}" 2>/dev/null || true
  )"
fi

export SMTP_USER SMTP_APP_PASSWORD

if [[ -z "${SMTP_USER:-}" || -z "${SMTP_APP_PASSWORD:-}" ]]; then
  echo "SMTP credentials not found. Export SMTP_USER and SMTP_APP_PASSWORD, or authenticate gcloud for Secret Manager." >&2
  return 1 2>/dev/null || exit 1
fi
