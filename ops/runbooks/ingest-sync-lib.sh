#!/usr/bin/env bash
# Shared ingest guards + sync_watermark helpers for Kissflow pipeline runbooks.
set -Eeuo pipefail

INGEST_PG_CONN="${INGEST_PG_CONN:-host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE:-engagement_reporting} user=${PGUSER:-postgres}}"
INGEST_STALE_MINUTES="${INGEST_STALE_MINUTES:-45}"
INGEST_WAIT_MAX_SECONDS="${INGEST_WAIT_MAX_SECONDS:-300}"
WATERMARK_OVERLAP_SECONDS="${WATERMARK_OVERLAP_SECONDS:-300}"

ingest_log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

ingest_sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

ingest_psql() {
  psql "${INGEST_PG_CONN}" -v ON_ERROR_STOP=1 "$@"
}

ingest_resource_key() {
  local resource_type="${1:-items}"
  echo "${ENVIRONMENT:-production}:${APPLICATION_ID:-}:${PROCESS_ID:-}:${resource_type}"
}

ingest_ensure_sync_tables() {
  ingest_psql -c "
CREATE TABLE IF NOT EXISTS engagement_reporting.sync_watermark (
  resource_key       text PRIMARY KEY,
  last_success_at    timestamptz,
  watermark_value    timestamptz,
  overlap_seconds    integer NOT NULL DEFAULT 300,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
" >/dev/null 2>&1 || true
}

ingest_get_watermark_iso() {
  local resource_key="$1"
  ingest_ensure_sync_tables
  ingest_psql -t -A -c "
SELECT COALESCE(last_success_at::text, '')
FROM engagement_reporting.sync_watermark
WHERE resource_key = '$(ingest_sql_escape "${resource_key}")'
LIMIT 1;
" | tr -d '[:space:]'
}

ingest_set_watermark_now() {
  local resource_key="$1"
  local now_iso="${2:-$(date -u +'%Y-%m-%dT%H:%M:%SZ')}"
  ingest_ensure_sync_tables
  ingest_psql -c "
INSERT INTO engagement_reporting.sync_watermark (resource_key, last_success_at, watermark_value, overlap_seconds)
VALUES (
  '$(ingest_sql_escape "${resource_key}")',
  '${now_iso}'::timestamptz,
  '${now_iso}'::timestamptz,
  ${WATERMARK_OVERLAP_SECONDS}
)
ON CONFLICT (resource_key) DO UPDATE SET
  last_success_at = EXCLUDED.last_success_at,
  watermark_value = EXCLUDED.watermark_value,
  updated_at = now();
" >/dev/null
}

# Block or wait when another snapshot ingest is IN_PROGRESS for the same app/process.
ingest_wait_for_snapshot_slot() {
  local env="$1"
  local app_id="$2"
  local process_id="$3"
  local waited=0

  while true; do
    local row
    row="$(ingest_psql -t -A -F $'\t' -c "
SELECT snapshot_run_id, status, COALESCE(extraction_started_at, created_at)::text
FROM engagement_reporting.snapshot_run
WHERE environment = '$(ingest_sql_escape "${env}")'
  AND application_id = '$(ingest_sql_escape "${app_id}")'
  AND process_id = '$(ingest_sql_escape "${process_id}")'
  AND status IN ('IN_PROGRESS', 'PENDING')
ORDER BY created_at DESC
LIMIT 1;
" | head -1)"

    [[ -z "${row}" ]] && return 0

    local run_id="${row%%$'\t'*}"
    local rest="${row#*$'\t'}"
    local started_at="${rest#*$'\t'}"

    local age_minutes=999
    if [[ -n "${started_at}" ]]; then
      age_minutes="$(ingest_psql -t -A -c "
SELECT COALESCE(EXTRACT(EPOCH FROM (now() - '${started_at}'::timestamptz)) / 60, 999)::int;
" | tr -d '[:space:]')"
    fi

    if [[ "${age_minutes}" -ge "${INGEST_STALE_MINUTES}" ]]; then
      ingest_log "Stale IN_PROGRESS snapshot ${run_id} (${age_minutes}m) — marking FAILED and continuing"
      ingest_psql -c "
UPDATE engagement_reporting.snapshot_run
SET status = 'FAILED',
    error_message = 'Marked failed: stale IN_PROGRESS beyond ${INGEST_STALE_MINUTES} minutes',
    updated_at = now()
WHERE snapshot_run_id = '$(ingest_sql_escape "${run_id}")';
" >/dev/null
      return 0
    fi

    if [[ "${waited}" -ge "${INGEST_WAIT_MAX_SECONDS}" ]]; then
      ingest_log "STOP: Another ingest still IN_PROGRESS (${run_id}). Waited ${waited}s."
      return 1
    fi

    ingest_log "Waiting for IN_PROGRESS snapshot ${run_id} to finish (${waited}s / ${INGEST_WAIT_MAX_SECONDS}s max)..."
    sleep 10
    waited=$((waited + 10))
  done
}

# Filter items.jsonl to rows modified since watermark (with overlap).
ingest_filter_items_jsonl_since_watermark() {
  local input_file="$1"
  local output_file="$2"
  local watermark_iso="$3"
  local overlap_sec="${4:-${WATERMARK_OVERLAP_SECONDS}}"

  if [[ -z "${watermark_iso}" || "${FULL_INGEST:-false}" == "true" ]]; then
    cp "${input_file}" "${output_file}"
    return 0
  fi

  local since_iso="${watermark_iso}"
  if since_with_overlap="$(date -u -d "${watermark_iso} - ${overlap_sec} seconds" +%Y-%m-%dT%H:%M:%S 2>/dev/null)"; then
    since_iso="${since_with_overlap}"
  fi

  jq -c --arg since "${since_iso}" '
    def item_modified:
      (._modified_at // ._created_at // .ModifiedAt // .CreatedAt // empty)
      | if type == "object" and (.v? != null) then .v elif type == "string" then . else "" end;
    select(
      ((item_modified | length) == 0)
      or ((item_modified | .[0:19]) >= ($since | .[0:19]))
    )
  ' "${input_file}" > "${output_file}"
}
