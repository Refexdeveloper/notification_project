#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="/c/Users/Mohamed Aasik IlahiM/refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report"
DISCOVERY_DIR="${REPO_ROOT}/data/discovery"
NORMALIZED_DIR="${DISCOVERY_DIR}/normalized"
INSPECTION_DIR="${DISCOVERY_DIR}/inspection"

DB_DIR="${REPO_ROOT}/db"
MIGRATIONS_DIR="${DB_DIR}/migrations"
CONTRACTS_DIR="${DB_DIR}/contracts"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-04"

MIGRATION_FILE="${MIGRATIONS_DIR}/001-canonical-engagement-model.sql"
CONTRACT_FILE="${CONTRACTS_DIR}/canonical-load-contract.json"
AUDIT_FILE="${AUDIT_DIR}/runbook-04-$(date -u +'%Y%m%dT%H%M%SZ').json"
LATEST_AUDIT_FILE="${AUDIT_DIR}/runbook-04-latest.json"

NORMALIZED_MANIFEST="${NORMALIZED_DIR}/normalized-manifest.json"
SEMANTIC_SUMMARY="${INSPECTION_DIR}/compact-semantic-summary.json"

GENERATED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

log() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

stop() {
  printf '\nSTOP: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || stop "Required command is missing: $1"
}

require_command jq
require_command git
require_command sha256sum

[[ -d "${REPO_ROOT}" ]] || stop "Repository does not exist: ${REPO_ROOT}"
[[ -d "${REPO_ROOT}/.git" ]] || stop "Not a Git repository: ${REPO_ROOT}"

cd "${REPO_ROOT}"

for required_file in "${NORMALIZED_MANIFEST}" "${SEMANTIC_SUMMARY}"; do
  [[ -f "${required_file}" ]] || stop "Required Runbook 03 artifact is missing: ${required_file}"
done

jq empty "${NORMALIZED_MANIFEST}" || stop "Invalid JSON: ${NORMALIZED_MANIFEST}"
jq empty "${SEMANTIC_SUMMARY}" || stop "Invalid JSON: ${SEMANTIC_SUMMARY}"

ROLE_STATUS="$(jq -r '.role_membership_status' "${NORMALIZED_MANIFEST}")"
[[ "${ROLE_STATUS}" == "PENDING_ROLE_MEMBER_API" ]] ||
  stop "Unexpected role-membership status: ${ROLE_STATUS}"

mkdir -p "${MIGRATIONS_DIR}" "${CONTRACTS_DIR}" "${AUDIT_DIR}"

log "Generating canonical PostgreSQL migration"

cat > "${MIGRATION_FILE}" <<'SQL'
BEGIN;

CREATE SCHEMA IF NOT EXISTS engagement_reporting;

-- ============================================================
-- 1. snapshot_run — one row per ingestion run (immutable)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.snapshot_run (
    snapshot_run_id           text PRIMARY KEY,
    source_system             text NOT NULL DEFAULT 'KISSFLOW',
    environment                text NOT NULL,
    application_id             text NOT NULL,
    process_id                  text NOT NULL,
    extraction_started_at       timestamptz,
    extraction_completed_at     timestamptz,
    load_started_at             timestamptz,
    load_completed_at           timestamptz,
    status                      text NOT NULL,
    user_record_count           integer NOT NULL DEFAULT 0,
    role_record_count           integer NOT NULL DEFAULT 0,
    item_record_count           integer NOT NULL DEFAULT 0,
    assignment_record_count     integer NOT NULL DEFAULT 0,
    unresolved_role_count       integer NOT NULL DEFAULT 0,
    source_manifest             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT snapshot_run_status_chk CHECK (
        status IN ('PENDING','IN_PROGRESS','COMPLETED','PARTIAL','FAILED','RETRY_PENDING','REPLAYED','CANCELLED')
    )
);

-- ============================================================
-- 2. application
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.application (
    environment        text NOT NULL,
    application_id      text NOT NULL,
    application_name    text NOT NULL,
    first_seen_at        timestamptz NOT NULL,
    last_seen_at         timestamptz NOT NULL,
    is_current           boolean NOT NULL DEFAULT true,
    source_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (environment, application_id)
);

