#!/usr/bin/env bash
# Travel Management usage report — one entity per email.
# Unions Advance Payment + Expense Management + Travel Management from the
# Travel app, then filters Refex or Venwind. Does not change ITSM / PM / Solar.
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
TEMPLATES_DIR="${REPO_ROOT}/templates/generated"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-24"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/report-template-lib.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

REPORT_SLUG="${REPORT_SLUG:-travel}"
TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
OUTPUT_FILE="${TEMPLATES_DIR}/${REPORT_SLUG}-report-${TIMESTAMP}.html"
LATEST_FILE="${TEMPLATES_DIR}/${REPORT_SLUG}-report-latest.html"
AUDIT_FILE="${AUDIT_DIR}/runbook-24-${TIMESTAMP}.json"

LOGO_URL="https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png"
REFEXONE_LOGO_URL="${LOGO_URL}"

PG_CONN_STRING="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

TRAVEL_APP_ID="${APPLICATION_ID:-Expense_and_Travel_Management_A00}"
APPLICATION_ID="${APPLICATION_ID:-${TRAVEL_APP_ID}}"
DEFAULT_TRAVEL_PROCESS_IDS="Advance_Payment_Request_Process_A01 Expense_Management_A03 Travel_Management_A02"
TRAVEL_PROCESS_IDS="${TRAVEL_PROCESS_IDS:-${DEFAULT_TRAVEL_PROCESS_IDS}}"

# One report per entity. Empty / both / all → Venwind (test this entity first).
if [[ -z "${ENTITY_FILTER+x}" ]] || [[ -z "${ENTITY_FILTER}" ]]; then
  ENTITY_FILTER="Venwind"
fi
ENTITY_FILTER_NORM="$(printf '%s' "${ENTITY_FILTER}" | tr '[:upper:]' '[:lower:]')"
if [[ "${ENTITY_FILTER_NORM}" == "all" || "${ENTITY_FILTER_NORM}" == "*" || "${ENTITY_FILTER_NORM}" == "both" ]]; then
  ENTITY_FILTER="Venwind"
  ENTITY_FILTER_NORM="venwind"
  log_entity_default=1
fi
case "${ENTITY_FILTER_NORM}" in
  refex) ENTITY_FILTER="Refex"; ENTITY_FILTER_NORM="refex" ;;
  *) ENTITY_FILTER="Venwind"; ENTITY_FILTER_NORM="venwind" ;;
esac

STATUS_FILTER="$(printf '%s' "${STATUS_FILTER:-all}" | tr '[:upper:]' '[:lower:]')"
case "${STATUS_FILTER}" in
  pending|completed|rejected|cancelled) ;;
  *) STATUS_FILTER="all" ;;
esac
if [[ "${STATUS_FILTER}" == "cancelled" ]]; then
  STATUS_FILTER="rejected"
fi
USER_FILTER="${USER_FILTER:-${REQUESTER_FILTER:-}}"
DATE_FROM="${DATE_FROM:-}"
DATE_TO="${DATE_TO:-}"

# Logs must go to stderr — load_entity_payload captures stdout as JSON for node.
log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

travel_process_sql_in() {
  local pid parts=()
  for pid in ${TRAVEL_PROCESS_IDS}; do
    [[ -n "${pid}" ]] || continue
    parts+=("'$(sql_escape "${pid}")'")
  done
  local IFS=,
  printf '%s' "${parts[*]}"
}

TRAVEL_PROCESS_SQL_IN="$(travel_process_sql_in)"
[[ -n "${TRAVEL_PROCESS_SQL_IN}" ]] || stop "No Travel process IDs configured."

