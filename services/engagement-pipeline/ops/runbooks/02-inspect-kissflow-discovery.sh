#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="/c/Users/Mohamed Aasik IlahiM/refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report"
DISCOVERY_DIR="${REPO_ROOT}/data/discovery"
INSPECTION_DIR="${DISCOVERY_DIR}/inspection"

MANIFEST_FILE="${DISCOVERY_DIR}/discovery-manifest.json"
USER_SEMANTICS_FILE="${DISCOVERY_DIR}/user-semantics-summary.json"
ITEM_SEMANTICS_FILE="${DISCOVERY_DIR}/item-semantics-summary.json"
USER_ERRORS_FILE="${DISCOVERY_DIR}/user-detail-errors.jsonl"
ITEM_ERRORS_FILE="${DISCOVERY_DIR}/item-detail-errors.jsonl"

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
REPORT_FILE="${INSPECTION_DIR}/semantic-inspection-${TIMESTAMP}.txt"
LATEST_REPORT="${INSPECTION_DIR}/semantic-inspection-latest.txt"

log() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

stop() {
  printf '\nSTOP: %s\n' "$*" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v grep >/dev/null 2>&1 || stop "grep is not installed."
command -v tee >/dev/null 2>&1 || stop "tee is not installed."

[[ -d "${REPO_ROOT}" ]] ||
  stop "Repository does not exist: ${REPO_ROOT}"

cd "${REPO_ROOT}"

for REQUIRED_FILE in \
  "${MANIFEST_FILE}" \
  "${USER_SEMANTICS_FILE}" \
  "${ITEM_SEMANTICS_FILE}" \
  "${USER_ERRORS_FILE}" \
  "${ITEM_ERRORS_FILE}"
do
  [[ -f "${REQUIRED_FILE}" ]] ||
    stop "Required discovery output is missing: ${REQUIRED_FILE}"
done

jq empty "${MANIFEST_FILE}" ||
  stop "Invalid JSON: ${MANIFEST_FILE}"

jq empty "${USER_SEMANTICS_FILE}" ||
  stop "Invalid JSON: ${USER_SEMANTICS_FILE}"

jq empty "${ITEM_SEMANTICS_FILE}" ||
  stop "Invalid JSON: ${ITEM_SEMANTICS_FILE}"

mkdir -p "${INSPECTION_DIR}"

USER_ERROR_COUNT="$(grep -cve '^[[:space:]]*$' "${USER_ERRORS_FILE}" || true)"
ITEM_ERROR_COUNT="$(grep -cve '^[[:space:]]*$' "${ITEM_ERRORS_FILE}" || true)"

{
  printf 'REFEX ADOPTION USER REPORT — SEMANTIC INSPECTION\n'
  printf 'Generated at: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Repository: %s\n' "${REPO_ROOT}"

  printf '\n===== DISCOVERY MANIFEST =====\n'
  jq . "${MANIFEST_FILE}"

  printf '\n===== USER SEMANTICS =====\n'
  jq . "${USER_SEMANTICS_FILE}"

  printf '\n===== ITEM SEMANTICS =====\n'
  jq . "${ITEM_SEMANTICS_FILE}"

  printf '\n===== ERROR COUNTS =====\n'
  printf 'User detail errors: %s\n' "${USER_ERROR_COUNT}"
  printf 'Item detail errors: %s\n' "${ITEM_ERROR_COUNT}"

  if [[ "${USER_ERROR_COUNT}" -gt 0 ]]; then
    printf '\n===== USER DETAIL ERRORS =====\n'
    cat "${USER_ERRORS_FILE}"
  fi

  if [[ "${ITEM_ERROR_COUNT}" -gt 0 ]]; then
    printf '\n===== ITEM DETAIL ERRORS =====\n'
    cat "${ITEM_ERRORS_FILE}"
  fi

  printf '\n===== INSPECTION STATUS =====\n'

  if [[ "${USER_ERROR_COUNT}" -eq 0 && "${ITEM_ERROR_COUNT}" -eq 0 ]]; then
    printf 'Status: COMPLETE_WITHOUT_DETAIL_ERRORS\n'
  else
    printf 'Status: COMPLETE_WITH_DETAIL_ERRORS\n'
  fi

  printf '\nNo project configuration was changed by this runbook.\n'
} | tee "${REPORT_FILE}"

cp "${REPORT_FILE}" "${LATEST_REPORT}"

log "Semantic inspection completed"
printf '\nAudit report:\n%s\n' "${REPORT_FILE}"
printf '\nStable latest-report path:\n%s\n' "${LATEST_REPORT}"
printf '\nShare the contents of semantic-inspection-latest.txt before Runbook 03 updates projectconfig.md.\n'
