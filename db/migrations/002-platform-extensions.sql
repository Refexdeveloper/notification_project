BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Migration ledger (safe replay)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.schema_migration (
    migration_id     text PRIMARY KEY,
    applied_at       timestamptz NOT NULL DEFAULT now(),
    applied_by       text NOT NULL,
    checksum         text NOT NULL,
    duration_ms      integer,
    success          boolean NOT NULL DEFAULT true
);

-- ============================================================
-- Source configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.account (
    account_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name         text NOT NULL,
    kissflow_account_id  text NOT NULL UNIQUE,
    environment          text NOT NULL,
    is_active            boolean NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_reporting.credential_binding (
    credential_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            uuid NOT NULL REFERENCES engagement_reporting.account(account_id),
    provider              text NOT NULL CHECK (provider IN ('KISSFLOW', 'SMTP', 'OAUTH')),
    secret_resource       text NOT NULL,
    secret_version        text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, provider)
);

-- ============================================================
-- Ingestion / sync (extends snapshot_run)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.sync_run (
    sync_run_id          text PRIMARY KEY,
    snapshot_run_id      text REFERENCES engagement_reporting.snapshot_run(snapshot_run_id),
    resource_type        text NOT NULL,
    sync_type            text NOT NULL CHECK (sync_type IN ('FULL', 'INCREMENTAL', 'RECONCILIATION')),
    idempotency_key      text NOT NULL UNIQUE,
    status               text NOT NULL,
    started_at           timestamptz,
    completed_at         timestamptz,
    expected_pages       integer,
    received_pages       integer,
    record_count         integer NOT NULL DEFAULT 0,
    correlation_id       text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_reporting.sync_page (
    sync_run_id    text NOT NULL REFERENCES engagement_reporting.sync_run(sync_run_id),
    page_number    integer NOT NULL,
    payload_hash   text NOT NULL,
    received_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sync_run_id, page_number)
);

