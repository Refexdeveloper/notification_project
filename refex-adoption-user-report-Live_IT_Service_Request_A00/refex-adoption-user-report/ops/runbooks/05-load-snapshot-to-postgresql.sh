#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="/c/Users/Mohamed Aasik IlahiM/refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report"
NORMALIZED_DIR="${REPO_ROOT}/data/discovery/normalized"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-05"

PGHOST="localhost"
PGPORT="5432"
PGDATABASE="engagement_reporting"
PGUSER="postgres"

ENVIRONMENT="development"
APPLICATION_ID="IT_Service_Management_A00"
APPLICATION_NAME="IT Service Management"
PROCESS_ID="Live_IT_Service_Request_A00"
PROCESS_NAME="Live IT Service Request"

USERS_FILE="${NORMALIZED_DIR}/kissflow-users.jsonl"
ROLES_FILE="${NORMALIZED_DIR}/kissflow-app-roles.jsonl"
ITEMS_FILE="${NORMALIZED_DIR}/kissflow-process-items.jsonl"
ASSIGNMENTS_FILE="${NORMALIZED_DIR}/kissflow-item-assignments.jsonl"
MANIFEST_FILE="${NORMALIZED_DIR}/normalized-manifest.json"

GENERATED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
AUDIT_FILE="${AUDIT_DIR}/runbook-05-$(date -u +'%Y%m%dT%H%M%SZ').json"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."

for f in "${USERS_FILE}" "${ROLES_FILE}" "${ITEMS_FILE}" "${ASSIGNMENTS_FILE}" "${MANIFEST_FILE}"; do
  [[ -f "${f}" ]] || stop "Required Runbook 03 artifact missing: ${f}"
done

mkdir -p "${AUDIT_DIR}"

SNAPSHOT_RUN_ID="$(jq -r '.snapshot_run_id' "${MANIFEST_FILE}")"
USER_COUNT="$(jq -r '.counts.users' "${MANIFEST_FILE}")"
ROLE_COUNT="$(jq -r '.counts.roles' "${MANIFEST_FILE}")"
ITEM_COUNT="$(jq -r '.counts.items' "${MANIFEST_FILE}")"
ASSIGNMENT_COUNT="$(jq -r '.counts.assignments' "${MANIFEST_FILE}")"

log "Loading snapshot ${SNAPSHOT_RUN_ID} into PostgreSQL"

run_sql() {
  psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}"
}

# Build one transactional SQL script into a temp file, then pipe it in once.
SQL_FILE="$(mktemp)"
trap 'rm -f "${SQL_FILE}"' EXIT

