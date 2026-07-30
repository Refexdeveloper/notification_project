#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
DATA_DIR="${REPO_ROOT}/data/discovery"
NORM_DIR="${DATA_DIR}/normalized"

BASE_URL="https://refexgroup.kissflow.com"
PROCESS_ID="Live_IT_Service_Request_A00"
APPLICATION_ID="IT_Service_Management_A00"
APPLICATION_NAME="IT Service Management"
PROCESS_NAME="Live IT Service Request"
ENVIRONMENT="production"
PAGE_SIZE=100
MAX_PAGES=1000

ACCOUNT_ID="${KISSFLOW_ACCOUNT_ID:-}"
KISSFLOW_KEY="${KISSFLOW_KEY:-}"
KISSFLOW_SECRET="${KISSFLOW_SECRET:-}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || stop "curl is not installed."
command -v jq >/dev/null 2>&1 || stop "jq is not installed."
[[ -n "${ACCOUNT_ID}" ]] || stop "KISSFLOW_ACCOUNT_ID is not set."
[[ -n "${KISSFLOW_KEY}" ]] || stop "KISSFLOW_KEY is not set."
[[ -n "${KISSFLOW_SECRET}" ]] || stop "KISSFLOW_SECRET is not set."

mkdir -p "${DATA_DIR}/user-pages" "${DATA_DIR}/user-details" "${DATA_DIR}/item-pages" "${DATA_DIR}/item-details" "${NORM_DIR}"

HEADERS=(
  -H "X-Access-Key-Id: ${KISSFLOW_KEY}"
  -H "X-Access-Key-Secret: ${KISSFLOW_SECRET}"
  -H "Accept: application/json"
)

api_get() {
  local url="$1" output_file="$2" http_code
  http_code="$(curl --silent --show-error --location --connect-timeout 20 --max-time 120 \
    --retry 3 --retry-delay 2 --retry-all-errors \
    "${HEADERS[@]}" --output "${output_file}.tmp" --write-out '%{http_code}' "${url}")"
  if [[ "${http_code}" != "200" ]]; then
    printf '\nRequest failed: HTTP %s\nURL: %s\n' "${http_code}" "${url}" >&2
    rm -f "${output_file}.tmp"
    return 1
  fi
  jq empty "${output_file}.tmp" || stop "Invalid JSON from ${url}"
  mv "${output_file}.tmp" "${output_file}"
}

extract_array() {
  jq -c 'if type == "array" then . elif (.Data?|type)=="array" then .Data elif (.data?|type)=="array" then .data elif (.Items?|type)=="array" then .Items elif (.items?|type)=="array" then .items else [] end'
}

extract_identifier() {
  jq -r '._id // .id // .Id // .ID // .instance_id // .InstanceId // empty'
}

log "Retrieving Kissflow users"
: > "${DATA_DIR}/users.jsonl"
for ((page=1; page<=MAX_PAGES; page++)); do
  page_file="${DATA_DIR}/user-pages/page-${page}.json"
  api_get "${BASE_URL}/user/2/${ACCOUNT_ID}/?page_number=${page}&page_size=${PAGE_SIZE}&user_type=User&invited_user=false" "${page_file}"
  page_count="$(extract_array < "${page_file}" | jq 'length')"
  log "User page ${page}: ${page_count} records"
  [[ "${page_count}" -eq 0 ]] && break
  extract_array < "${page_file}" | jq -c '.[]' >> "${DATA_DIR}/users.jsonl"
  [[ "${page_count}" -lt "${PAGE_SIZE}" ]] && break
done
USER_COUNT="$(wc -l < "${DATA_DIR}/users.jsonl" | tr -d ' ')"
log "Total users: ${USER_COUNT}"