CREATE TABLE IF NOT EXISTS engagement_reporting.sync_watermark (
    resource_key       text PRIMARY KEY,
    last_success_at    timestamptz,
    watermark_value    timestamptz,
    overlap_seconds    integer NOT NULL DEFAULT 300,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_reporting.dead_letter_event (
    dead_letter_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain               text NOT NULL,
    source_id            text NOT NULL,
    idempotency_key      text NOT NULL,
    failure_class        text NOT NULL,
    error_code           text,
    error_message        text,
    payload_hash         text NOT NULL,
    evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    replayed_at          timestamptz,
    UNIQUE (domain, idempotency_key)
);

CREATE TABLE IF NOT EXISTS engagement_reporting.replay_request (
    replay_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dead_letter_event_id uuid NOT NULL REFERENCES engagement_reporting.dead_letter_event(dead_letter_event_id),
    requested_by       text NOT NULL,
    requested_at       timestamptz NOT NULL DEFAULT now(),
    status             text NOT NULL DEFAULT 'PENDING',
    correlation_id     text NOT NULL
);

-- ============================================================
-- User activity (immutable events)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.user_activity_event (
    user_activity_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_user_id        text NOT NULL,
    event_type             text NOT NULL,
    application_id         text,
    process_id             text,
    item_id                text,
    source_event_id        text,
    occurred_at            timestamptz NOT NULL,
    observed_at            timestamptz NOT NULL DEFAULT now(),
    sync_run_id            text REFERENCES engagement_reporting.sync_run(sync_run_id),
    idempotency_key        text NOT NULL,
    payload_hash           text NOT NULL,
    evidence               jsonb NOT NULL DEFAULT '{}'::jsonb,
    completeness           text NOT NULL DEFAULT 'COMPLETE',
    UNIQUE (idempotency_key)
);

-- ============================================================
-- Report configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.report_definition (
    report_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id           uuid NOT NULL REFERENCES engagement_reporting.account(account_id),
    name                 text NOT NULL,
    is_active            boolean NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_reporting.report_definition_version (
    report_definition_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_definition_id         uuid NOT NULL REFERENCES engagement_reporting.report_definition(report_definition_id),
    version_number               integer NOT NULL,
    config                       jsonb NOT NULL DEFAULT '{}'::jsonb,
    frozen_at                    timestamptz,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report_definition_id, version_number)
);

CREATE TABLE IF NOT EXISTS engagement_reporting.report_template (
    report_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_reporting.report_template_version (
    report_template_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_template_id         uuid NOT NULL REFERENCES engagement_reporting.report_template(report_template_id),
    version_number             integer NOT NULL,
    content_ref                text NOT NULL,
    checksum                   text NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report_template_id, version_number)
);

CREATE TABLE IF NOT EXISTS engagement_reporting.report_schedule (
    report_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_definition_version_id uuid NOT NULL REFERENCES engagement_reporting.report_definition_version(report_definition_version_id),
    cron_expression    text NOT NULL,
    timezone           text NOT NULL DEFAULT 'Asia/Kolkata',
    is_active          boolean NOT NULL DEFAULT false,
    idempotency_scope  text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_reporting.report_recipient (
    report_schedule_id uuid NOT NULL REFERENCES engagement_reporting.report_schedule(report_schedule_id),
    recipient_email    citext NOT NULL,
    recipient_type     text NOT NULL CHECK (recipient_type IN ('TO', 'CC', 'BCC', 'MANAGER_OF_USER')),
    PRIMARY KEY (report_schedule_id, recipient_email, recipient_type)
);

-- Extend report_run with idempotency
ALTER TABLE engagement_reporting.report_run
    ADD COLUMN IF NOT EXISTS idempotency_key text,
    ADD COLUMN IF NOT EXISTS report_definition_version_id uuid,
    ADD COLUMN IF NOT EXISTS period_start timestamptz,
    ADD COLUMN IF NOT EXISTS period_end timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS report_run_idempotency_uidx
    ON engagement_reporting.report_run (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- Notification outbox + delivery ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.notification_outbox (
    outbox_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_run_id        text NOT NULL REFERENCES engagement_reporting.report_run(report_run_id),
    artifact_id          text NOT NULL,
    delivery_channel     text NOT NULL DEFAULT 'EMAIL',
    idempotency_key      text NOT NULL UNIQUE,
    status               text NOT NULL DEFAULT 'PENDING',
    claim_token          text,
    claimed_at           timestamptz,
    attempt_count        integer NOT NULL DEFAULT 0,
    next_attempt_at      timestamptz,
    correlation_id       text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT outbox_status_chk CHECK (
        status IN ('PENDING','CLAIMED','PUBLISHED','PROCESSING','COMPLETED',
                   'RETRY_SCHEDULED','DEAD_LETTERED','CANCELLED')
    )
);

CREATE TABLE IF NOT EXISTS engagement_reporting.delivery_attempt (
    delivery_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id           uuid NOT NULL REFERENCES engagement_reporting.notification_outbox(outbox_id),
    recipient_email     citext NOT NULL,
    status              text NOT NULL,
    provider_message_id text,
    attempted_at        timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    error_code          text,
    error_message       text,
    UNIQUE (outbox_id, recipient_email, attempted_at)
);

CREATE TABLE IF NOT EXISTS engagement_reporting.rendered_artifact (
    rendered_artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_run_id        text NOT NULL REFERENCES engagement_reporting.report_run(report_run_id),
    template_version_id  uuid REFERENCES engagement_reporting.report_template_version(report_template_version_id),
    content_hash         text NOT NULL,
    content_type         text NOT NULL DEFAULT 'text/html',
    byte_size            bigint NOT NULL,
    gcs_uri              text NOT NULL,
    renderer_version     text NOT NULL,
    rendered_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report_run_id, content_hash, renderer_version)
);

-- ============================================================
-- Admin identity (corporate auth — no password hashes)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_reporting.admin_user (
    admin_user_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_subject text NOT NULL UNIQUE,
    email           citext NOT NULL UNIQUE,
    display_name    text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_reporting.admin_role (
    admin_role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL UNIQUE CHECK (name IN ('ADMIN','OPERATOR','VIEWER','AUDITOR'))
);

CREATE TABLE IF NOT EXISTS engagement_reporting.admin_user_role (
    admin_user_id uuid NOT NULL REFERENCES engagement_reporting.admin_user(admin_user_id),
    admin_role_id uuid NOT NULL REFERENCES engagement_reporting.admin_role(admin_role_id),
    granted_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (admin_user_id, admin_role_id)
);

CREATE TABLE IF NOT EXISTS engagement_reporting.audit_event (
    audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_subject  text NOT NULL,
    action         text NOT NULL,
    resource_type  text NOT NULL,
    resource_id    text,
    correlation_id text NOT NULL,
    evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO engagement_reporting.schema_migration (migration_id, applied_by, checksum)
VALUES ('002-platform-extensions', 'migrator', 'pending-runtime-checksum')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
