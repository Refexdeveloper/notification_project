#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="/c/Users/Mohamed Aasik IlahiM/refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report"
DISCOVERY_DIR="${REPO_ROOT}/data/discovery"
OUTPUT_DIR="${DISCOVERY_DIR}/inspection"
NORMALIZED_DIR="${DISCOVERY_DIR}/normalized"

USER_DETAILS="${DISCOVERY_DIR}/user-details.jsonl"
ITEM_DETAILS="${DISCOVERY_DIR}/item-details.jsonl"
USER_ERRORS="${DISCOVERY_DIR}/user-detail-errors.jsonl"
ITEM_ERRORS="${DISCOVERY_DIR}/item-detail-errors.jsonl"

SUMMARY_JSON="${OUTPUT_DIR}/compact-semantic-summary.json"
SUMMARY_TEXT="${OUTPUT_DIR}/compact-semantic-summary.txt"

NORMALIZED_USERS="${NORMALIZED_DIR}/kissflow-users.jsonl"
NORMALIZED_ROLES="${NORMALIZED_DIR}/kissflow-app-roles.jsonl"
NORMALIZED_ITEMS="${NORMALIZED_DIR}/kissflow-process-items.jsonl"
NORMALIZED_ASSIGNMENTS="${NORMALIZED_DIR}/kissflow-item-assignments.jsonl"
ROLE_RESOLUTION_QUEUE="${NORMALIZED_DIR}/role-membership-resolution-queue.jsonl"
NORMALIZED_MANIFEST="${NORMALIZED_DIR}/normalized-manifest.json"

APPLICATION_ID="IT_Service_Management_A00"
APPLICATION_NAME="IT Service Management"
PROCESS_ID="Live_IT_Service_Request_A00"
PROCESS_NAME="Live IT Service Request"
ENVIRONMENT="development"

RUN_ID="semantic-discovery-$(date -u +'%Y%m%dT%H%M%SZ')"
GENERATED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

log() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

stop() {
  printf '\nSTOP: %s\n' "$*" >&2
  exit 1
}

count_non_empty_lines() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    printf '0'
    return
  fi
  grep -cve '^[[:space:]]*$' "${file}" || true
}

validate_jsonl() {
  local file="$1"
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    printf '%s\n' "${line}" | jq empty ||
      stop "Invalid JSONL record found in ${file}"
  done < "${file}"
}

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v grep >/dev/null 2>&1 || stop "grep is not installed."
command -v tee >/dev/null 2>&1 || stop "tee is not installed."

[[ -d "${REPO_ROOT}" ]] || stop "Repository does not exist: ${REPO_ROOT}"
[[ -f "${USER_DETAILS}" ]] || stop "Missing discovery artifact: ${USER_DETAILS}"
[[ -f "${ITEM_DETAILS}" ]] || stop "Missing discovery artifact: ${ITEM_DETAILS}"

cd "${REPO_ROOT}"

validate_jsonl "${USER_DETAILS}"
validate_jsonl "${ITEM_DETAILS}"

mkdir -p "${OUTPUT_DIR}" "${NORMALIZED_DIR}"

log "Creating normalized Kissflow user records"