-- ============================================================
-- 3. process
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.process (
    environment        text NOT NULL,
    process_id          text NOT NULL,
    application_id      text NOT NULL,
    process_name         text NOT NULL,
    first_seen_at         timestamptz NOT NULL,
    last_seen_at          timestamptz NOT NULL,
    is_current            boolean NOT NULL DEFAULT true,
    source_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (environment, process_id),
    FOREIGN KEY (environment, application_id)
        REFERENCES engagement_reporting.application (environment, application_id)
);

-- ============================================================
-- 4. "user" (kissflow_user) — reserved word, quoted
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting."user" (
    environment          text NOT NULL,
    user_id                text NOT NULL,
    snapshot_at            timestamptz NOT NULL,
    snapshot_run_id        text NOT NULL,
    user_name              text,
    email                   text,
    user_type               text,
    active_status           text,
    last_sign_in            timestamptz,
    ever_logged_in          boolean NOT NULL DEFAULT false,
    manager_user_id         text,
    source_payload          jsonb NOT NULL,
    row_hash                text NOT NULL,
    PRIMARY KEY (environment, user_id, snapshot_at),
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_snapshot_hash_uidx
    ON engagement_reporting."user" (environment, user_id, snapshot_run_id, row_hash);

CREATE INDEX IF NOT EXISTS user_email_idx
    ON engagement_reporting."user" (environment, email);

CREATE INDEX IF NOT EXISTS user_last_sign_in_idx
    ON engagement_reporting."user" (environment, last_sign_in);

-- ============================================================
-- 5. principal — generalized assignee (USER or APP_ROLE)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.principal (
    environment         text NOT NULL,
    application_id       text NOT NULL,
    principal_id          text NOT NULL,
    principal_type         text NOT NULL,
    principal_name          text,
    first_seen_at            timestamptz NOT NULL,
    last_seen_at             timestamptz NOT NULL,
    is_current               boolean NOT NULL DEFAULT true,
    source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (environment, application_id, principal_id, principal_type),
    FOREIGN KEY (environment, application_id)
        REFERENCES engagement_reporting.application (environment, application_id),
    CONSTRAINT principal_type_chk CHECK (principal_type IN ('USER', 'APP_ROLE'))
);

-- ============================================================
-- 6. principal_user — resolves any principal to real users
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.principal_user (
    environment         text NOT NULL,
    application_id       text NOT NULL,
    principal_id          text NOT NULL,
    principal_type         text NOT NULL,
    user_id                text NOT NULL,
    valid_from              timestamptz NOT NULL,
    valid_to                timestamptz,
    snapshot_run_id         text NOT NULL,
    resolution_source       text NOT NULL,
    resolution_status       text NOT NULL,
    source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (environment, application_id, principal_id, principal_type, user_id, valid_from),
    FOREIGN KEY (environment, application_id, principal_id, principal_type)
        REFERENCES engagement_reporting.principal (environment, application_id, principal_id, principal_type),
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id),
    CONSTRAINT principal_user_status_chk CHECK (
        resolution_status IN ('RESOLVED','PENDING','FAILED','STALE')
    ),
    CONSTRAINT principal_user_validity_chk CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS principal_user_current_uidx
    ON engagement_reporting.principal_user (environment, application_id, principal_id, principal_type, user_id)
    WHERE valid_to IS NULL;

-- ============================================================
-- 7. item (kissflow_process_item)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.item (
    environment         text NOT NULL,
    process_id            text NOT NULL,
    instance_id            text NOT NULL,
    snapshot_at            timestamptz NOT NULL,
    snapshot_run_id         text NOT NULL,
    process_status           text,
    current_step              text,
    stage                      text,
    request_number             integer,
    request_id                  text,
    criticality                  text,
    entity                        text,
    requester_email                text,
    source_payload                 jsonb NOT NULL,
    row_hash                       text NOT NULL,
    PRIMARY KEY (environment, process_id, instance_id, snapshot_at),
    FOREIGN KEY (environment, process_id)
        REFERENCES engagement_reporting.process (environment, process_id),
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id),
    CONSTRAINT item_status_chk CHECK (
        process_status IN ('InProgress', 'Completed', 'Withdrawn') OR process_status IS NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS item_snapshot_hash_uidx
    ON engagement_reporting.item (environment, process_id, instance_id, snapshot_run_id, row_hash);

CREATE INDEX IF NOT EXISTS item_status_idx
    ON engagement_reporting.item (environment, process_id, process_status, snapshot_at);

-- ============================================================
-- 8. item_field — EAV extension for arbitrary business fields
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.item_field (
    environment         text NOT NULL,
    instance_id            text NOT NULL,
    field_id                text NOT NULL,
    field_name               text,
    field_type                 text NOT NULL,
    value_text                   text,
    value_number                  numeric,
    value_boolean                   boolean,
    value_timestamp                   timestamptz,
    value_json                          jsonb,
    snapshot_at                          timestamptz NOT NULL,
    snapshot_run_id                       text NOT NULL,
    PRIMARY KEY (environment, instance_id, field_id, snapshot_at),
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id),
    CONSTRAINT item_field_type_chk CHECK (
        field_type IN ('text','number','boolean','timestamp','json')
    )
);

CREATE INDEX IF NOT EXISTS item_field_lookup_idx
    ON engagement_reporting.item_field (environment, field_id, snapshot_at);

-- ============================================================
-- 9. item_child_row — Kissflow "Table::<table_id>" child tables
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.item_child_row (
    environment         text NOT NULL,
    instance_id            text NOT NULL,
    table_id                 text NOT NULL,
    child_row_id                text NOT NULL,
    snapshot_at                   timestamptz NOT NULL,
    snapshot_run_id                 text NOT NULL,
    source_payload                    jsonb NOT NULL,
    PRIMARY KEY (environment, instance_id, table_id, child_row_id, snapshot_at),
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id)
);