apply_template_branding_from_pg() {
  local template_id="${TEMPLATE_ID:-}"
  [[ -z "${template_id}" ]] && return 0
  local content_ref
  content_ref="$(psql "${PG_CONN_STRING}" -t -A -c "
    SELECT COALESCE(
      (
        SELECT rtv.content_ref
        FROM engagement_reporting.report_template_version rtv
        WHERE rtv.report_template_id = '${template_id}'::uuid
        ORDER BY rtv.version_number DESC
        LIMIT 1
      ),
      ''
    );
  " 2>/dev/null || true)"
  [[ -n "${content_ref}" ]] || return 0
  local extracted_logo
  extracted_logo="$(printf '%s' "${content_ref}" | sed -n 's/.*src="\([^"]*\)".*/\1/p' | grep -i 'refexone-logo' | head -1 || true)"
  if [[ -n "${extracted_logo}" ]]; then
    LOGO_URL="${extracted_logo}"
    log "Using refexOne logo from published template ${template_id}"
  fi
}

ensure_refexone_logo() {
  if [[ "${LOGO_URL}" == *"refex-logo.png"* ]] || [[ "${LOGO_URL}" != *"refexone"* ]]; then
    LOGO_URL="${REFEXONE_LOGO_URL}"
  fi
}

travel_entity_key_expr() {
  echo "lower(trim(coalesce(
    nullif(trim(i.entity), ''),
    nullif(trim(i.source_payload->>'Entity'), ''),
    nullif(trim(i.source_payload->'Entity'->>'Name'), ''),
    nullif(trim(i.source_payload->'Entity'->>'Value'), ''),
    nullif(trim(i.source_payload->'Entity'->>'v'), ''),
    nullif(trim(i.source_payload->>'EntityFlow'), ''),
    nullif(trim(i.source_payload->'EntityFlow'->>'Name'), ''),
    nullif(trim(i.source_payload->>'Entity_Flow'), ''),
    nullif(trim(i.source_payload->'Entity_Flow'->>'Name'), ''),
    nullif(trim(i.source_payload->>'Employee_entity'), ''),
    nullif(trim(i.source_payload->'Employee_entity'->>'Name'), ''),
    nullif(trim(i.source_payload->>'Employee_Org_Type'), ''),
    nullif(trim(i.source_payload->>'Company'), ''),
    nullif(trim(i.source_payload->'Company'->>'Name'), ''),
    nullif(trim(i.source_payload->>'Created_by_Company'), ''),
    nullif(trim(i.source_payload->>'Creator_Company'), ''),
    nullif(trim(i.source_payload->>'Createdby_company'), ''),
    ''
  )))"
}

travel_entity_filter_sql() {
  local entity="$1"
  local key="entity_key"
  case "$(printf '%s' "${entity}" | tr '[:upper:]' '[:lower:]')" in
    refex)
      printf "(%s IN ('', 'refex') OR (%s LIKE '%%refex%%' AND %s NOT LIKE '%%venwind%%' AND %s NOT LIKE '%%extrovis%%'))" \
        "${key}" "${key}" "${key}" "${key}"
      ;;
    venwind)
      printf "(%s LIKE '%%venwind%%')" "${key}"
      ;;
    *)
      printf "(%s LIKE '%%venwind%%')" "${key}"
      ;;
  esac
}

travel_is_draft_sql() {
  echo "(
    lower(coalesce(i.process_status, '')) LIKE '%draft%'
    OR lower(coalesce(i.current_step, '')) LIKE '%draft%'
    OR lower(coalesce(i.process_id, '')) LIKE '%draft%'
    OR lower(coalesce(i.source_payload->>'_status', '')) LIKE '%draft%'
    OR lower(coalesce(i.source_payload->>'Status', '')) LIKE '%draft%'
    OR lower(coalesce(i.source_payload->'Status'->>'Name', '')) LIKE '%draft%'
    OR lower(coalesce(i.source_payload->>'Process_Status', '')) LIKE '%draft%'
    OR lower(coalesce(i.source_payload->'Process_Status'->>'Name', '')) LIKE '%draft%'
    OR lower(coalesce(i.source_payload->>'_current_step', '')) LIKE '%draft%'
    OR lower(coalesce(i.source_payload->>'Step', '')) LIKE '%draft%'
  )"
}

travel_entity_sql() {
  travel_entity_filter_sql "$1"
}

travel_status_sql() {
  case "${STATUS_FILTER}" in
    pending) printf "classified.status_bucket = 'pending'" ;;
    completed) printf "classified.status_bucket = 'completed'" ;;
    rejected) printf "classified.status_bucket = 'rejected'" ;;
    *) printf 'true' ;;
  esac
}

travel_date_sql() {
  local from_sql to_sql
  from_sql="$(sql_escape "${DATE_FROM}")"
  to_sql="$(sql_escape "${DATE_TO}")"
  if [[ -n "${DATE_FROM}" && -n "${DATE_TO}" ]]; then
    printf "(classified.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN '%s'::date AND '%s'::date" "${from_sql}" "${to_sql}"
  elif [[ -n "${DATE_FROM}" ]]; then
    printf "(classified.created_at AT TIME ZONE 'Asia/Kolkata')::date >= '%s'::date" "${from_sql}"
  elif [[ -n "${DATE_TO}" ]]; then
    printf "(classified.created_at AT TIME ZONE 'Asia/Kolkata')::date <= '%s'::date" "${to_sql}"
  else
    printf 'true'
  fi
}