log "Retrieving user details"
: > "${DATA_DIR}/user-details.jsonl"
: > "${DATA_DIR}/user-detail-errors.jsonl"
while IFS= read -r user_json; do
  user_id="$(printf '%s\n' "${user_json}" | extract_identifier)"
  [[ -z "${user_id}" ]] && continue
  safe_id="$(printf '%s' "${user_id}" | tr -cs 'A-Za-z0-9._-' '_')"
  detail_file="${DATA_DIR}/user-details/${safe_id}.json"
  if api_get "${BASE_URL}/user/2/${ACCOUNT_ID}/${user_id}" "${detail_file}"; then
    jq -c --arg rid "${user_id}" '. + {__requested_user_id:$rid}' "${detail_file}" >> "${DATA_DIR}/user-details.jsonl"
  else
    jq -cn --arg id "${user_id}" '{user_id:$id,error:"detail failed"}' >> "${DATA_DIR}/user-detail-errors.jsonl"
  fi
done < "${DATA_DIR}/users.jsonl"

log "Retrieving process items"
: > "${DATA_DIR}/items.jsonl"
for ((page=1; page<=MAX_PAGES; page++)); do
  page_file="${DATA_DIR}/item-pages/page-${page}.json"
  api_get "${BASE_URL}/process/2/${ACCOUNT_ID}/admin/${PROCESS_ID}/item?page_number=${page}&page_size=${PAGE_SIZE}&apply_preference=false" "${page_file}"
  page_count="$(extract_array < "${page_file}" | jq 'length')"
  log "Item page ${page}: ${page_count} records"
  [[ "${page_count}" -eq 0 ]] && break
  extract_array < "${page_file}" | jq -c '.[]' >> "${DATA_DIR}/items.jsonl"
  [[ "${page_count}" -lt "${PAGE_SIZE}" ]] && break
done
ITEM_COUNT="$(wc -l < "${DATA_DIR}/items.jsonl" | tr -d ' ')"
log "Total items: ${ITEM_COUNT}"

log "Retrieving item details"
: > "${DATA_DIR}/item-details.jsonl"
: > "${DATA_DIR}/item-detail-errors.jsonl"
while IFS= read -r item_json; do
  instance_id="$(printf '%s\n' "${item_json}" | extract_identifier)"
  [[ -z "${instance_id}" ]] && continue
  safe_id="$(printf '%s' "${instance_id}" | tr -cs 'A-Za-z0-9._-' '_')"
  detail_file="${DATA_DIR}/item-details/${safe_id}.json"
  if api_get "${BASE_URL}/process/2/${ACCOUNT_ID}/admin/${PROCESS_ID}/${instance_id}" "${detail_file}"; then
    jq -c --arg rid "${instance_id}" '. + {__requested_instance_id:$rid}' "${detail_file}" >> "${DATA_DIR}/item-details.jsonl"
  else
    jq -cn --arg id "${instance_id}" '{instance_id:$id,error:"detail failed"}' >> "${DATA_DIR}/item-detail-errors.jsonl"
  fi
done < "${DATA_DIR}/items.jsonl"
DETAIL_ITEM_COUNT="$(wc -l < "${DATA_DIR}/item-details.jsonl" | tr -d ' ')"
log "Item details retrieved: ${DETAIL_ITEM_COUNT}"

RUN_ID="ingest-$(date -u +'%Y%m%dT%H%M%SZ')"
GENERATED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

