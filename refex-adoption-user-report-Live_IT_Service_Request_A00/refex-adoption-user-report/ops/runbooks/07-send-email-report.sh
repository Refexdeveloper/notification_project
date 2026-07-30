#!/usr/bin/env bash
set -Eeuo pipefail
REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
REPORT_FILE="${REPORT_FILE_OVERRIDE:-${REPO_ROOT}/templates/generated/report-latest.html}"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-07"

RECIPIENT="${RECIPIENT:-mugesh.m@refex.co.in}"
SUBJECT="Kissflow - User Signin Report"

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
[[ -n "${SMTP_APP_PASSWORD}" ]] || stop "Failed to retrieve SMTP app password from Secret Manager."

log "Building MIME email"

MIME_FILE="$(mktemp)"
trap 'rm -f "${MIME_FILE}"; unset SMTP_USER SMTP_APP_PASSWORD' EXIT

{
  echo "From: ${SMTP_USER}"
  echo "To: ${RECIPIENT}"
  echo "Cc: srivaths.varadharajan@refex.co.in, gowtham.s@refex.co.in, pravinkumar.raja@refex.co.in, mohamedaasik.m@refex.co.in"
  echo "Subject: ${SUBJECT}"
  echo "MIME-Version: 1.0"
  echo "Content-Type: text/html; charset=UTF-8"
  echo ""
  cat "${REPORT_FILE}"
} > "${MIME_FILE}"

log "Sending via Gmail SMTP"

if curl --silent --show-error \
  --url "smtps://smtp.gmail.com:465" \
  --ssl-reqd \
  --mail-from "${SMTP_USER}" \
  --mail-rcpt "${RECIPIENT}" \
  --mail-rcpt "srivaths.varadharajan@refex.co.in" \
  --mail-rcpt "gowtham.s@refex.co.in" \
  --mail-rcpt "pravinkumar.raja@refex.co.in" \
  --mail-rcpt "mohamedaasik.m@refex.co.in" \
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