travel_user_sql() {
  local u
  u="$(sql_escape "${USER_FILTER}")"
  if [[ -z "${USER_FILTER}" ]]; then
    printf 'true'
    return
  fi
  printf "(lower(coalesce(classified.requester_name, '')) LIKE '%%' || lower('%s') || '%%' OR lower(coalesce(classified.requester_email, '')) LIKE '%%' || lower('%s') || '%%')" "${u}" "${u}"
}

# Latest completed snapshot per process, then union items (entity filter matches dashboard entity_key rules).
travel_classified_cte() {
  local entity_filter_sql
  entity_filter_sql="$(travel_entity_filter_sql "${ENTITY_FILTER}")"
  cat <<SQL
latest AS (
  SELECT DISTINCT ON (sr.process_id)
    sr.snapshot_run_id,
    sr.process_id
  FROM engagement_reporting.snapshot_run sr
  WHERE sr.application_id = '${TRAVEL_APP_ID}'
    AND sr.process_id IN (${TRAVEL_PROCESS_SQL_IN})
    AND sr.environment = 'production'
    AND sr.status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  ORDER BY sr.process_id, COALESCE(sr.load_completed_at, sr.extraction_completed_at, sr.created_at) DESC
),
classified AS (
  SELECT
    i.instance_id,
    i.process_id,
    i.process_status,
    i.requester_email,
    COALESCE(
      NULLIF(trim(i.request_id), ''),
      NULLIF(trim(i.request_number::text), ''),
      NULLIF(trim(i.instance_id), '')
    ) AS request_id,
    (${REPORT_ITEM_CREATED_AT_SQL}) AS created_at,
    (${REPORT_ITEM_COMPLETED_AT_SQL}) AS completed_at,
    ($(travel_entity_key_expr)) AS entity_key,
    COALESCE(
      NULLIF(trim(i.source_payload->'Requester'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Requested_By'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Employee'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Employee_Name'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Claimant'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'_created_by'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Created_By'->>'_id'), '')
    ) AS requester_id,
    COALESCE(
      NULLIF(trim(i.source_payload->'Requester'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Requested_By'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Employee'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Employee_Name'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Claimant'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'_created_by'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Created_By'->>'Name'), '')
    ) AS requester_name,
    NULLIF(trim(coalesce(
      i.source_payload->>'_current_step',
      i.source_payload->>'_stage',
      i.stage,
      ''
    )), '') AS pending_step,
    COALESCE(
      NULLIF(trim(i.source_payload #>> '{_current_assigned_to,0,Name}'), ''),
      NULLIF(trim(i.source_payload->'_current_assigned_to'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Assigned_To'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Approver'->>'Name'), '')
    ) AS owner_name,
    CASE
      WHEN coalesce(i.source_payload->'Closure_Time'->>'Closure_Time','') ~ '^[0-9]+(\.[0-9]+)?\$'
        THEN (i.source_payload->'Closure_Time'->>'Closure_Time')::numeric
      WHEN coalesce(i.source_payload->>'SLA_Minutes','') ~ '^[0-9]+(\.[0-9]+)?\$'
        THEN (i.source_payload->>'SLA_Minutes')::numeric
      WHEN coalesce(i.source_payload->>'TAT_Minutes','') ~ '^[0-9]+(\.[0-9]+)?\$'
        THEN (i.source_payload->>'TAT_Minutes')::numeric
      WHEN coalesce(i.source_payload->>'SLA_Hours','') ~ '^[0-9]+(\.[0-9]+)?\$'
        THEN (i.source_payload->>'SLA_Hours')::numeric * 60
      WHEN coalesce(i.source_payload->>'TAT_Hours','') ~ '^[0-9]+(\.[0-9]+)?\$'
        THEN (i.source_payload->>'TAT_Hours')::numeric * 60
      WHEN coalesce(i.source_payload->>'SLA_Days','') ~ '^[0-9]+(\.[0-9]+)?\$'
        THEN (i.source_payload->>'SLA_Days')::numeric * 1440
      ELSE NULL
    END AS sla_target_minutes,
    CASE
      WHEN i.process_status IN ('Withdrawn')
        OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
        OR lower(coalesce(
          i.source_payload->>'_status',
          i.source_payload->>'Status',
          i.source_payload->'Status'->>'Name',
          i.source_payload->>'Process_Status',
          i.source_payload->'Process_Status'->>'Name',
          ''
        )) ~ '(reject|cancel|withdraw)'
        THEN 'rejected'
      WHEN i.process_status IN ('Completed', 'Closed')
        OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled')
        THEN 'completed'
      ELSE 'pending'
    END AS status_bucket
  FROM engagement_reporting.item i
  JOIN latest l
    ON i.snapshot_run_id = l.snapshot_run_id
   AND i.process_id = l.process_id
  WHERE NOT ($(travel_is_draft_sql))
),
filtered AS (
  SELECT * FROM classified
  WHERE (${entity_filter_sql})
)
SQL
}

query_travel_summary() {
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte),
scoped AS (
  SELECT * FROM filtered
  WHERE $(travel_status_sql) AND $(travel_date_sql) AND $(travel_user_sql)
)
SELECT json_build_object(
  'total', (SELECT count(*) FROM scoped),
  'pending', (SELECT count(*) FROM scoped WHERE status_bucket = 'pending'),
  'completed', (SELECT count(*) FROM scoped WHERE status_bucket = 'completed'),
  'rejected', (SELECT count(*) FROM scoped WHERE status_bucket = 'rejected'),
  'opened_today', (
    SELECT count(*) FROM filtered
    WHERE $(travel_status_sql) AND $(travel_user_sql)
      AND created_at IS NOT NULL
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ),
  'closed_today', (
    SELECT count(*) FROM filtered
    WHERE $(travel_status_sql) AND $(travel_user_sql)
      AND completed_at IS NOT NULL
      AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND status_bucket IN ('completed', 'rejected')
  ),
  'has_sla_target', (SELECT count(*) FROM scoped WHERE sla_target_minutes IS NOT NULL) > 0,
  'sla_breached_open', (
    SELECT count(*) FROM scoped
    WHERE status_bucket = 'pending'
      AND sla_target_minutes IS NOT NULL
      AND created_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes
  ),
  'sla_breached_closed', (
    SELECT count(*) FROM scoped
    WHERE status_bucket IN ('completed', 'rejected')
      AND sla_target_minutes IS NOT NULL
      AND created_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (completed_at - created_at)) / 60 > sla_target_minutes
  ),
  'by_process', COALESCE((
    SELECT json_agg(row_to_json(p) ORDER BY p.sort_order)
    FROM (
      SELECT
        meta.sort_order,
        meta.process_id,
        meta.process_label,
        COALESCE(counts.total, 0)::int AS total,
        COALESCE(counts.pending, 0)::int AS pending,
        COALESCE(counts.completed, 0)::int AS completed,
        COALESCE(counts.rejected, 0)::int AS rejected
      FROM (
        VALUES
          (1, 'Travel_Management_A02', 'Travel Request'),
          (2, 'Advance_Payment_Request_Process_A01', 'Travel Advance'),
          (3, 'Expense_Management_A03', 'Travel Expense')
      ) AS meta(sort_order, process_id, process_label)
      LEFT JOIN (
        SELECT
          f.process_id,
          count(*)::int AS total,
          count(*) FILTER (WHERE f.status_bucket = 'pending')::int AS pending,
          count(*) FILTER (WHERE f.status_bucket = 'completed')::int AS completed,
          count(*) FILTER (WHERE f.status_bucket = 'rejected')::int AS rejected
        FROM scoped f
        GROUP BY f.process_id
      ) counts ON counts.process_id = meta.process_id
    ) p
  ), '[]'::json)
);
"
}

query_travel_users() {
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte),
scoped AS (
  SELECT *
  FROM filtered
  WHERE $(travel_status_sql)
    AND $(travel_date_sql)
    AND $(travel_user_sql)
),
activity AS (
  SELECT
    requester_id AS user_id,
    MAX(NULLIF(trim(requester_name), '')) AS display_name,
    MAX(NULLIF(trim(requester_email), '')) AS requester_email,
    count(*)::int AS total_count,
    count(*) FILTER (WHERE status_bucket = 'pending')::int AS pending_count,
    count(*) FILTER (WHERE status_bucket = 'completed')::int AS completed_count,
    count(*) FILTER (WHERE status_bucket = 'rejected')::int AS rejected_count,
    count(*) FILTER (
      WHERE sla_target_minutes IS NOT NULL
        AND created_at IS NOT NULL
        AND (
          (
            status_bucket = 'pending'
            AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes
          )
          OR (
            status_bucket IN ('completed', 'rejected')
            AND completed_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (completed_at - created_at)) / 60 > sla_target_minutes
          )
        )
    )::int AS sla_breached_count
  FROM scoped
  WHERE NULLIF(trim(requester_id), '') IS NOT NULL
  GROUP BY requester_id
),
oldest_pending AS (
  SELECT DISTINCT ON (requester_id)
    requester_id AS user_id,
    COALESCE(NULLIF(trim(owner_name), ''), '') AS pending_owner,
    COALESCE(NULLIF(trim(pending_step), ''), '') AS pending_step_name,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400))::int AS pending_days,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 3600))::int AS pending_hours
  FROM scoped
  WHERE status_bucket = 'pending'
  ORDER BY requester_id, created_at ASC NULLS LAST
)
SELECT COALESCE(
  (SELECT json_agg(t) FROM (
  SELECT
    resolved.user_name,
    ${REPORT_USER_LAST_SIGN_IN_IST_SQL} AS last_sign_in,
    a.total_count,
    a.pending_count,
    a.completed_count,
    a.rejected_count,
    COALESCE(op.pending_days, 0) AS pending_days,
    COALESCE(op.pending_hours, 0) AS pending_hours,
    COALESCE(NULLIF(trim(op.pending_owner), ''), NULLIF(trim(op.pending_step_name), ''), '') AS pending_step,
    COALESCE(op.pending_owner, '') AS pending_owner,
    COALESCE(a.sla_breached_count, 0) AS sla_breached_count
  FROM activity a
  LEFT JOIN oldest_pending op ON op.user_id = a.user_id
  LEFT JOIN LATERAL (
    SELECT u0.user_name, u0.last_sign_in, u0.ever_logged_in, u0.source_payload
    FROM engagement_reporting.\"user\" u0
    WHERE u0.user_id = a.user_id
      AND u0.environment = 'production'
    ORDER BY
      ${REPORT_BEST_USER_ORDER_SQL}
    LIMIT 1
  ) u ON true
  CROSS JOIN LATERAL (
    SELECT NULLIF(trim(COALESCE(u.user_name, a.display_name, a.requester_email)), '') AS user_name
  ) resolved
  WHERE resolved.user_name IS NOT NULL
    AND resolved.user_name <> a.user_id
    AND resolved.user_name !~ '^[Uu][Ss][A-Za-z0-9_-]{6,}\$'
  ORDER BY a.pending_count DESC, a.total_count DESC, a.completed_count DESC
  ) t),
  '[]'::json
);
"
}