{
  echo "BEGIN;"

  # 1. snapshot_run
  echo "INSERT INTO engagement_reporting.snapshot_run
    (snapshot_run_id, source_system, environment, application_id, process_id,
     extraction_started_at, extraction_completed_at, load_started_at, status,
     user_record_count, role_record_count, item_record_count, assignment_record_count,
     unresolved_role_count, source_manifest)
  VALUES
    ('${SNAPSHOT_RUN_ID}', 'KISSFLOW', '${ENVIRONMENT}', '${APPLICATION_ID}', '${PROCESS_ID}',
     now(), now(), now(), 'IN_PROGRESS',
     ${USER_COUNT}, ${ROLE_COUNT}, ${ITEM_COUNT}, ${ASSIGNMENT_COUNT},
     ${ROLE_COUNT}, '$(jq -c . "${MANIFEST_FILE}" | sed "s/'/''/g")')
  ON CONFLICT (snapshot_run_id) DO NOTHING;"

  # 2. application
  echo "INSERT INTO engagement_reporting.application
    (environment, application_id, application_name, first_seen_at, last_seen_at, is_current, source_payload)
  VALUES
    ('${ENVIRONMENT}', '${APPLICATION_ID}', '${APPLICATION_NAME}', now(), now(), true, '{}')
  ON CONFLICT (environment, application_id) DO UPDATE SET last_seen_at = now();"

  # 3. process
  echo "INSERT INTO engagement_reporting.process
    (environment, process_id, application_id, process_name, first_seen_at, last_seen_at, is_current, source_payload)
  VALUES
    ('${ENVIRONMENT}', '${PROCESS_ID}', '${APPLICATION_ID}', '${PROCESS_NAME}', now(), now(), true, '{}')
  ON CONFLICT (environment, process_id) DO UPDATE SET last_seen_at = now();"

  # 4. user rows
  jq -r --arg env "${ENVIRONMENT}" '
    [.user_id, .snapshot_at, .user_name, .email, .user_type, .active_status,
     .last_sign_in, .ever_logged_in, (.source_payload | tostring)] |
    @tsv
  ' "${USERS_FILE}" | while IFS=$'\t' read -r user_id snapshot_at user_name email user_type active_status last_sign_in ever_logged_in payload; do
    esc() { printf '%s' "$1" | sed "s/'/''/g"; }
    ls_sql="NULL"
    [[ "${last_sign_in}" != "null" && -n "${last_sign_in}" ]] && ls_sql="'$(esc "${last_sign_in}")'"
    echo "INSERT INTO engagement_reporting.\"user\"
      (environment, user_id, snapshot_at, snapshot_run_id, user_name, email, user_type,
       active_status, last_sign_in, ever_logged_in, source_payload, row_hash)
    VALUES
      ('${ENVIRONMENT}', '$(esc "${user_id}")', '$(esc "${snapshot_at}")', '${SNAPSHOT_RUN_ID}',
       '$(esc "${user_name}")', '$(esc "${email}")', '$(esc "${user_type}")', '$(esc "${active_status}")',
       ${ls_sql}, ${ever_logged_in}, '$(esc "${payload}")',
       md5('$(esc "${payload}")'))
    ON CONFLICT (environment, user_id, snapshot_at) DO NOTHING;

    INSERT INTO engagement_reporting.principal
      (environment, application_id, principal_id, principal_type, principal_name, first_seen_at, last_seen_at, is_current, source_payload)
    VALUES
      ('${ENVIRONMENT}', '${APPLICATION_ID}', '$(esc "${user_id}")', 'USER', '$(esc "${user_name}")', now(), now(), true, '{}')
    ON CONFLICT (environment, application_id, principal_id, principal_type) DO UPDATE SET last_seen_at = now();

    INSERT INTO engagement_reporting.principal_user
      (environment, application_id, principal_id, principal_type, user_id, valid_from, snapshot_run_id, resolution_source, resolution_status)
    VALUES
      ('${ENVIRONMENT}', '${APPLICATION_ID}', '$(esc "${user_id}")', 'USER', '$(esc "${user_id}")', now(), '${SNAPSHOT_RUN_ID}', 'DIRECT_USER_SELF_MAP', 'RESOLVED')
    ON CONFLICT DO NOTHING;"
  done

  # 5. role principals (marked PENDING)
  jq -r '[.role_id, .role_name] | @tsv' "${ROLES_FILE}" | while IFS=$'\t' read -r role_id role_name; do
    esc() { printf '%s' "$1" | sed "s/'/''/g"; }
    echo "INSERT INTO engagement_reporting.principal
      (environment, application_id, principal_id, principal_type, principal_name, first_seen_at, last_seen_at, is_current, source_payload)
    VALUES
      ('${ENVIRONMENT}', '${APPLICATION_ID}', '$(esc "${role_id}")', 'APP_ROLE', '$(esc "${role_name}")', now(), now(), true, '{}')
    ON CONFLICT (environment, application_id, principal_id, principal_type) DO UPDATE SET last_seen_at = now();

    INSERT INTO engagement_reporting.role_membership_resolution
      (snapshot_run_id, environment, application_id, role_id, status, attempt_count)
    VALUES
      ('${SNAPSHOT_RUN_ID}', '${ENVIRONMENT}', '${APPLICATION_ID}', '$(esc "${role_id}")', 'PENDING', 0)
    ON CONFLICT (snapshot_run_id, environment, application_id, role_id) DO NOTHING;"
  done

  # 6. item rows
  jq -r '
    [.instance_id, .snapshot_at, .process_status, .current_step, .stage,
     (.request_number // "" | tostring), .request_id, .criticality, .entity, .requester_email,
     (.source_payload | tostring)] | @tsv
  ' "${ITEMS_FILE}" | while IFS=$'\t' read -r instance_id snapshot_at process_status current_step stage request_number request_id criticality entity requester_email payload; do
    esc() { printf '%s' "$1" | sed "s/'/''/g"; }
    rn_sql="NULL"
    [[ -n "${request_number}" ]] && rn_sql="${request_number}"
    echo "INSERT INTO engagement_reporting.item
      (environment, process_id, instance_id, snapshot_at, snapshot_run_id, process_status,
       current_step, stage, request_number, request_id, criticality, entity, requester_email,
       source_payload, row_hash)
    VALUES
      ('${ENVIRONMENT}', '${PROCESS_ID}', '$(esc "${instance_id}")', '$(esc "${snapshot_at}")', '${SNAPSHOT_RUN_ID}',
       '$(esc "${process_status}")', '$(esc "${current_step}")', '$(esc "${stage}")', ${rn_sql},
       '$(esc "${request_id}")', '$(esc "${criticality}")', '$(esc "${entity}")', '$(esc "${requester_email}")',
       '$(esc "${payload}")', md5('$(esc "${payload}")'))
    ON CONFLICT (environment, process_id, instance_id, snapshot_at) DO NOTHING;"
  done

  # 7. item_assignment rows
  jq -r '[.instance_id, .snapshot_at, .principal_id, .principal_kind, .assignment_source_field] | @tsv' "${ASSIGNMENTS_FILE}" | while IFS=$'\t' read -r instance_id snapshot_at principal_id principal_kind source_field; do
    esc() { printf '%s' "$1" | sed "s/'/''/g"; }
    echo "INSERT INTO engagement_reporting.item_assignment
      (environment, application_id, process_id, instance_id, snapshot_at, snapshot_run_id,
       principal_id, principal_type, assignment_source, source_payload)
    VALUES
      ('${ENVIRONMENT}', '${APPLICATION_ID}', '${PROCESS_ID}', '$(esc "${instance_id}")', '$(esc "${snapshot_at}")',
       '${SNAPSHOT_RUN_ID}', '$(esc "${principal_id}")', '$(esc "${principal_kind}")', '$(esc "${source_field}")', '{}')
    ON CONFLICT (environment, process_id, instance_id, snapshot_at, principal_id, principal_type) DO NOTHING;"
  done

  echo "UPDATE engagement_reporting.snapshot_run
    SET status = 'PARTIAL', load_completed_at = now(), updated_at = now()
    WHERE snapshot_run_id = '${SNAPSHOT_RUN_ID}';"

  echo "COMMIT;"
} > "${SQL_FILE}"

log "Executing generated load script (this may take a moment for 46 users + 208 items)"

cat "${SQL_FILE}" | run_sql

log "Load completed. snapshot_run marked PARTIAL (role membership still pending)."

jq -n \
  --arg generated_at "${GENERATED_AT}" \
  --arg snapshot_run_id "${SNAPSHOT_RUN_ID}" \
  --argjson users "${USER_COUNT}" \
  --argjson roles "${ROLE_COUNT}" \
  --argjson items "${ITEM_COUNT}" \
  --argjson assignments "${ASSIGNMENT_COUNT}" '
{
  generated_at: $generated_at,
  action: "LOAD_SNAPSHOT",
  snapshot_run_id: $snapshot_run_id,
  status: "PARTIAL",
  mutation_performed: true,
  counts: { users: $users, roles: $roles, items: $items, assignments: $assignments },
  role_membership_status: "PENDING",
  next_safe_action: "Resolve AppRole membership via Kissflow Application Role API (Runbook 06), then mark snapshot_run COMPLETED"
}
' > "${AUDIT_FILE}"

printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
printf '\nSnapshot run ID: %s\n' "${SNAPSHOT_RUN_ID}"
printf 'Status: PARTIAL (role membership resolution still pending)\n'