-- ============================================================
-- 10. item_child_field — EAV for child-row fields
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.item_child_field (
    environment         text NOT NULL,
    instance_id            text NOT NULL,
    table_id                 text NOT NULL,
    child_row_id                text NOT NULL,
    field_id                      text NOT NULL,
    field_name                      text,
    field_type                        text NOT NULL,
    value_text                          text,
    value_number                          numeric,
    value_boolean                           boolean,
    value_timestamp                           timestamptz,
    value_json                                  jsonb,
    snapshot_at                                   timestamptz NOT NULL,
    PRIMARY KEY (environment, instance_id, table_id, child_row_id, field_id, snapshot_at),
    CONSTRAINT item_child_field_type_chk CHECK (
        field_type IN ('text','number','boolean','timestamp','json')
    )
);

-- ============================================================
-- 11. item_assignment — polymorphic bridge
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.item_assignment (
    environment         text NOT NULL,
    application_id        text NOT NULL,
    process_id               text NOT NULL,
    instance_id                text NOT NULL,
    snapshot_at                  timestamptz NOT NULL,
    snapshot_run_id                text NOT NULL,
    principal_id                     text NOT NULL,
    principal_type                     text NOT NULL,
    assignment_source                    text NOT NULL,
    source_payload                         jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (environment, process_id, instance_id, snapshot_at, principal_id, principal_type),
    FOREIGN KEY (environment, application_id, principal_id, principal_type)
        REFERENCES engagement_reporting.principal (environment, application_id, principal_id, principal_type),
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id),
    CONSTRAINT item_assignment_type_chk CHECK (principal_type IN ('USER', 'APP_ROLE'))
);

CREATE INDEX IF NOT EXISTS item_assignment_principal_idx
    ON engagement_reporting.item_assignment (environment, application_id, principal_type, principal_id, snapshot_at);