query_travel_pending_items() {
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte),
scoped AS (
  SELECT *
  FROM filtered
  WHERE status_bucket = 'pending'
    AND $(travel_status_sql)
    AND $(travel_date_sql)
    AND $(travel_user_sql)
)
SELECT COALESCE(
  (SELECT json_agg(t) FROM (
  SELECT
    COALESCE(NULLIF(trim(requester_name), ''), requester_email, 'Unknown') AS user_name,
    request_id,
    COALESCE(NULLIF(trim(process_status), ''), 'InProgress') AS process_status,
    COALESCE(NULLIF(trim(owner_name), ''), NULLIF(trim(pending_step), ''), '-') AS pending_owner,
    COALESCE(NULLIF(trim(pending_step), ''), '') AS pending_step,
    to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS pending_since,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400))::int AS pending_days,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 3600))::int AS pending_hours,
    CASE
      WHEN sla_target_minutes IS NULL THEN 'No SLA target'
      WHEN created_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes THEN 'Breached'
      ELSE 'Within SLA'
    END AS sla_status
  FROM scoped
  WHERE NULLIF(trim(COALESCE(requester_name, requester_email)), '') IS NOT NULL
  ORDER BY created_at ASC NULLS LAST
  LIMIT 50
  ) t),
  '[]'::json
);
"
}

