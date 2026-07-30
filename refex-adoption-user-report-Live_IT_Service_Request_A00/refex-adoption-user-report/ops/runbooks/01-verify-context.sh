#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="/c/Users/Mohamed Aasik IlahiM/refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report"
RUNBOOK_DIR="${REPO_ROOT}/ops/runbooks"
OUTPUT_DIR="${REPO_ROOT}/data/discovery"

BASE_URL="https://development-refexgroup.kissflow.com"
PROCESS_ID="Live_IT_Service_Request_A00"
PAGE_SIZE=100
MAX_PAGES=1000

log() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

stop() {
  printf '\nSTOP: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  unset KISSFLOW_DEVELOPER_KEY
  unset KISSFLOW_DEVELOPER_SECRET
  stty echo </dev/tty 2>/dev/null || true
}
trap cleanup EXIT INT TERM

command -v curl >/dev/null 2>&1 || stop "curl is not installed."
command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v git >/dev/null 2>&1 || stop "git is not installed."

mkdir -p \
  "${OUTPUT_DIR}/user-pages" \
  "${OUTPUT_DIR}/user-details" \
  "${OUTPUT_DIR}/item-pages" \
  "${OUTPUT_DIR}/item-details" \
  "${REPO_ROOT}/docs" \
  "${REPO_ROOT}/src" \
  "${REPO_ROOT}/templates/generated" \
  "${REPO_ROOT}/tests"

if [[ ! -d "${REPO_ROOT}/.git" ]]; then
  git -C "${REPO_ROOT}" init -b main
fi

printf 'Enter Kissflow DEV account ID: '
IFS= read -r ACCOUNT_ID </dev/tty
[[ -n "${ACCOUNT_ID}" ]] || stop "Account ID is required."

printf 'Enter Kissflow Developer Key ID: '
IFS= read -r KISSFLOW_DEVELOPER_KEY </dev/tty
[[ -n "${KISSFLOW_DEVELOPER_KEY}" ]] || stop "Developer Key ID is required."

printf 'Enter Kissflow Developer Secret (input hidden): '
stty -echo </dev/tty
IFS= read -r KISSFLOW_DEVELOPER_SECRET </dev/tty
stty echo </dev/tty
printf '\n'
[[ -n "${KISSFLOW_DEVELOPER_SECRET}" ]] || stop "Developer Secret is required."

HEADERS=(
  -H "X-Access-Key-Id: ${KISSFLOW_DEVELOPER_KEY}"
  -H "X-Access-Key-Secret: ${KISSFLOW_DEVELOPER_SECRET}"
  -H "Accept: application/json"
)

api_get() {
  local url="$1"
  local output_file="$2"
  local http_code

  http_code="$(
    curl \
      --silent \
      --show-error \
      --location \
      --connect-timeout 20 \
      --max-time 120 \
      --retry 3 \
      --retry-delay 2 \
      --retry-all-errors \
      "${HEADERS[@]}" \
      --output "${output_file}.tmp" \
      --write-out '%{http_code}' \
      "${url}"
  )"

  if [[ "${http_code}" != "200" ]]; then
    printf '\nRequest failed: HTTP %s\nURL: %s\nResponse:\n' "${http_code}" "${url}" >&2
    cat "${output_file}.tmp" >&2 || true
    rm -f "${output_file}.tmp"
    return 1
  fi

  jq empty "${output_file}.tmp" ||
    stop "The response from ${url} was not valid JSON."

  mv "${output_file}.tmp" "${output_file}"
}

extract_array() {
  jq -c '
    if type == "array" then .
    elif (.Data? | type) == "array" then .Data
    elif (.data? | type) == "array" then .data
    elif (.Items? | type) == "array" then .Items
    elif (.items? | type) == "array" then .items
    elif (.Records? | type) == "array" then .Records
    elif (.records? | type) == "array" then .records
    elif (.Result? | type) == "array" then .Result
    elif (.result? | type) == "array" then .result
    else []
    end
  '
}

extract_identifier() {
  jq -r '
    ._id //
    .id //
    .Id //
    .ID //
    .user_id //
    .UserId //
    .UserID //
    .instance_id //
    .InstanceId //
    .InstanceID //
    ._instance_id //
    empty
  '
}

log "Retrieving all Kissflow users"

: > "${OUTPUT_DIR}/users.jsonl"

