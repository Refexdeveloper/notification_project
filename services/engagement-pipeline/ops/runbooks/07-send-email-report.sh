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
TO_LIST="${TO_LIST:-${RECIPIENT}}"

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
HTML_BODY="$(mktemp)"
LOGO_FETCH_TMP=""
trap 'rm -f "${MIME_FILE}" "${HTML_BODY}" ${LOGO_FETCH_TMP:+"${LOGO_FETCH_TMP}"}; unset SMTP_USER SMTP_APP_PASSWORD' EXIT

CC_LIST="${CC:-}"
CC_RECIPIENTS=()
if [[ -n "${CC_LIST}" ]]; then
  IFS=',' read -r -a CC_RECIPIENTS <<< "${CC_LIST}"
fi

TO_RECIPIENTS=()
IFS=',' read -r -a TO_RECIPIENTS <<< "${TO_LIST}"
declare -a RCPT=()
declare -a TO_HEADER=()
for to in "${TO_RECIPIENTS[@]}"; do
  to="${to#"${to%%[![:space:]]*}"}"
  to="${to%"${to##*[![:space:]]}"}"
  [[ -z "${to}" ]] && continue
  RCPT+=("${to}")
  TO_HEADER+=("${to}")
done
((${#RCPT[@]} > 0)) || stop "No To recipients resolved (set RECIPIENT or TO_LIST)."

if ((${#CC_RECIPIENTS[@]} > 0)); then
  for cc in "${CC_RECIPIENTS[@]}"; do
    cc="${cc#"${cc%%[![:space:]]*}"}"
    cc="${cc%"${cc##*[![:space:]]}"}"
    [[ -z "${cc}" ]] && continue
    RCPT+=("${cc}")
  done
fi

TO_HEADER_VALUE="$(IFS=', '; echo "${TO_HEADER[*]}")"

# Legacy ITSM path only when no schedule CC was supplied.
if [[ -z "${CC_LIST}" && -z "${SCHEDULE_ID:-}" ]]; then
  RCPT+=(
    "srivaths.varadharajan@refex.co.in"
    "gowtham.s@refex.co.in"
    "pravinkumar.raja@refex.co.in"
    "mohamedaasik.m@refex.co.in"
  )
fi

# --- CID logo inlining (Outlook) ---
# Seed templates / Admin UI preview keep HTTPS logo URLs.
# At send time only: rewrite logo <img> to cid:refexone-logo and attach PNG as multipart/related.
# Other assets (shimmer GIF, etc.) stay remote. If logo cannot be resolved, fall back to plain HTML.
REFEXONE_LOGO_URL="${REFEXONE_LOGO_URL:-https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png}"
REFEXONE_LOGO_FILE="${REFEXONE_LOGO_FILE:-${REPO_ROOT}/db/seeds/assets/refexone-logo.png}"
REWRITE_SCRIPT="${REPO_ROOT}/services/engagement-pipeline/scripts/rewrite-report-logo-cid.py"
LOGO_CID="refexone-logo"
USE_CID_LOGO=0
RESOLVED_LOGO=""

resolve_refexone_logo() {
  if [[ -f "${REFEXONE_LOGO_FILE}" && -s "${REFEXONE_LOGO_FILE}" ]]; then
    printf '%s' "${REFEXONE_LOGO_FILE}"
    return 0
  fi
  LOGO_FETCH_TMP="$(mktemp)"
  if curl --silent --show-error --fail --location \
    --max-time 20 \
    -o "${LOGO_FETCH_TMP}" \
    "${REFEXONE_LOGO_URL}" \
    && [[ -s "${LOGO_FETCH_TMP}" ]]; then
    printf '%s' "${LOGO_FETCH_TMP}"
    return 0
  fi
  rm -f "${LOGO_FETCH_TMP}"
  LOGO_FETCH_TMP=""
  return 1
}

if [[ -f "${REWRITE_SCRIPT}" ]] && command -v python3 >/dev/null 2>&1; then
  if RESOLVED_LOGO="$(resolve_refexone_logo)"; then
    if python3 "${REWRITE_SCRIPT}" "${REPORT_FILE}" > "${HTML_BODY}" \
      && grep -q "cid:${LOGO_CID}" "${HTML_BODY}"; then
      USE_CID_LOGO=1
      log "Inlining Refex One logo as cid:${LOGO_CID} (Outlook multipart/related)"
    else
      log "Logo CID rewrite skipped (no matching logo <img> in report HTML)"
      cp "${REPORT_FILE}" "${HTML_BODY}"
    fi
  else
    log "Logo file unavailable — sending remote HTTPS logo URL (Gmail OK; Outlook may block)"
    cp "${REPORT_FILE}" "${HTML_BODY}"
  fi
else
  log "CID rewrite helper missing — sending plain HTML"
  cp "${REPORT_FILE}" "${HTML_BODY}"
fi

write_headers() {
  echo "From: ${FROM_EMAIL}"
  echo "To: ${TO_HEADER_VALUE}"
  if [[ -n "${CC_LIST}" ]]; then
    echo "Cc: ${CC_LIST}"
  elif [[ -z "${SCHEDULE_ID:-}" ]]; then
    echo "Cc: srivaths.varadharajan@refex.co.in, gowtham.s@refex.co.in, pravinkumar.raja@refex.co.in, mohamedaasik.m@refex.co.in"
  fi
  echo "Subject: ${SUBJECT}"
  echo "MIME-Version: 1.0"
}

if [[ "${USE_CID_LOGO}" -eq 1 ]]; then
  BOUNDARY="=_RefexReport_${TIMESTAMP}_$$"
  if base64 --help 2>&1 | grep -q -- '-w'; then
    LOGO_B64="$(base64 -w 0 "${RESOLVED_LOGO}")"
  else
    LOGO_B64="$(base64 < "${RESOLVED_LOGO}" | tr -d '\n')"
  fi
  {
    write_headers
    echo "Content-Type: multipart/related; boundary=\"${BOUNDARY}\"; type=\"text/html\""
    echo ""
    echo "--${BOUNDARY}"
    echo "Content-Type: text/html; charset=UTF-8"
    echo "Content-Transfer-Encoding: 8bit"
    echo ""
    cat "${HTML_BODY}"
    echo ""
    echo "--${BOUNDARY}"
    echo "Content-Type: image/png; name=\"refexone-logo.png\""
    echo "Content-Transfer-Encoding: base64"
    echo "Content-ID: <${LOGO_CID}>"
    echo "Content-Disposition: inline; filename=\"refexone-logo.png\""
    echo ""
    # RFC 2045: soft line breaks at 76 chars
    printf '%s' "${LOGO_B64}" | fold -w 76
    echo ""
    echo "--${BOUNDARY}--"
  } > "${MIME_FILE}"
else
  {
    write_headers
    echo "Content-Type: text/html; charset=UTF-8"
    echo ""
    cat "${HTML_BODY}"
  } > "${MIME_FILE}"
fi

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
  log "Email sent successfully to ${TO_HEADER_VALUE}"
else
  STATUS="FAILED"
  log "Email send FAILED"
fi

jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg recipient "${TO_HEADER_VALUE}" \
  --arg subject "${SUBJECT}" \
  --arg status "${STATUS}" \
  --arg report_file "${REPORT_FILE}" \
  --arg application_id "${APPLICATION_ID:-}" \
  --arg process_id "${PROCESS_ID:-}" \
  --arg schedule_id "${SCHEDULE_ID:-}" '
{
  action: "SEND_EMAIL_REPORT",
  generated_at: $generated_at,
  recipient: $recipient,
  subject: $subject,
  status: $status,
  report_file: $report_file,
  application_id: $application_id,
  process_id: $process_id,
  schedule_id: $schedule_id,
  mutation_performed: false
}
' > "${AUDIT_FILE}"

if [[ -f "${REPO_ROOT}/ops/runbooks/record-report-delivery.sh" ]]; then
  export DELIVERY_STATUS="${STATUS}"
  export RECIPIENTS="$(IFS=','; echo "${RCPT[*]}")"
  export REPORT_RUN_ID="report-run-${TIMESTAMP}"
  export ENVIRONMENT="${ENVIRONMENT:-production}"
  if [[ -z "${APPLICATION_ID:-}" ]]; then
    case "${REPORT_FILE}" in
      *pm-report*) export APPLICATION_ID="${PM_APP_ID:-Project_Management_Tracker_A00}" ;;
      *solar-report*) export APPLICATION_ID="${SOLAR_APP_ID:-Solar_Site_Expense_Governance_Syst_A00}" ;;
      *expense-report*) export APPLICATION_ID="${APPLICATION_ID:-EMS_001_A00}" ;;
      *travel-report*) export APPLICATION_ID="${APPLICATION_ID:-Expense_and_Travel_Management_A00}" ;;
      *lead-tracker*) export APPLICATION_ID="${APPLICATION_ID:-Lead_Trcaker_A00}" ;;
      *) export APPLICATION_ID="${ITSM_APP_ID:-IT_Service_Management_A00}" ;;
    esac
  fi
  if [[ -z "${PROCESS_ID:-}" ]]; then
    case "${REPORT_FILE}" in
      *pm-report*) export PROCESS_ID="${PM_PROCESS_ID:-Project_Sub_Task_A01}" ;;
      *solar-report*) export PROCESS_ID="${SOLAR_PROCESS_ID:-Technician_Reimbursement__YTLM}" ;;
      *expense-report*) export PROCESS_ID="${PROCESS_ID:-Travel_Expense_A00}" ;;
      *travel-report*) export PROCESS_ID="${PROCESS_ID:-Travel_Management_A02}" ;;
      *lead-tracker*) export PROCESS_ID="${PROCESS_ID:-Lead_tracker_1_A00}" ;;
      *) export PROCESS_ID="${ITSM_PROCESS_ID:-Live_IT_Service_Request_A00}" ;;
    esac
  fi
  bash "${REPO_ROOT}/ops/runbooks/record-report-delivery.sh" \
    || log "Warning: failed to record delivery history (non-fatal)"