query_travel_sla_items() {
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte),
scoped AS (
  SELECT *
  FROM filtered
  WHERE $(travel_status_sql)
    AND $(travel_date_sql)
    AND $(travel_user_sql)
    AND sla_target_minutes IS NOT NULL
    AND created_at IS NOT NULL
    AND (
      (
        status_bucket = 'pending'
        AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes
      )
      OR (
        status_bucket IN ('completed', 'rejected')
        AND completed_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (completed_at - created_at)) / 60 > sla_target_minutes
      )
    )
)
SELECT COALESCE(
  (SELECT json_agg(t) FROM (
  SELECT
    COALESCE(NULLIF(trim(requester_name), ''), requester_email, 'Unknown') AS user_name,
    request_id,
    COALESCE(NULLIF(trim(process_status), ''), status_bucket) AS process_status,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400))::int AS pending_days,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 3600))::int AS pending_hours
  FROM scoped
  WHERE NULLIF(trim(COALESCE(requester_name, requester_email)), '') IS NOT NULL
  ORDER BY created_at ASC NULLS LAST
  LIMIT 40
  ) t),
  '[]'::json
);
"
}

psql_json() {
  psql -q "${PG_CONN_STRING}" 2>/dev/null \
    | tr -d '\r' \
    | grep -v '^Output format' \
    | grep -v '^Tuples only' \
    | grep -v '^NOTICE:' \
    | sed '/^$/d' \
    || true
}