for ((page=1; page<=MAX_PAGES; page++)); do
  page_file="${OUTPUT_DIR}/user-pages/page-${page}.json"

  api_get \
    "${BASE_URL}/user/2/${ACCOUNT_ID}/?page_number=${page}&page_size=${PAGE_SIZE}&user_type=User&invited_user=false" \
    "${page_file}"

  page_count="$(
    extract_array < "${page_file}" |
      jq 'length'
  )"

  log "User page ${page}: ${page_count} records"

  if [[ "${page_count}" -eq 0 ]]; then
    break
  fi

  extract_array < "${page_file}" |
    jq -c '.[]' >> "${OUTPUT_DIR}/users.jsonl"

  if [[ "${page_count}" -lt "${PAGE_SIZE}" ]]; then
    break
  fi
done

USER_COUNT="$(wc -l < "${OUTPUT_DIR}/users.jsonl" | tr -d ' ')"
log "Total users retrieved: ${USER_COUNT}"

log "Retrieving user details"

: > "${OUTPUT_DIR}/user-details.jsonl"
: > "${OUTPUT_DIR}/user-detail-errors.jsonl"

while IFS= read -r user_json; do
  user_id="$(printf '%s\n' "${user_json}" | extract_identifier)"

  if [[ -z "${user_id}" ]]; then
    jq -cn \
      --arg error "No user identifier found" \
      --argjson record "${user_json}" \
      '{error:$error,record:$record}' \
      >> "${OUTPUT_DIR}/user-detail-errors.jsonl"
    continue
  fi

  safe_user_id="$(printf '%s' "${user_id}" | tr -cs 'A-Za-z0-9._-' '_')"
  detail_file="${OUTPUT_DIR}/user-details/${safe_user_id}.json"

  if api_get \
    "${BASE_URL}/user/2/${ACCOUNT_ID}/${user_id}" \
    "${detail_file}"; then
    jq -c \
      --arg requested_user_id "${user_id}" \
      '. + {__requested_user_id:$requested_user_id}' \
      "${detail_file}" >> "${OUTPUT_DIR}/user-details.jsonl"
  else
    jq -cn \
      --arg user_id "${user_id}" \
      --arg error "User detail API failed" \
      '{user_id:$user_id,error:$error}' \
      >> "${OUTPUT_DIR}/user-detail-errors.jsonl"
  fi
done < "${OUTPUT_DIR}/users.jsonl"

log "Retrieving all process items"

: > "${OUTPUT_DIR}/items.jsonl"

for ((page=1; page<=MAX_PAGES; page++)); do
  page_file="${OUTPUT_DIR}/item-pages/page-${page}.json"

  api_get \
    "${BASE_URL}/process/2/${ACCOUNT_ID}/admin/${PROCESS_ID}/item?page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=false" \
    "${page_file}"

  page_count="$(
    extract_array < "${page_file}" |
      jq 'length'
  )"

  log "Item page ${page}: ${page_count} records"

  if [[ "${page_count}" -eq 0 ]]; then
    break
  fi

  extract_array < "${page_file}" |
    jq -c '.[]' >> "${OUTPUT_DIR}/items.jsonl"

  if [[ "${page_count}" -lt "${PAGE_SIZE}" ]]; then
    break
  fi
done

ITEM_COUNT="$(wc -l < "${OUTPUT_DIR}/items.jsonl" | tr -d ' ')"
log "Total process items retrieved: ${ITEM_COUNT}"

log "Retrieving complete details for each item"

: > "${OUTPUT_DIR}/item-details.jsonl"
: > "${OUTPUT_DIR}/item-detail-errors.jsonl"

while IFS= read -r item_json; do
  instance_id="$(printf '%s\n' "${item_json}" | extract_identifier)"

  if [[ -z "${instance_id}" ]]; then
    jq -cn \
      --arg error "No instance identifier found" \
      --argjson record "${item_json}" \
      '{error:$error,record:$record}' \
      >> "${OUTPUT_DIR}/item-detail-errors.jsonl"
    continue
  fi

  safe_instance_id="$(printf '%s' "${instance_id}" | tr -cs 'A-Za-z0-9._-' '_')"
  detail_file="${OUTPUT_DIR}/item-details/${safe_instance_id}.json"

  if api_get \
    "${BASE_URL}/process/2/${ACCOUNT_ID}/admin/${PROCESS_ID}/${instance_id}" \
    "${detail_file}"; then
    jq -c \
      --arg requested_instance_id "${instance_id}" \
      '. + {__requested_instance_id:$requested_instance_id}' \
      "${detail_file}" >> "${OUTPUT_DIR}/item-details.jsonl"
  else
    jq -cn \
      --arg instance_id "${instance_id}" \
      --arg error "Item detail API failed" \
      '{instance_id:$instance_id,error:$error}' \
      >> "${OUTPUT_DIR}/item-detail-errors.jsonl"
  fi
