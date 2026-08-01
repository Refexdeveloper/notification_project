#!/usr/bin/env bash
# Ensure report_html_cache exists (used by test-send cache load/store).
set -Eeuo pipefail

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

command -v psql >/dev/null 2>&1 || exit 0

psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS engagement_reporting.report_html_cache (
  cache_key      text PRIMARY KEY,
  application_id text NOT NULL,
  html           text NOT NULL,
  byte_size      bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_html_cache_app_updated_idx
  ON engagement_reporting.report_html_cache (application_id, updated_at DESC);
" >/dev/null 2>&1 || true