ensure_json() {
  local raw="$1"
  local fallback="${2:-[]}"
  raw="$(printf '%s' "${raw}" | sed '/^$/d')"
  if [[ -n "${raw}" ]] && printf '%s' "${raw}" | jq -e . >/dev/null 2>&1; then
    printf '%s' "${raw}"
  else
    printf '%s' "${fallback}"
  fi
}

load_entity_payload() {
  local entity_name="$1"
  log "Querying ${entity_name} travel usage (processes: ${TRAVEL_PROCESS_IDS})"
  local summary users pending sla tmpdir
  summary="$(ensure_json "$(query_travel_summary | psql_json)" '{}')"
  users="$(ensure_json "$(query_travel_users | psql_json)" '[]')"
  pending="$(ensure_json "$(query_travel_pending_items | psql_json)" '[]')"
  sla="$(ensure_json "$(query_travel_sla_items | psql_json)" '[]')"
  [[ "${summary}" != "{}" ]] || stop "Failed to retrieve ${entity_name} travel summary."
  local today_ist
  today_ist="$(TZ='Asia/Kolkata' date +'%Y-%m-%d')"
  tmpdir="$(mktemp -d)"
  printf '%s' "${summary}" > "${tmpdir}/summary.json"
  printf '%s' "${users}" > "${tmpdir}/users.json"
  printf '%s' "${pending}" > "${tmpdir}/pending.json"
  printf '%s' "${sla}" > "${tmpdir}/sla.json"
  export TRAVEL_SUMMARY_JSON_FILE="${tmpdir}/summary.json"
  export TRAVEL_USERS_JSON_FILE="${tmpdir}/users.json"
  export TRAVEL_PENDING_JSON_FILE="${tmpdir}/pending.json"
  export TRAVEL_SLA_JSON_FILE="${tmpdir}/sla.json"
  export TRAVEL_ENTITY_NAME="${entity_name}"
  export TRAVEL_TODAY_IST="${today_ist}"
  node "${REPO_ROOT}/services/engagement-pipeline/scripts/merge-travel-usage-payload.js" \
    || stop "Failed to merge ${entity_name} travel usage payload."
  rm -rf "${tmpdir}"
  unset TRAVEL_SUMMARY_JSON_FILE TRAVEL_USERS_JSON_FILE TRAVEL_PENDING_JSON_FILE TRAVEL_SLA_JSON_FILE \
    TRAVEL_ENTITY_NAME TRAVEL_TODAY_IST
}

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."
command -v node >/dev/null 2>&1 || stop "node is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"

if [[ "${log_entity_default:-0}" == "1" ]]; then
  log "Travel reports are per-entity; defaulting combined three-process report to Venwind"
fi

apply_template_branding_from_pg
ensure_refexone_logo

for pid in ${TRAVEL_PROCESS_IDS}; do
  refresh_user_last_sign_ins_for_process "${TRAVEL_APP_ID}" "${pid}"
done

USAGE_PAYLOAD="$(load_entity_payload "${ENTITY_FILTER}")"
[[ -n "${USAGE_PAYLOAD}" ]] || stop "Travel usage payload is empty for ${ENTITY_FILTER}"
printf '%s' "${USAGE_PAYLOAD}" | jq -e . >/dev/null 2>&1 || stop "Travel usage payload is not valid JSON"
HTML_PARTS="$(printf '%s' "${USAGE_PAYLOAD}" | node "${REPO_ROOT}/services/engagement-pipeline/scripts/build-travel-usage-html.js")"
[[ -n "${HTML_PARTS}" ]] || stop "Failed to build Travel usage HTML sections."
printf '%s' "${HTML_PARTS}" | jq -e . >/dev/null 2>&1 || stop "Travel HTML parts JSON is invalid"