done < "${OUTPUT_DIR}/items.jsonl"

log "Building semantic inventory"

jq -s '
  def scalar_paths:
    paths(scalars) |
    map(tostring) |
    join(".");

  {
    generated_at: (now | todateiso8601),
    record_count: length,
    all_field_paths:
      (
        [ .[] | scalar_paths ] |
        group_by(.) |
        map({field_path: .[0], occurrence_count: length}) |
        sort_by(-.occurrence_count)
      ),
    assignment_candidate_paths:
      (
        [ .[] | scalar_paths | select(ascii_downcase | test("assign|assignee|currently_assigned|owner|sales.person|manager")) ] | unique
      ),
    status_candidate_paths:
      (
        [ .[] | scalar_paths | select(ascii_downcase | test("status|state|step|stage")) ] | unique
      ),
    assignment_values:
      (
        [ .[] | to_entries[]? | select((.key | ascii_downcase) | test("assign|assignee|currently_assigned|owner")) | {field: .key, value: .value} ]
      ),
    status_values:
      (
        [ .[] | to_entries[]? | select((.key | ascii_downcase) | test("status|state|step|stage")) | {field: .key, value: .value} ] |
        group_by(.field) |
        map({field: .[0].field, values: ([.[].value] | unique)})
      )
  }
' "${OUTPUT_DIR}/item-details.jsonl" \
  > "${OUTPUT_DIR}/item-semantics-summary.json"

jq -s '
  {
    generated_at: (now | todateiso8601),
    record_count: length,
    all_field_paths:
      (
        [ .[] | paths(scalars) | map(tostring) | join(".") ] |
        group_by(.) |
        map({field_path: .[0], occurrence_count: length}) |
        sort_by(-.occurrence_count)
      ),
    sign_in_candidate_paths:
      (
        [ .[] | paths(scalars) | map(tostring) | join(".") | select(ascii_downcase | test("signin|sign.in|login|last.login|last.sign|activity")) ] | unique
      ),
    manager_candidate_paths:
      (
        [ .[] | paths(scalars) | map(tostring) | join(".") | select(ascii_downcase | test("manager|reporting|supervisor")) ] | unique
      )
  }
' "${OUTPUT_DIR}/user-details.jsonl" \
  > "${OUTPUT_DIR}/user-semantics-summary.json"

cat > "${OUTPUT_DIR}/discovery-manifest.json" <<JSON
{
  "generated_at": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "environment": "development",
  "base_url": "${BASE_URL}",
  "account_id": "${ACCOUNT_ID}",
  "process_id": "${PROCESS_ID}",
  "user_count": ${USER_COUNT},
  "item_count": ${ITEM_COUNT},
  "outputs": {
    "users": "data/discovery/users.jsonl",
    "user_details": "data/discovery/user-details.jsonl",
    "user_semantics": "data/discovery/user-semantics-summary.json",
    "items": "data/discovery/items.jsonl",
    "item_details": "data/discovery/item-details.jsonl",
    "item_semantics": "data/discovery/item-semantics-summary.json"
  }
}
JSON

log "Discovery completed"

printf '\nRepository:\n%s\n\n' "${REPO_ROOT}"
printf 'User records: %s\n' "${USER_COUNT}"
printf 'Process item records: %s\n\n' "${ITEM_COUNT}"

printf 'Review these files next:\n'
printf '  %s\n' "${OUTPUT_DIR}/discovery-manifest.json"
printf '  %s\n' "${OUTPUT_DIR}/user-semantics-summary.json"
printf '  %s\n' "${OUTPUT_DIR}/item-semantics-summary.json"
printf '  %s\n' "${OUTPUT_DIR}/user-detail-errors.jsonl"
printf '  %s\n' "${OUTPUT_DIR}/item-detail-errors.jsonl"

printf '\nCredentials were used only in this process and were not written into the repository.\n'
