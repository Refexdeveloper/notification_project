#!/usr/bin/env bash
# ops/runbooks/load-kissflow-creds.sh
#
# Export Kissflow credentials for pipeline runbooks.
# Priority: already-set env > apps/admin-ui/.env.local > GCP Secret Manager
#
# Usage:
#   source ops/runbooks/load-kissflow-creds.sh
#   # or: KISSFLOW_ENV=development source ops/runbooks/load-kissflow-creds.sh
#
set -euo pipefail

_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

REPO_ROOT="$(_repo_root)"
ENV_FILE="${KISSFLOW_ENV_FILE:-${REPO_ROOT}/apps/admin-ui/.env.local}"
KISSFLOW_ENV="${KISSFLOW_ENV:-production}"

_read_env_file_var() {
  local key="$1"
  local file="$2"
  [[ -f "${file}" ]] || return 0
  local line
  line="$(grep -E "^${key}=" "${file}" 2>/dev/null | head -1 || true)"
  [[ -n "${line}" ]] || return 0
  printf '%s' "${line#*=}" | sed 's/^["'\''"]//; s/["'\''"]$//'
}

if [[ "${KISSFLOW_ENV}" == "production" || "${KISSFLOW_ENV}" == "prod" ]]; then
  : "${KISSFLOW_ACCOUNT_ID:=$( _read_env_file_var VITE_KISSFLOW_PROD_ACCOUNT_ID "${ENV_FILE}" )}"
  : "${KISSFLOW_KEY:=$( _read_env_file_var VITE_KISSFLOW_PROD_ACCESS_KEY_ID "${ENV_FILE}" )}"
  : "${KISSFLOW_SECRET:=$( _read_env_file_var VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET "${ENV_FILE}" )}"
  export VITE_KISSFLOW_PROD_ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-AcCMptlq60zH}"
  export VITE_KISSFLOW_PROD_ACCESS_KEY_ID="${KISSFLOW_KEY:-}"
  export VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET="${KISSFLOW_SECRET:-}"
else
  : "${KISSFLOW_ACCOUNT_ID:=$( _read_env_file_var VITE_KISSFLOW_DEV_ACCOUNT_ID "${ENV_FILE}" )}"
  : "${KISSFLOW_KEY:=$( _read_env_file_var VITE_KISSFLOW_DEV_ACCESS_KEY_ID "${ENV_FILE}" )}"
  : "${KISSFLOW_SECRET:=$( _read_env_file_var VITE_KISSFLOW_DEV_ACCESS_KEY_SECRET "${ENV_FILE}" )}"
  export VITE_KISSFLOW_DEV_ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-AcCMptp3yqcn}"
  export VITE_KISSFLOW_DEV_ACCESS_KEY_ID="${KISSFLOW_KEY:-}"
  export VITE_KISSFLOW_DEV_ACCESS_KEY_SECRET="${KISSFLOW_SECRET:-}"
fi

if { [[ -z "${KISSFLOW_KEY:-}" ]] || [[ -z "${KISSFLOW_SECRET:-}" ]]; } && command -v gcloud >/dev/null 2>&1; then
  GCP_PROJECT="${GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-master-diorama-489103-u2}}"
  if [[ -z "${KISSFLOW_KEY:-}" ]]; then
    KISSFLOW_KEY="$(
      gcloud secrets versions access latest --secret=engagement-report-kissflow-key-id --project="${GCP_PROJECT}" 2>/dev/null \
        || gcloud secrets versions access latest --secret=kissflow-developer-key-id --project="${GCP_PROJECT}" 2>/dev/null \
        || true
    )"
  fi
  if [[ -z "${KISSFLOW_SECRET:-}" ]]; then
    KISSFLOW_SECRET="$(
      gcloud secrets versions access latest --secret=engagement-report-kissflow-key-secret --project="${GCP_PROJECT}" 2>/dev/null \
        || gcloud secrets versions access latest --secret=kissflow-developer-key-secret --project="${GCP_PROJECT}" 2>/dev/null \
        || true
    )"
  fi
fi

: "${KISSFLOW_ACCOUNT_ID:=AcCMptlq60zH}"

export KISSFLOW_ACCOUNT_ID KISSFLOW_KEY KISSFLOW_SECRET

if [[ -z "${KISSFLOW_KEY:-}" || -z "${KISSFLOW_SECRET:-}" ]]; then
  echo "Kissflow credentials not found. Set apps/admin-ui/.env.local:" >&2
  echo "  VITE_KISSFLOW_PROD_ACCESS_KEY_ID=..." >&2
  echo "  VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET=..." >&2
  echo "Or authenticate gcloud and store secrets in Secret Manager." >&2
  return 1 2>/dev/null || exit 1
fi
