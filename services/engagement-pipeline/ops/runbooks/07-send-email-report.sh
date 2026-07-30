#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT_OVERRIDE:-$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || true)}"
if [[ -z "${REPO_ROOT}" || ! -f "${REPO_ROOT}/ops/runbooks/load-smtp-creds.sh" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
fi
# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-smtp-creds.sh"

REPO_ROOT="${REPO_ROOT_OVERRIDE:-${REPO_ROOT}}"
REPORT_FILE="${REPORT_FILE_OVERRIDE:-${REPO_ROOT}/templates/generated/report-latest.html}"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-07"

RECIPIENT="${RECIPIENT:-mugesh.m@refex.co.in}"
SUBJECT="${SUBJECT:-Kissflow - User Signin Report}"
FROM_EMAIL="${FROM_EMAIL:-${SMTP_FROM:-${SMTP_USER}}}"

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
AUDIT_FILE="${AUDIT_DIR}/runbook-07-${TIMESTAMP}.json"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || stop "curl is not installed."
[[ -f "${REPORT_FILE}" ]] || stop "Rendered report not found: ${REPORT_FILE}. Run Runbook 06 first."

mkdir -p "${AUDIT_DIR}"

log "Reading SMTP credentials from environment"

SMTP_USER="${SMTP_USER:-}"
SMTP_APP_PASSWORD="${SMTP_APP_PASSWORD:-}"

[[ -n "${SMTP_USER}" ]] || stop "Failed to retrieve SMTP user from Secret Manager."
[[ -n "${FROM_EMAIL}" ]] || stop "Failed to resolve From email (set FROM_EMAIL or SMTP_USER)."
[[ -n "${SMTP_APP_PASSWORD}" ]] || stop "Failed to retrieve SMTP app password from Secret Manager."

log "Building MIME email"

MIME_FILE="$(mktemp)"
trap 'rm -f "${MIME_FILE}"; unset SMTP_USER SMTP_APP_PASSWORD' EXIT

CC_LIST="${CC:-}"
CC_RECIPIENTS=()
if [[ -n "${CC_LIST}" ]]; then
  IFS=',' read -r -a CC_RECIPIENTS <<< "${CC_LIST}"
fi
declare -a RCPT=("${RECIPIENT}")
if ((${#CC_RECIPIENTS[@]} > 0)); then
  for cc in "${CC_RECIPIENTS[@]}"; do
    cc="${cc#"${cc%%[![:space:]]*}"}"
    cc="${cc%"${cc##*[![:space:]]}"}"
    [[ -z "${cc}" ]] && continue
    RCPT+=("${cc}")
  done
fi

# Legacy ITSM path only when no schedule CC was supplied.
if [[ -z "${CC_LIST}" && -z "${SCHEDULE_ID:-}" ]]; then
  RCPT+=(
    "srivaths.varadharajan@refex.co.in"
    "gowtham.s@refex.co.in"
    "pravinkumar.raja@refex.co.in"
    "mohamedaasik.m@refex.co.in"
  )
fi

{
  echo "From: ${FROM_EMAIL}"
  echo "To: ${RECIPIENT}"
  if [[ -n "${CC_LIST}" ]]; then
    echo "Cc: ${CC_LIST}"
  elif [[ -z "${SCHEDULE_ID:-}" ]]; then
    echo "Cc: srivaths.varadharajan@refex.co.in, gowtham.s@refex.co.in, pravinkumar.raja@refex.co.in, mohamedaasik.m@refex.co.in"
  fi
  echo "Subject: ${SUBJECT}"
  echo "MIME-Version: 1.0"
  echo "Content-Type: text/html; charset=UTF-8"
  echo ""
  cat "${REPORT_FILE}"
} > "${MIME_FILE}"

log "Sending via Gmail SMTP"

CURL_RCPT=()
for addr in "${RCPT[@]}"; do
  CURL_RCPT+=(--mail-rcpt "${addr}")
done

if curl --silent --show-error \
  --url "smtps://smtp.gmail.com:465" \
  --ssl-reqd \
  --mail-from "${FROM_EMAIL}" \
  "${CURL_RCPT[@]}" \
  --user "${SMTP_USER}:${SMTP_APP_PASSWORD}" \
  --upload-file "${MIME_FILE}"; then
  STATUS="SENT"
  log "Email sent successfully to ${RECIPIENT}"
else
  STATUS="FAILED"
  log "Email send FAILED"
fi

jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg recipient "${RECIPIENT}" \
  --arg subject "${SUBJECT}" \
  --arg status "${STATUS}" \
  --arg report_file "${REPORT_FILE}" '
{
  action: "SEND_EMAIL_REPORT",
  generated_at: $generated_at,
  recipient: $recipient,
  subject: $subject,
  status: $status,
  report_file: $report_file,
  mutation_performed: false
}
' > "${AUDIT_FILE}"

[[ "${STATUS}" == "SENT" ]] || stop "Delivery failed. See audit record: ${AUDIT_FILE}"

printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