USER_TABLE_HTML="$(jq -r '.UserTableHtml // ""' <<< "${HTML_PARTS}")"
USER_TABLE_SECTION_HTML="$(jq -r '.UserTableSectionHtml // ""' <<< "${HTML_PARTS}")"
PROCESS_SECTIONS_HTML="$(jq -r '.ProcessSectionsHtml // ""' <<< "${HTML_PARTS}")"
PENDING_DETAILS_HTML="$(jq -r '.PendingDetailsHtml // ""' <<< "${HTML_PARTS}")"
SLA_ANALYSIS_HTML="$(jq -r '.SlaAnalysisHtml // ""' <<< "${HTML_PARTS}")"

TOTAL_REQUESTS="$(jq -r '.total' <<< "${USAGE_PAYLOAD}")"
PENDING_REQUESTS="$(jq -r '.pending' <<< "${USAGE_PAYLOAD}")"
COMPLETED_REQUESTS="$(jq -r '.completed' <<< "${USAGE_PAYLOAD}")"
REJECTED_REQUESTS="$(jq -r '.rejected' <<< "${USAGE_PAYLOAD}")"
OPENED_TODAY="$(jq -r '.opened_today' <<< "${USAGE_PAYLOAD}")"
CLOSED_TODAY="$(jq -r '.closed_today' <<< "${USAGE_PAYLOAD}")"
TOTAL_USERS="$(jq -r '.total_users' <<< "${USAGE_PAYLOAD}")"
SIGNED_IN_TODAY="$(jq -r '.signed_in_today' <<< "${USAGE_PAYLOAD}")"
USERS_WITH_PENDING="$(jq -r '.users_with_pending' <<< "${USAGE_PAYLOAD}")"
SLA_BREACHED_TOTAL="$(jq -r '.sla_breached_total' <<< "${USAGE_PAYLOAD}")"
SLA_BREACHED_OPEN="$(jq -r '.sla_breached_open' <<< "${USAGE_PAYLOAD}")"
SLA_BREACHED_CLOSED="$(jq -r '.sla_breached_closed' <<< "${USAGE_PAYLOAD}")"

ENTITY_SCOPE="${ENTITY_FILTER} travel requests only"
ENTITY_NAME="${ENTITY_FILTER}"
GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

log "Rendering HTML from published template (PostgreSQL or seed fallback)"

TEMPLATE_SRC="$(mktemp)"
VARS_JSON="$(mktemp)"
trap 'rm -f "${TEMPLATE_SRC}" "${VARS_JSON}"' EXIT

report_template_load_html "${TEMPLATE_SRC}" || stop "Failed to load Travel report template HTML."
report_template_emphasize_users_kpi "${TEMPLATE_SRC}"

SEED_TEMPLATE="${REPO_ROOT}/db/seeds/travel-engagement-template.html"
case "${ENTITY_FILTER:-}" in
  [Rr]efex*) SEED_TEMPLATE="${REPO_ROOT}/db/seeds/travel-refex-template.html" ;;
  [Vv]enwind*) SEED_TEMPLATE="${REPO_ROOT}/db/seeds/travel-venwind-template.html" ;;
esac
# Always prefer seed layout when published Admin UI HTML is missing required KPI placeholders.
if [[ -f "${SEED_TEMPLATE}" ]]; then
  if ! grep -qF '{{ProcessSectionsHtml}}' "${TEMPLATE_SRC}" \
    || ! grep -qF '{{OpenedToday}}' "${TEMPLATE_SRC}" \
    || ! grep -qF '{{TotalRequests}}' "${TEMPLATE_SRC}" \
    || grep -qF 'Payment Request + Expense + Travel' "${TEMPLATE_SRC}"; then
    log "Published Travel template missing KPI placeholders or outdated subtitle — using seed layout (${SEED_TEMPLATE})"
    cp "${SEED_TEMPLATE}" "${TEMPLATE_SRC}"
  elif ! grep -qF '{{UserTableSectionHtml}}' "${TEMPLATE_SRC}"; then
    log "Published Travel template missing UserTableSectionHtml — using seed layout"
    cp "${SEED_TEMPLATE}" "${TEMPLATE_SRC}"
  fi
