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

# Logs must go to stderr — stdout is captured for JSON payloads (USAGE_PAYLOAD).
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

travel_entity_sql() {
  local entity="$1"
  local expr="lower(trim(coalesce(i.entity, i.source_payload->>'Entity', i.source_payload->'Entity'->>'Name', i.source_payload->>'Company', i.source_payload->'Company'->>'Name', '')))"
  case "$(printf '%s' "${entity}" | tr '[:upper:]' '[:lower:]')" in
    refex)
      printf "(%s LIKE '%%refex%%' AND %s NOT LIKE '%%venwind%%')" "${expr}" "${expr}"
      ;;
    venwind)
      printf "(%s LIKE '%%venwind%%')" "${expr}"
      ;;
    *)
      printf "(%s LIKE '%%venwind%%')" "${expr}"
      ;;
  esac
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

# Latest completed snapshot per process, then union items.
travel_classified_cte() {
  local entity_scope="$1"
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
        OR lower(trim(coalesce(i.source_payload->>'_status', i.source_payload->>'Status', ''))) ~ '(reject|cancel|withdraw)'
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
  WHERE ${entity_scope}
)
SQL
}

query_travel_summary() {
  local entity_scope="$1"
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte "${entity_scope}"),
filtered AS (
  SELECT * FROM classified
  WHERE $(travel_status_sql) AND $(travel_date_sql) AND $(travel_user_sql)
)
SELECT json_build_object(
  'total', (SELECT count(*) FROM filtered),
  'pending', (SELECT count(*) FROM filtered WHERE status_bucket = 'pending'),
  'completed', (SELECT count(*) FROM filtered WHERE status_bucket = 'completed'),
  'rejected', (SELECT count(*) FROM filtered WHERE status_bucket = 'rejected'),
  'opened_today', (
    SELECT count(*) FROM classified
    WHERE $(travel_status_sql) AND $(travel_user_sql)
      AND created_at IS NOT NULL
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ),
  'closed_today', (
    SELECT count(*) FROM classified
    WHERE $(travel_status_sql) AND $(travel_user_sql)
      AND completed_at IS NOT NULL
      AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND status_bucket IN ('completed', 'rejected')
  ),
  'has_sla_target', (SELECT count(*) FROM filtered WHERE sla_target_minutes IS NOT NULL) > 0,
  'sla_breached_open', (
    SELECT count(*) FROM filtered
    WHERE status_bucket = 'pending'
      AND sla_target_minutes IS NOT NULL
      AND created_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes
  ),
  'sla_breached_closed', (
    SELECT count(*) FROM filtered
    WHERE status_bucket IN ('completed', 'rejected')
      AND sla_target_minutes IS NOT NULL
      AND created_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (completed_at - created_at)) / 60 > sla_target_minutes
  )
);
"
}

query_travel_users() {
  local entity_scope="$1"
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte "${entity_scope}"),
filtered AS (
  SELECT *
  FROM classified
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
    MAX(CASE
      WHEN status_bucket = 'pending' AND created_at IS NOT NULL
        THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400))::int
      ELSE NULL
    END) AS pending_days,
    MAX(CASE
      WHEN status_bucket = 'pending' AND created_at IS NOT NULL
        THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 3600))::int
      ELSE NULL
    END) AS pending_hours,
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
  FROM filtered
  WHERE NULLIF(trim(requester_id), '') IS NOT NULL
  GROUP BY requester_id
),
oldest_pending AS (
  SELECT DISTINCT ON (requester_id)
    requester_id AS user_id,
    COALESCE(NULLIF(trim(owner_name), ''), NULLIF(trim(pending_step), ''), '') AS pending_step
  FROM filtered
  WHERE status_bucket = 'pending'
  ORDER BY requester_id, created_at ASC NULLS LAST
)
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
  SELECT
    resolved.user_name,
    ${REPORT_USER_LAST_SIGN_IN_IST_SQL} AS last_sign_in,
    a.total_count,
    a.pending_count,
    a.completed_count,
    a.rejected_count,
    COALESCE(a.pending_days, 0) AS pending_days,
    COALESCE(a.pending_hours, 0) AS pending_hours,
    COALESCE(op.pending_step, '') AS pending_step,
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
) t;
"
}

query_travel_pending_items() {
  local entity_scope="$1"
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte "${entity_scope}"),
filtered AS (
  SELECT *
  FROM classified
  WHERE status_bucket = 'pending'
    AND $(travel_status_sql)
    AND $(travel_date_sql)
    AND $(travel_user_sql)
)
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
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
  FROM filtered
  WHERE NULLIF(trim(COALESCE(requester_name, requester_email)), '') IS NOT NULL
  ORDER BY created_at ASC NULLS LAST
  LIMIT 50
) t;
"
}