-- ============================================================
-- 12. role_membership_resolution
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.role_membership_resolution (
    snapshot_run_id      text NOT NULL,
    environment            text NOT NULL,
    application_id           text NOT NULL,
    role_id                    text NOT NULL,
    status                       text NOT NULL,
    attempt_count                  integer NOT NULL DEFAULT 0,
    last_attempt_at                  timestamptz,
    resolved_at                        timestamptz,
    member_count                         integer,
    last_error_code                        text,
    last_error_message                       text,
    evidence_payload                           jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (snapshot_run_id, environment, application_id, role_id),
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id),
    CONSTRAINT role_resolution_status_chk CHECK (
        status IN ('PENDING','IN_PROGRESS','RESOLVED','FAILED','STALE')
    )
);

-- ============================================================
-- 13. report_run — one row per scheduled report attempt
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.report_run (
    report_run_id        text PRIMARY KEY,
    snapshot_run_id         text NOT NULL,
    environment                text NOT NULL,
    application_id               text NOT NULL,
    process_id                     text NOT NULL,
    scheduled_at                     timestamptz NOT NULL,
    started_at                         timestamptz,
    completed_at                         timestamptz,
    status                                 text NOT NULL,
    error_message                            text,
    FOREIGN KEY (snapshot_run_id)
        REFERENCES engagement_reporting.snapshot_run (snapshot_run_id),
    CONSTRAINT report_run_status_chk CHECK (
        status IN ('PENDING','IN_PROGRESS','COMPLETED','PARTIAL','FAILED','RETRY_PENDING','REPLAYED','CANCELLED')
    )
);

-- ============================================================
-- 14. report_dataset — computed metrics per report_run
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.report_dataset (
    report_run_id         text NOT NULL,
    user_id                  text NOT NULL,
    environment                 text NOT NULL,
    user_name                     text,
    manager_email                   text,
    last_sign_in                      timestamptz,
    ever_logged_in                      boolean NOT NULL DEFAULT false,
    assigned_item_count                   integer NOT NULL DEFAULT 0,
    pending_item_count                      integer NOT NULL DEFAULT 0,
    completed_item_count                      integer NOT NULL DEFAULT 0,
    withdrawn_item_count                        integer NOT NULL DEFAULT 0,
    pending_ratio                                 numeric,
    PRIMARY KEY (report_run_id, user_id),
    FOREIGN KEY (report_run_id)
        REFERENCES engagement_reporting.report_run (report_run_id)
);

-- ============================================================
-- 15. report_render — generated HTML content per run
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.report_render (
    report_run_id          text PRIMARY KEY,
    rendered_at               timestamptz NOT NULL,
    subject                     text NOT NULL,
    html_body                     text NOT NULL,
    render_checksum                  text NOT NULL,
    FOREIGN KEY (report_run_id)
        REFERENCES engagement_reporting.report_run (report_run_id)
);

-- ============================================================
-- 16. report_delivery — send status, one row per recipient
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.report_delivery (
    report_run_id           text NOT NULL,
    recipient_email            text NOT NULL,
    delivery_status               text NOT NULL,
    attempted_at                    timestamptz NOT NULL,
    delivered_at                      timestamptz,
    error_message                       text,
    PRIMARY KEY (report_run_id, recipient_email),
    FOREIGN KEY (report_run_id)
        REFERENCES engagement_reporting.report_run (report_run_id),
    CONSTRAINT report_delivery_status_chk CHECK (
        delivery_status IN ('PENDING','SENT','FAILED','RETRY_PENDING')
    )
);

-- ============================================================
-- Views
-- ============================================================
CREATE OR REPLACE VIEW engagement_reporting.vw_effective_item_user_assignment AS
SELECT
    ia.environment, ia.application_id, ia.process_id, ia.instance_id,
    ia.snapshot_at, ia.snapshot_run_id, ia.principal_id, ia.principal_type,
    pu.user_id, pu.resolution_source, pu.resolution_status
FROM engagement_reporting.item_assignment ia
JOIN engagement_reporting.principal_user pu
  ON pu.environment = ia.environment
 AND pu.application_id = ia.application_id
 AND pu.principal_id = ia.principal_id
 AND pu.principal_type = ia.principal_type
 AND pu.valid_from <= ia.snapshot_at
 AND (pu.valid_to IS NULL OR pu.valid_to > ia.snapshot_at)
WHERE pu.resolution_status = 'RESOLVED';