fi

REPORT_TITLE="${TEMPLATE_NAME:-}"
if [[ -z "${REPORT_TITLE}" ]]; then
  REPORT_TITLE="${SUBJECT:-${ENTITY_NAME} Travel Management Report}"
fi

FILTER_NOTES=()
if [[ "${STATUS_FILTER}" != "all" ]]; then
  FILTER_NOTES+=("status=${STATUS_FILTER}")
fi
if [[ -n "${USER_FILTER}" ]]; then
  FILTER_NOTES+=("requester=${USER_FILTER}")
fi
if [[ -n "${DATE_FROM}" || -n "${DATE_TO}" ]]; then
  FILTER_NOTES+=("date=${DATE_FROM:-…}..${DATE_TO:-…}")
fi
FILTER_NOTE=""
if [[ ${#FILTER_NOTES[@]} -gt 0 ]]; then
  FILTER_NOTE=" Filters applied: $(IFS=', '; echo "${FILTER_NOTES[*]}")."
fi

REPORT_BODY="${ENTITY_NAME} only. Combines Travel Request, Travel Expense, and Travel Advance from live Kissflow data. Refex and Venwind are never mixed.${FILTER_NOTE}"

TRAVEL_VARS_TMP="$(mktemp -d)"
printf '%s' "${USAGE_PAYLOAD}" > "${TRAVEL_VARS_TMP}/usage.json"
printf '%s' "${HTML_PARTS}" > "${TRAVEL_VARS_TMP}/html_parts.json"
export TRAVEL_USAGE_JSON_FILE="${TRAVEL_VARS_TMP}/usage.json"
export TRAVEL_HTML_PARTS_FILE="${TRAVEL_VARS_TMP}/html_parts.json"
export TRAVEL_META_REPORT_TITLE="${REPORT_TITLE}"
export TRAVEL_META_REPORT_DATE="${GENERATED_AT_DISPLAY}"
export TRAVEL_META_ENTITY_SCOPE="${ENTITY_SCOPE}"
export TRAVEL_META_ENTITY_NAME="${ENTITY_NAME}"
export TRAVEL_META_REPORT_BODY="${REPORT_BODY}"
export TEMPLATE_VARS_OUT="${VARS_JSON}"
node "${REPO_ROOT}/services/engagement-pipeline/scripts/build-travel-template-vars.js" \
  || stop "Failed to build Travel template variables JSON."
rm -rf "${TRAVEL_VARS_TMP}"
unset TRAVEL_USAGE_JSON_FILE TRAVEL_HTML_PARTS_FILE TEMPLATE_VARS_OUT \
  TRAVEL_META_REPORT_TITLE TRAVEL_META_REPORT_DATE TRAVEL_META_ENTITY_SCOPE \
  TRAVEL_META_ENTITY_NAME TRAVEL_META_REPORT_BODY

report_template_render "${OUTPUT_FILE}" "${VARS_JSON}" "${TEMPLATE_SRC}" \
  || stop "Failed to render Travel report template."

cp "${OUTPUT_FILE}" "${LATEST_FILE}"

printf '%s' "${USAGE_PAYLOAD}" > "${VARS_JSON}.usage"
jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg output_file "${OUTPUT_FILE}" \
  --arg entity_filter "${ENTITY_FILTER}" \
  --arg status_filter "${STATUS_FILTER}" \
  --arg processes "${TRAVEL_PROCESS_IDS}" \
  --slurpfile usage "${VARS_JSON}.usage" '
{
  action: "RENDER_TRAVEL_HTML_REPORT",
  generated_at: $generated_at,
  output_file: $output_file,
  mutation_performed: false,
  entity_filter: $entity_filter,
  status_filter: $status_filter,
  processes: ($processes | split(" ")),
  entity: ($usage[0].entity // $entity_filter),
  total: ($usage[0].total // 0),
  pending: ($usage[0].pending // 0),
  completed: ($usage[0].completed // 0),
  total_users: ($usage[0].total_users // 0),
  users_with_pending: ($usage[0].users_with_pending // 0),
  sla_breached_total: ($usage[0].sla_breached_total // 0)
}
' > "${AUDIT_FILE}"
rm -f "${VARS_JSON}.usage"

log "Travel usage report rendered successfully (${ENTITY_NAME})"
printf '\nOutput file:\n%s\n' "${OUTPUT_FILE}"
printf '\nLatest (stable path):\n%s\n' "${LATEST_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