query_travel_sla_items() {
  local entity_scope="$1"
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte "${entity_scope}"),
filtered AS (
  SELECT *
  FROM classified
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
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
  SELECT
    COALESCE(NULLIF(trim(requester_name), ''), requester_email, 'Unknown') AS user_name,
    request_id,
    COALESCE(NULLIF(trim(process_status), ''), status_bucket) AS process_status,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400))::int AS pending_days,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 3600))::int AS pending_hours
  FROM filtered
  WHERE NULLIF(trim(COALESCE(requester_name, requester_email)), '') IS NOT NULL
  ORDER BY created_at ASC NULLS LAST
  LIMIT 40
) t;
"
}

psql_json() {
  psql "${PG_CONN_STRING}" | tr -d '\r' | grep -v '^Output format' | grep -v '^Tuples only' | sed '/^$/d' || true
}

load_entity_payload() {
  local entity_name="$1"
  local entity_scope
  entity_scope="$(travel_entity_sql "${entity_name}")"
  log "Querying ${entity_name} travel usage (processes: ${TRAVEL_PROCESS_IDS})"
  local summary users pending sla
  summary="$(query_travel_summary "${entity_scope}" | psql_json)"
  users="$(query_travel_users "${entity_scope}" | psql_json)"
  pending="$(query_travel_pending_items "${entity_scope}" | psql_json)"
  sla="$(query_travel_sla_items "${entity_scope}" | psql_json)"
  [[ -n "${summary}" ]] || stop "Failed to retrieve ${entity_name} travel summary."
  [[ -n "${users}" ]] || users='[]'
  [[ -n "${pending}" ]] || pending='[]'
  [[ -n "${sla}" ]] || sla='[]'
  local today_ist
  today_ist="$(TZ='Asia/Kolkata' date +'%Y-%m-%d')"
  jq -c --arg entity "${entity_name}" --arg today "${today_ist}" \
    --argjson summary "${summary}" --argjson users "${users}" \
    --argjson pending "${pending}" --argjson sla "${sla}" '
    def is_kissflow_id:
      type == "string" and test("^[Uu][Ss][A-Za-z0-9_-]{6,}$");
    [$users[]
      | select((.user_name // "") | tostring | length > 0)
      | select((.user_name | is_kissflow_id | not))
    ] as $rows
    | [$pending[]
      | select((.user_name // "") | tostring | length > 0)
      | select((.user_name | is_kissflow_id | not))
    ] as $pending_rows
    | [$sla[]
      | select((.user_name // "") | tostring | length > 0)
      | select((.user_name | is_kissflow_id | not))
    ] as $sla_rows
    | {
        entity: $entity,
        total: ($summary.total // 0),
        pending: ($summary.pending // 0),
        completed: ($summary.completed // 0),
        rejected: ($summary.rejected // 0),
        opened_today: ($summary.opened_today // 0),
        closed_today: ($summary.closed_today // 0),
        has_sla_target: ($summary.has_sla_target // false),
        sla_breached_open: ($summary.sla_breached_open // 0),
        sla_breached_closed: ($summary.sla_breached_closed // 0),
        sla_breached_total: (($summary.sla_breached_open // 0) + ($summary.sla_breached_closed // 0)),
        total_users: ($rows | length),
        users_with_pending: ([$rows[] | select((.pending_count // 0) > 0)] | length),
        signed_in_today: ([$rows[] | select((.last_sign_in // "") | tostring | startswith($today))] | length),
        users: $rows,
        pending_items: $pending_rows,
        sla_items: $sla_rows
      }
  '
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
# Keep only the JSON object if any stray stdout leaked into the capture.
USAGE_PAYLOAD="$(printf '%s' "${USAGE_PAYLOAD}" | tr -d '\r' | awk 'BEGIN{p=0} /^{/{p=1} p{print}')"
[[ "${USAGE_PAYLOAD}" == \{* ]] || stop "Travel usage payload was not valid JSON (check renderer logs)."
HTML_PARTS="$(printf '%s' "${USAGE_PAYLOAD}" | node "${REPO_ROOT}/services/engagement-pipeline/scripts/build-travel-usage-html.js")"
[[ -n "${HTML_PARTS}" ]] || stop "Failed to build Travel usage HTML sections."

USER_TABLE_HTML="$(jq -r '.UserTableHtml // ""' <<< "${HTML_PARTS}")"
USER_TABLE_SECTION_HTML="$(jq -r '.UserTableSectionHtml // ""' <<< "${HTML_PARTS}")"
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
if ! grep -qF '{{UserTableSectionHtml}}' "${TEMPLATE_SRC}" && [[ -f "${SEED_TEMPLATE}" ]]; then
  log "Published template is missing Travel usage placeholders — using seed layout to avoid empty sections"
  cp "${SEED_TEMPLATE}" "${TEMPLATE_SRC}"
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

REPORT_BODY="${ENTITY_NAME} only. Combines Advance Payment, Expense Management, and Travel Management from live Kissflow data. Refex and Venwind are never mixed.${FILTER_NOTE}"

jq -n \
  --arg ReportTitle "${REPORT_TITLE}" \
  --arg ReportDate "${GENERATED_AT_DISPLAY}" \
  --arg EntityScope "${ENTITY_SCOPE}" \
  --arg EntityName "${ENTITY_NAME}" \
  --arg TotalRequests "${TOTAL_REQUESTS}" \
  --arg PendingRequests "${PENDING_REQUESTS}" \
  --arg CompletedRequests "${COMPLETED_REQUESTS}" \
  --arg RejectedRequests "${REJECTED_REQUESTS}" \
  --arg OpenedToday "${OPENED_TODAY}" \
  --arg ClosedToday "${CLOSED_TODAY}" \
  --arg TotalUsers "${TOTAL_USERS}" \
  --arg SignedInToday "${SIGNED_IN_TODAY}" \
  --arg UsersWithPending "${USERS_WITH_PENDING}" \
  --arg SlaBreachedTotal "${SLA_BREACHED_TOTAL}" \
  --arg SlaBreachedOpen "${SLA_BREACHED_OPEN}" \
  --arg SlaBreachedClosed "${SLA_BREACHED_CLOSED}" \
  --arg UserTableHtml "${USER_TABLE_HTML}" \
  --arg UserTableSectionHtml "${USER_TABLE_SECTION_HTML}" \
  --arg PendingDetailsHtml "${PENDING_DETAILS_HTML}" \
  --arg SlaAnalysisHtml "${SLA_ANALYSIS_HTML}" \
  --arg OverallSummaryHtml "" \
  --arg EntitySectionsHtml "" \
  --arg ReportBody "${REPORT_BODY}" \
  '{
    ReportTitle: $ReportTitle,
    ReportDate: $ReportDate,
    EntityScope: $EntityScope,
    EntityName: $EntityName,
    TotalRequests: $TotalRequests,
    PendingRequests: $PendingRequests,
    CompletedRequests: $CompletedRequests,
    RejectedRequests: $RejectedRequests,
    OpenedToday: $OpenedToday,
    ClosedToday: $ClosedToday,
    TotalUsers: $TotalUsers,
    SignedInToday: $SignedInToday,
    UsersWithPending: $UsersWithPending,
    SlaBreachedTotal: $SlaBreachedTotal,
    SlaBreachedOpen: $SlaBreachedOpen,
    SlaBreachedClosed: $SlaBreachedClosed,
    UserTableHtml: $UserTableHtml,
    UserTableSectionHtml: $UserTableSectionHtml,
    PendingDetailsHtml: $PendingDetailsHtml,
    SlaAnalysisHtml: $SlaAnalysisHtml,
    OverallSummaryHtml: $OverallSummaryHtml,
    EntitySectionsHtml: $EntitySectionsHtml,
    ReportBody: $ReportBody
  }' > "${VARS_JSON}"

report_template_render "${OUTPUT_FILE}" "${VARS_JSON}" "${TEMPLATE_SRC}" \
  || stop "Failed to render Travel report template."

cp "${OUTPUT_FILE}" "${LATEST_FILE}"

jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg output_file "${OUTPUT_FILE}" \
  --arg entity_filter "${ENTITY_FILTER}" \
  --arg status_filter "${STATUS_FILTER}" \
  --arg processes "${TRAVEL_PROCESS_IDS}" \
  --argjson usage "${USAGE_PAYLOAD}" '
{
  action: "RENDER_TRAVEL_HTML_REPORT",
  generated_at: $generated_at,
  output_file: $output_file,
  mutation_performed: false,
  entity_filter: $entity_filter,
  status_filter: $status_filter,
  processes: ($processes | split(" ")),
  entity: $usage.entity,
  total: $usage.total,
  pending: $usage.pending,
  completed: $usage.completed,
  total_users: $usage.total_users,
  users_with_pending: $usage.users_with_pending,
  sla_breached_total: $usage.sla_breached_total
}
' > "${AUDIT_FILE}"

log "Travel usage report rendered successfully (${ENTITY_NAME})"
printf '\nOutput file:\n%s\n' "${OUTPUT_FILE}"
printf '\nLatest (stable path):\n%s\n' "${LATEST_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