log "Normalizing users"
jq -c --arg run_id "${RUN_ID}" --arg gen "${GENERATED_AT}" --arg env "${ENVIRONMENT}" '
{
  snapshot_run_id: $run_id, snapshot_at: $gen, environment: $env,
  user_id: (.__requested_user_id // ._id // null),
  user_name: (.Name // null), email: (.Email // null),
  user_type: (._user_type // null), active_status: (.Status // null),
  last_sign_in: (.LastLoggedInAt.v // null),
  ever_logged_in: (if .LastLoggedInAt == null then false else true end),
  source_payload: .
}' "${DATA_DIR}/user-details.jsonl" > "${NORM_DIR}/kissflow-users.jsonl"

log "Normalizing items"
jq -c --arg run_id "${RUN_ID}" --arg gen "${GENERATED_AT}" --arg env "${ENVIRONMENT}" \
  --arg app_id "${APPLICATION_ID}" --arg app_name "${APPLICATION_NAME}" \
  --arg proc_id "${PROCESS_ID}" --arg proc_name "${PROCESS_NAME}" '
{
  snapshot_run_id: $run_id, snapshot_at: $gen, environment: $env,
  application_id: $app_id, application_name: $app_name,
  process_id: $proc_id, process_name: $proc_name,
  instance_id: (.__requested_instance_id // .Instance_ID // ._id // null),
  request_number: (._request_number // null), request_id: (.Request_ID // null),
  process_status: (._status // null), current_step: (._current_step // null),
  stage: (._stage // null), criticality: (.Criticality // null),
  entity: (.Entity // null), requester_email: (.Requester_Email // null),
  source_payload: .
}' "${DATA_DIR}/item-details.jsonl" > "${NORM_DIR}/kissflow-process-items.jsonl"

log "Extracting roles"
jq -s -c --arg run_id "${RUN_ID}" --arg gen "${GENERATED_AT}" --arg env "${ENVIRONMENT}" \
  --arg app_id "${APPLICATION_ID}" --arg app_name "${APPLICATION_NAME}" '
[.[] | ._current_assigned_to[]? | select(.Kind == "AppRole") |
{ snapshot_run_id: $run_id, snapshot_at: $gen, environment: $env,
  application_id: $app_id, application_name: $app_name,
  role_id: ._id, role_name: .Name, role_kind: .Kind }]
| unique_by(.role_id) | sort_by(.role_name) | .[]
' "${DATA_DIR}/item-details.jsonl" > "${NORM_DIR}/kissflow-app-roles.jsonl"

log "Building assignment bridge"
jq -c --arg run_id "${RUN_ID}" --arg gen "${GENERATED_AT}" --arg env "${ENVIRONMENT}" \
  --arg app_id "${APPLICATION_ID}" --arg proc_id "${PROCESS_ID}" '
(.__requested_instance_id // .Instance_ID // ._id // null) as $iid
| ._current_assigned_to[]?
| { snapshot_run_id: $run_id, snapshot_at: $gen, environment: $env,
    application_id: $app_id, process_id: $proc_id, instance_id: $iid,
    principal_id: ._id, principal_name: .Name,
    principal_kind: (if .Kind=="User" then "USER" elif .Kind=="AppRole" then "APP_ROLE" else (.Kind|ascii_upcase) end),
    assignment_source_field: "_current_assigned_to" }
' "${DATA_DIR}/item-details.jsonl" > "${NORM_DIR}/kissflow-item-assignments.jsonl"

ROLE_COUNT="$(wc -l < "${NORM_DIR}/kissflow-app-roles.jsonl" | tr -d ' ')"
ASSIGN_COUNT="$(wc -l < "${NORM_DIR}/kissflow-item-assignments.jsonl" | tr -d ' ')"
NORM_USER_COUNT="$(wc -l < "${NORM_DIR}/kissflow-users.jsonl" | tr -d ' ')"
NORM_ITEM_COUNT="$(wc -l < "${NORM_DIR}/kissflow-process-items.jsonl" | tr -d ' ')"

log "Loading into PostgreSQL"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

run_sql() { psql "${PG_CONN}"; }

echo "
CREATE TABLE IF NOT EXISTS engagement_reporting.stg_users (user_id text, snapshot_at text, user_name text, email text, user_type text, active_status text, last_sign_in text, ever_logged_in text, source_payload text);
CREATE TABLE IF NOT EXISTS engagement_reporting.stg_roles (role_id text, role_name text);
CREATE TABLE IF NOT EXISTS engagement_reporting.stg_items (instance_id text, snapshot_at text, process_status text, current_step text, stage text, request_number text, request_id text, criticality text, entity text, requester_email text, source_payload text);
CREATE TABLE IF NOT EXISTS engagement_reporting.stg_assignments (instance_id text, snapshot_at text, principal_id text, principal_kind text, assignment_source text);
TRUNCATE engagement_reporting.stg_users, engagement_reporting.stg_roles, engagement_reporting.stg_items, engagement_reporting.stg_assignments;
" | run_sql

jq -r '[.user_id, .snapshot_at, .user_name, .email, .user_type, .active_status, (.last_sign_in // ""), .ever_logged_in, (.source_payload | tojson)] | @csv' "${NORM_DIR}/kissflow-users.jsonl" > "${NORM_DIR}/users-staging.csv"
jq -r '[.role_id, .role_name] | @csv' "${NORM_DIR}/kissflow-app-roles.jsonl" > "${NORM_DIR}/roles-staging.csv"
jq -r '[.instance_id, .snapshot_at, .process_status, (.current_step // ""), (.stage // "" | tostring), (.request_number // "" | tostring), (.request_id // ""), (.criticality // ""), (.entity // ""), (.requester_email // ""), (.source_payload | tojson)] | @csv' "${NORM_DIR}/kissflow-process-items.jsonl" > "${NORM_DIR}/items-staging.csv"
jq -r '[.instance_id, .snapshot_at, .principal_id, .principal_kind, .assignment_source_field] | @csv' "${NORM_DIR}/kissflow-item-assignments.jsonl" > "${NORM_DIR}/assignments-staging.csv"

if command -v cygpath >/dev/null 2>&1; then
  COPY_NORM_DIR="$(cygpath -w "${NORM_DIR}")"
else
  COPY_NORM_DIR="${NORM_DIR}"
fi
echo "\copy engagement_reporting.stg_users FROM '${COPY_NORM_DIR}/users-staging.csv' WITH (FORMAT csv)" | run_sql
echo "\copy engagement_reporting.stg_roles FROM '${COPY_NORM_DIR}/roles-staging.csv' WITH (FORMAT csv)" | run_sql
echo "\copy engagement_reporting.stg_items FROM '${COPY_NORM_DIR}/items-staging.csv' WITH (FORMAT csv)" | run_sql
echo "\copy engagement_reporting.stg_assignments FROM '${COPY_NORM_DIR}/assignments-staging.csv' WITH (FORMAT csv)" | run_sql

echo "
BEGIN;

INSERT INTO engagement_reporting.snapshot_run (snapshot_run_id, source_system, environment, application_id, process_id, extraction_started_at, extraction_completed_at, load_started_at, status, user_record_count, role_record_count, item_record_count, assignment_record_count, unresolved_role_count, source_manifest)
VALUES ('${RUN_ID}', 'KISSFLOW', '${ENVIRONMENT}', '${APPLICATION_ID}', '${PROCESS_ID}', now(), now(), now(), 'IN_PROGRESS', ${NORM_USER_COUNT}, ${ROLE_COUNT}, ${NORM_ITEM_COUNT}, ${ASSIGN_COUNT}, ${ROLE_COUNT}, '{}')
ON CONFLICT (snapshot_run_id) DO NOTHING;

INSERT INTO engagement_reporting.application (environment, application_id, application_name, first_seen_at, last_seen_at, is_current, source_payload)
VALUES ('${ENVIRONMENT}', '${APPLICATION_ID}', '${APPLICATION_NAME}', now(), now(), true, '{}')
ON CONFLICT (environment, application_id) DO UPDATE SET last_seen_at = now();

INSERT INTO engagement_reporting.process (environment, process_id, application_id, process_name, first_seen_at, last_seen_at, is_current, source_payload)
VALUES ('${ENVIRONMENT}', '${PROCESS_ID}', '${APPLICATION_ID}', '${PROCESS_NAME}', now(), now(), true, '{}')
ON CONFLICT (environment, process_id) DO UPDATE SET last_seen_at = now();

INSERT INTO engagement_reporting.\"user\" (environment, user_id, snapshot_at, snapshot_run_id, user_name, email, user_type, active_status, last_sign_in, ever_logged_in, source_payload, row_hash)
SELECT '${ENVIRONMENT}', user_id, snapshot_at::timestamptz, '${RUN_ID}', user_name, email, user_type, active_status, NULLIF(last_sign_in,'')::timestamptz, ever_logged_in::boolean, source_payload::jsonb, md5(source_payload)
FROM engagement_reporting.stg_users
ON CONFLICT (environment, user_id, snapshot_at) DO NOTHING;

INSERT INTO engagement_reporting.principal (environment, application_id, principal_id, principal_type, principal_name, first_seen_at, last_seen_at, is_current, source_payload)
SELECT '${ENVIRONMENT}', '${APPLICATION_ID}', user_id, 'USER', user_name, now(), now(), true, '{}' FROM engagement_reporting.stg_users
ON CONFLICT (environment, application_id, principal_id, principal_type) DO UPDATE SET last_seen_at = now();

INSERT INTO engagement_reporting.principal_user (environment, application_id, principal_id, principal_type, user_id, valid_from, snapshot_run_id, resolution_source, resolution_status)
SELECT '${ENVIRONMENT}', '${APPLICATION_ID}', user_id, 'USER', user_id, now(), '${RUN_ID}', 'DIRECT_USER_SELF_MAP', 'RESOLVED' FROM engagement_reporting.stg_users
ON CONFLICT DO NOTHING;

INSERT INTO engagement_reporting.principal (environment, application_id, principal_id, principal_type, principal_name, first_seen_at, last_seen_at, is_current, source_payload)
SELECT '${ENVIRONMENT}', '${APPLICATION_ID}', role_id, 'APP_ROLE', role_name, now(), now(), true, '{}' FROM engagement_reporting.stg_roles
ON CONFLICT (environment, application_id, principal_id, principal_type) DO UPDATE SET last_seen_at = now();

INSERT INTO engagement_reporting.role_membership_resolution (snapshot_run_id, environment, application_id, role_id, status, attempt_count)
SELECT '${RUN_ID}', '${ENVIRONMENT}', '${APPLICATION_ID}', role_id, 'PENDING', 0 FROM engagement_reporting.stg_roles
ON CONFLICT (snapshot_run_id, environment, application_id, role_id) DO NOTHING;

INSERT INTO engagement_reporting.item (environment, process_id, instance_id, snapshot_at, snapshot_run_id, process_status, current_step, stage, request_number, request_id, criticality, entity, requester_email, source_payload, row_hash)
SELECT '${ENVIRONMENT}', '${PROCESS_ID}', instance_id, snapshot_at::timestamptz, '${RUN_ID}', process_status, NULLIF(current_step,''), NULLIF(stage,''), NULLIF(request_number,'')::integer, NULLIF(request_id,''), NULLIF(criticality,''), NULLIF(entity,''), NULLIF(requester_email,''), source_payload::jsonb, md5(source_payload)
FROM engagement_reporting.stg_items
ON CONFLICT (environment, process_id, instance_id, snapshot_at) DO NOTHING;

UPDATE engagement_reporting.item SET modified_by_id = source_payload->'_modified_by'->>'_id', modified_by_name = source_payload->'_modified_by'->>'Name' WHERE snapshot_run_id = '${RUN_ID}' AND modified_by_id IS NULL;

INSERT INTO engagement_reporting.item_assignment (environment, application_id, process_id, instance_id, snapshot_at, snapshot_run_id, principal_id, principal_type, assignment_source, source_payload)
SELECT '${ENVIRONMENT}', '${APPLICATION_ID}', '${PROCESS_ID}', instance_id, snapshot_at::timestamptz, '${RUN_ID}', principal_id, principal_kind, assignment_source, '{}'
FROM engagement_reporting.stg_assignments
ON CONFLICT (environment, process_id, instance_id, snapshot_at, principal_id, principal_type) DO NOTHING;

UPDATE engagement_reporting.snapshot_run SET status = 'PARTIAL', load_completed_at = now(), updated_at = now() WHERE snapshot_run_id = '${RUN_ID}';

COMMIT;
" | run_sql

log "Ingestion and load completed. Snapshot: ${RUN_ID}"