jq -c \
  --arg run_id "${RUN_ID}" \
  --arg generated_at "${GENERATED_AT}" \
  --arg environment "${ENVIRONMENT}" '
  {
    snapshot_run_id: $run_id,
    snapshot_at: $generated_at,
    environment: $environment,

    user_id: (.__requested_user_id // ._id // null),
    user_name: (.Name // null),
    email: (.Email // null),
    user_type: (._user_type // null),
    active_status: (.Status // null),
    last_sign_in: (.LastLoggedInAt.v // null),
    ever_logged_in: (if .LastLoggedInAt == null then false else true end),

    source_payload: .
  }
' "${USER_DETAILS}" > "${NORMALIZED_USERS}"

log "Creating normalized process-item records"

jq -c \
  --arg run_id "${RUN_ID}" \
  --arg generated_at "${GENERATED_AT}" \
  --arg environment "${ENVIRONMENT}" \
  --arg app_id "${APPLICATION_ID}" \
  --arg app_name "${APPLICATION_NAME}" \
  --arg process_id "${PROCESS_ID}" \
  --arg process_name "${PROCESS_NAME}" '
  {
    snapshot_run_id: $run_id,
    snapshot_at: $generated_at,
    environment: $environment,

    application_id: $app_id,
    application_name: $app_name,
    process_id: $process_id,
    process_name: $process_name,

    instance_id: (.__requested_instance_id // .Instance_ID // ._id // null),
    request_number: (._request_number // null),
    request_id: (.Request_ID // null),

    process_status: (._status // null),
    current_step: (._current_step // null),
    stage: (._stage // null),

    criticality: (.Criticality // null),
    entity: (.Entity // null),
    requester_email: (.Requester_Email // null),

    source_payload: .
  }
' "${ITEM_DETAILS}" > "${NORMALIZED_ITEMS}"

log "Extracting distinct application-role principals"

jq -s -c \
  --arg run_id "${RUN_ID}" \
  --arg generated_at "${GENERATED_AT}" \
  --arg environment "${ENVIRONMENT}" \
  --arg app_id "${APPLICATION_ID}" \
  --arg app_name "${APPLICATION_NAME}" '
  [
    .[]
    | ._current_assigned_to[]?
    | select(.Kind == "AppRole")
    | {
        snapshot_run_id: $run_id,
        snapshot_at: $generated_at,
        environment: $environment,
        application_id: $app_id,
        application_name: $app_name,
        role_id: ._id,
        role_name: .Name,
        role_kind: .Kind,
        membership_resolution_status: "PENDING_ROLE_MEMBER_API"
      }
  ]
  | unique_by(.application_id, .role_id)
  | sort_by(.role_name)
  | .[]
' "${ITEM_DETAILS}" > "${NORMALIZED_ROLES}"

log "Creating polymorphic item-assignment bridge"

jq -c \
  --arg run_id "${RUN_ID}" \
  --arg generated_at "${GENERATED_AT}" \
  --arg environment "${ENVIRONMENT}" \
  --arg app_id "${APPLICATION_ID}" \
  --arg process_id "${PROCESS_ID}" '
  (.__requested_instance_id // .Instance_ID // ._id // null) as $instance_id
  | ._current_assigned_to[]?
  | {
      snapshot_run_id: $run_id,
      snapshot_at: $generated_at,
      environment: $environment,
      application_id: $app_id,
      process_id: $process_id,
      instance_id: $instance_id,

      principal_id: ._id,
      principal_name: .Name,
      principal_kind:
        (
          if .Kind == "User" then "USER"
          elif .Kind == "AppRole" then "APP_ROLE"
          else (.Kind | ascii_upcase)
          end
        ),

      assignment_source_field: "_current_assigned_to",
      requires_role_expansion: (.Kind == "AppRole")
    }
' "${ITEM_DETAILS}" > "${NORMALIZED_ASSIGNMENTS}"

log "Creating application-role membership resolution queue"

jq -c '
  {
    snapshot_run_id,
    snapshot_at,
    environment,
    application_id,
    application_name,
    role_id,
    role_name,
    resolution_status: "PENDING",
    resolution_source: "KISSFLOW_APPLICATION_ROLE_MEMBERSHIP_API",
    required_output_table: "kissflow_principal_user",
    retry_count: 0,
    last_error: null
  }
' "${NORMALIZED_ROLES}" > "${ROLE_RESOLUTION_QUEUE}"

USER_ERROR_COUNT="$(count_non_empty_lines "${USER_ERRORS}")"
ITEM_ERROR_COUNT="$(count_non_empty_lines "${ITEM_ERRORS}")"
USER_COUNT="$(count_non_empty_lines "${NORMALIZED_USERS}")"
ROLE_COUNT="$(count_non_empty_lines "${NORMALIZED_ROLES}")"
ITEM_COUNT="$(count_non_empty_lines "${NORMALIZED_ITEMS}")"
ASSIGNMENT_COUNT="$(count_non_empty_lines "${NORMALIZED_ASSIGNMENTS}")"
ROLE_QUEUE_COUNT="$(count_non_empty_lines "${ROLE_RESOLUTION_QUEUE}")"

log "Building compact semantic and relational summary"

jq -n \
  --slurpfile normalized_users "${NORMALIZED_USERS}" \
  --slurpfile normalized_roles "${NORMALIZED_ROLES}" \
  --slurpfile normalized_items "${NORMALIZED_ITEMS}" \
  --slurpfile normalized_assignments "${NORMALIZED_ASSIGNMENTS}" \
  --arg run_id "${RUN_ID}" \
  --arg generated_at "${GENERATED_AT}" \
  --arg environment "${ENVIRONMENT}" \
  --arg app_id "${APPLICATION_ID}" \
  --arg app_name "${APPLICATION_NAME}" \
  --arg process_id "${PROCESS_ID}" \
  --arg process_name "${PROCESS_NAME}" \
  --argjson user_error_count "${USER_ERROR_COUNT}" \
  --argjson item_error_count "${ITEM_ERROR_COUNT}" '
  {
    generated_at: $generated_at,
    snapshot_run_id: $run_id,
    environment: $environment,

    source_health: {
      user_detail_records: ($normalized_users | length),
      item_detail_records: ($normalized_items | length),
      user_detail_errors: $user_error_count,
      item_detail_errors: $item_error_count,
      complete_without_detail_errors: ($user_error_count == 0 and $item_error_count == 0)
    },

    canonical_business_truth: {
      application: { application_id: $app_id, application_name: $app_name },
      process: { process_id: $process_id, process_name: $process_name },
      user_system_of_truth: "Kissflow User Management",
      process_item_system_of_truth: "Kissflow Live IT Service Request",
      operational_reporting_store: "PostgreSQL (Cloud SQL)",
      analytics_store: "BigQuery"
    },

    user_management: {
      normalized_user_count: ($normalized_users | length),
      last_sign_in_field: "LastLoggedInAt.v",
      never_logged_in_count:
        ([$normalized_users[] | select(.ever_logged_in == false)] | length)
    },

    assignment_semantics: {
      source_field_path: "_current_assigned_to",
      cardinality: "PROCESS_ITEM 1:N ASSIGNMENT_PRINCIPAL",
      principal_types: ([$normalized_assignments[].principal_kind] | unique | sort),
      distinct_role_count: ($normalized_roles | length),
      distinct_roles: [$normalized_roles[] | {role_id, role_name}],
      assignment_counts_by_principal:
        (
          $normalized_assignments
          | group_by(.principal_kind, .principal_id)
          | map({
              principal_id: .[0].principal_id,
              principal_name: .[0].principal_name,
              principal_kind: .[0].principal_kind,
              assigned_item_count: length
            })
          | sort_by(-.assigned_item_count, .principal_name)
        )
    },

    process_lifecycle: {
      lifecycle_status: {
        field_path: "_status",
        observed_values: ([$normalized_items[].process_status] | unique | sort),
        pending_values: ["InProgress"],
        completed_values: ["Completed"],
        withdrawn_values: ["Withdrawn"],
        withdrawn_handling: "TRACKED_AS_SEPARATE_BUCKET"
      }
    },

    unresolved_dependencies: [
      {
        dependency: "Kissflow Application Role Membership API",
        reason: "_current_assigned_to contains AppRole principal(s) (IT Agents Refex) whose member users are not present in process-item payloads",
        blocking: true,
        affected_outputs: [
          "Accurate assigned-user counts",
          "Pending workload by user",
          "User adoption ratio"
        ],
        recovery: "Resolve role_id RoDiFnpbtj4u via Role Membership API, store members with snapshot timestamps"
      }
    ],

    configuration_recommendation: {
      assignee_field_id: "_current_assigned_to",
      status_field_id: "_status",
      pending_status_values: ["InProgress"],
      completed_status_values: ["Completed"],
      withdrawn_status_values: ["Withdrawn"],
      last_sign_in_field_id: "LastLoggedInAt.v",
      user_status_field_id: "Status",
      assigned_user_source: "DIRECT USER ASSIGNMENT UNION ROLE-MEMBER EXPANSION"
    }
  }
' > "${SUMMARY_JSON}"

cat > "${NORMALIZED_MANIFEST}" <<JSON
{
  "snapshot_run_id": "${RUN_ID}",
  "generated_at": "${GENERATED_AT}",
  "environment": "${ENVIRONMENT}",
  "application_id": "${APPLICATION_ID}",
  "process_id": "${PROCESS_ID}",
  "counts": {
    "users": ${USER_COUNT},
    "roles": ${ROLE_COUNT},
    "items": ${ITEM_COUNT},
    "assignments": ${ASSIGNMENT_COUNT},
    "roles_pending_membership_resolution": ${ROLE_QUEUE_COUNT},
    "user_detail_errors": ${USER_ERROR_COUNT},
    "item_detail_errors": ${ITEM_ERROR_COUNT}
  },
  "artifacts": {
    "users": "data/discovery/normalized/kissflow-users.jsonl",
    "roles": "data/discovery/normalized/kissflow-app-roles.jsonl",
    "items": "data/discovery/normalized/kissflow-process-items.jsonl",
    "assignments": "data/discovery/normalized/kissflow-item-assignments.jsonl",
    "role_membership_resolution_queue": "data/discovery/normalized/role-membership-resolution-queue.jsonl",
    "semantic_summary": "data/discovery/inspection/compact-semantic-summary.json"
  },
  "load_status": "NOT_LOADED_TO_POSTGRESQL",
  "role_membership_status": "PENDING_ROLE_MEMBER_API"
}
JSON

{
  printf 'REFEX USER ENGAGEMENT REPORT — COMPACT RELATIONAL SEMANTIC SUMMARY\n'
  printf 'Generated at: %s\n' "${GENERATED_AT}"
  printf 'Snapshot run: %s\n\n' "${RUN_ID}"

  printf '===== SOURCE HEALTH =====\n'
  jq '.source_health' "${SUMMARY_JSON}"

  printf '\n===== USER MANAGEMENT =====\n'
  jq '.user_management' "${SUMMARY_JSON}"

  printf '\n===== ASSIGNMENT SEMANTICS =====\n'
  jq '.assignment_semantics' "${SUMMARY_JSON}"

  printf '\n===== PROCESS LIFECYCLE =====\n'
  jq '.process_lifecycle' "${SUMMARY_JSON}"

  printf '\n===== UNRESOLVED DEPENDENCIES =====\n'
  jq '.unresolved_dependencies' "${SUMMARY_JSON}"

  printf '\n===== PROJECT CONFIG RECOMMENDATION =====\n'
  jq '.configuration_recommendation' "${SUMMARY_JSON}"

  printf '\n===== NORMALIZED ARTIFACT COUNTS =====\n'
  jq '.counts' "${NORMALIZED_MANIFEST}"

} | tee "${SUMMARY_TEXT}"

log "Runbook 03 completed"

printf '\nNo PostgreSQL or BigQuery mutation was performed by this runbook.\n'
printf 'Role IT Agents Refex remains unresolved until its member-user API is called.\n'