fi

[[ "${STATUS}" == "SENT" ]] || stop "Delivery failed. See audit record: ${AUDIT_FILE}"

if [[ "${STATUS}" == "SENT" && -f "${REPO_ROOT}/ops/runbooks/cache-report-html.sh" ]]; then
  if [[ -z "${REPORT_CACHE_KEY:-}" ]]; then
    case "${APPLICATION_ID:-}" in
      Lead_Trcaker_A00) export REPORT_CACHE_KEY="lead-tracker:${GROUP_SLUG:-modepro}" ;;
      IT_Service_Management_A00) export REPORT_CACHE_KEY="itsm:${ENVIRONMENT:-production}" ;;
      Project_Management_Tracker_A00) export REPORT_CACHE_KEY="pm:${ENVIRONMENT:-production}" ;;
      Solar_Site_Expense_Governance_Syst_A00)
        export REPORT_CACHE_KEY="solar:v1:${SOLAR_PROCESS_ID:-Technician_Reimbursement__YTLM}:${ENVIRONMENT:-production}"
        ;;
      EMS_001_A00) export REPORT_CACHE_KEY="expense:${ENVIRONMENT:-production}" ;;
      Expense_and_Travel_Management_A00)
        export REPORT_CACHE_KEY="travel:v3:${ENTITY_FILTER:-Venwind}:${ENVIRONMENT:-production}"
        ;;
    esac
  fi
  if [[ -n "${REPORT_CACHE_KEY:-}" ]]; then
    export REPORT_CACHE_KEY REPORT_CACHE_KEY_SCHEDULE
    bash "${REPO_ROOT}/ops/runbooks/cache-report-html.sh" "${REPORT_FILE}" "${REPORT_CACHE_KEY}" \
      || log "Warning: failed to cache report HTML in PostgreSQL (non-fatal)"
  fi
fi

printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