CREATE OR REPLACE VIEW engagement_reporting.vw_unresolved_item_assignment AS
SELECT ia.*
FROM engagement_reporting.item_assignment ia
LEFT JOIN engagement_reporting.principal_user pu
  ON pu.environment = ia.environment
 AND pu.application_id = ia.application_id
 AND pu.principal_id = ia.principal_id
 AND pu.principal_type = ia.principal_type
 AND pu.valid_from <= ia.snapshot_at
 AND (pu.valid_to IS NULL OR pu.valid_to > ia.snapshot_at)
 AND pu.resolution_status = 'RESOLVED'
WHERE pu.user_id IS NULL;

COMMIT;
SQL

log "Generating deterministic load contract"

jq -n \
  --arg generated_at "${GENERATED_AT}" \
  --slurpfile manifest "${NORMALIZED_MANIFEST}" \
  --slurpfile semantic "${SEMANTIC_SUMMARY}" '
{
  generated_at: $generated_at,
  contract_version: "1.0.0",
  schema: "engagement_reporting",

  canonical_truth: {
    kissflow_user_management: "system_of_record_for_users",
    kissflow_live_it_service_request: "system_of_record_for_process_items",
    postgresql_cloud_sql: "canonical_operational_reporting_store",
    bigquery: "derived_analytics_store"
  },

  load_order: [
    "snapshot_run","application","process","user",
    "principal","principal_user_direct_users",
    "item","item_field","item_child_row","item_child_field",
    "item_assignment","role_membership_resolution"
  ],

  idempotency: {
    snapshot_identity: "snapshot_run_id",
    immutable_source_artifacts: true,
    duplicate_policy: "upsert_or_no_op_on_identical_row_hash",
    replay_policy: "safe_when_same_snapshot_run_id_and_source_hashes_are_reused"
  },

  role_assignment_policy: {
    direct_user: "Create USER principal and one self-mapping principal_user row",
    app_role: "Create APP_ROLE principal and PENDING role_membership_resolution row",
    analytics_visibility: "Exclude unresolved role assignments from effective user metrics; expose via vw_unresolved_item_assignment"
  },

  failure_policy: {
    partial_load: "Mark snapshot_run PARTIAL and retain successfully committed stages",
    failed_role_resolution: "Do not infer members; retain FAILED resolution evidence and retry later",
    duplicate_execution: "Use primary keys, row hashes and snapshot_run_id to prevent duplicate facts"
  },

  source_manifest: $manifest[0],
  discovered_semantics: {
    assignment: $semantic[0].assignment_semantics,
    lifecycle: $semantic[0].process_lifecycle,
    unresolved_dependencies: $semantic[0].unresolved_dependencies
  }
}
' > "${CONTRACT_FILE}"

MIGRATION_SHA256="$(sha256sum "${MIGRATION_FILE}" | awk '{print $1}')"
CONTRACT_SHA256="$(sha256sum "${CONTRACT_FILE}" | awk '{print $1}')"

jq -n \
  --arg generated_at "${GENERATED_AT}" \
  --arg migration "${MIGRATION_FILE}" \
  --arg migration_sha256 "${MIGRATION_SHA256}" \
  --arg contract "${CONTRACT_FILE}" \
  --arg contract_sha256 "${CONTRACT_SHA256}" '
{
  generated_at: $generated_at,
  status: "CANONICAL_MODEL_ARTIFACTS_GENERATED",
  database_mutation_performed: false,
  artifacts: {
    migration: { path: $migration, sha256: $migration_sha256 },
    load_contract: { path: $contract, sha256: $contract_sha256 }
  },
  next_safe_action: "Provision Cloud SQL PostgreSQL instance, then apply the migration and load one snapshot transactionally."
}
' > "${AUDIT_FILE}"

cp "${AUDIT_FILE}" "${LATEST_AUDIT_FILE}"

log "Runbook 04 completed"

printf '\nGenerated migration:\n%s\n' "${MIGRATION_FILE}"
printf '\nGenerated load contract:\n%s\n' "${CONTRACT_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
printf '\nNo PostgreSQL mutation was performed. No Cloud SQL instance was contacted.\n'
