#!/usr/bin/env bash
# Travel Management usage report — requester-wise pending/usage, Refex and Venwind separate.
# Reuses the ITSM usage-report approach (latest snapshot + per-user counts + entity scope)
# without changing ITSM runbooks.
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
TRAVEL_PROCESS_ID="${PROCESS_ID:-Copy_of_Venwind_Travel_Request_A00}"
APPLICATION_ID="${APPLICATION_ID:-${TRAVEL_APP_ID}}"

# Entity scope: Refex | Venwind | both (default). "all"/"*" also means both, never mixed user tables.
if [[ -z "${ENTITY_FILTER+x}" ]] || [[ -z "${ENTITY_FILTER}" ]]; then
  ENTITY_FILTER="both"
fi
ENTITY_FILTER_NORM="$(printf '%s' "${ENTITY_FILTER}" | tr '[:upper:]' '[:lower:]')"
if [[ "${ENTITY_FILTER_NORM}" == "all" || "${ENTITY_FILTER_NORM}" == "*" || "${ENTITY_FILTER_NORM}" == "both" ]]; then
  ENTITY_FILTER="both"
  ENTITY_FILTER_NORM="both"
fi

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

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

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

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

# Entity match is case-insensitive on Kissflow Entity (and Company fallback).
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
      printf 'true'
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

# Shared classified-item CTE used by summary and per-requester queries.
travel_classified_cte() {
  local entity_scope="$1"
  cat <<SQL
latest AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.snapshot_run
  WHERE application_id = '${TRAVEL_APP_ID}'
    AND process_id = '${TRAVEL_PROCESS_ID}'
    AND environment = 'production'
    AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  ORDER BY COALESCE(load_completed_at, extraction_completed_at, created_at) DESC
  LIMIT 1
),
classified AS (
  SELECT
    i.instance_id,
    i.process_status,
    i.requester_email,
    (${REPORT_ITEM_CREATED_AT_SQL}) AS created_at,
    (${REPORT_ITEM_COMPLETED_AT_SQL}) AS completed_at,
    COALESCE(
      NULLIF(trim(i.source_payload->'Requester'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Requested_By'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Employee'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'Employee_Name'->>'_id'), ''),
      NULLIF(trim(i.source_payload->'_created_by'->>'_id'), '')
    ) AS requester_id,
    COALESCE(
      NULLIF(trim(i.source_payload->'Requester'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Requested_By'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Employee'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'Employee_Name'->>'Name'), ''),
      NULLIF(trim(i.source_payload->'_created_by'->>'Name'), '')
    ) AS requester_name,
    NULLIF(trim(coalesce(
      i.source_payload->>'_current_step',
      i.stage,
      ''
    )), '') AS pending_step,
    CASE
      WHEN i.process_status IN ('Withdrawn')
        OR lower(coalesce(i.process_status, '')) ~ '(reject|cancel|withdraw)'
        OR lower(trim(coalesce(i.source_payload->>'_status', i.source_payload->>'Status', ''))) ~ '(reject|cancel|withdraw)'
        THEN 'rejected'
      WHEN i.process_status IN ('Completed', 'Closed')
        OR lower(coalesce(i.process_status, '')) IN ('completed', 'closed', 'done', 'approved')
        THEN 'completed'
      ELSE 'pending'
    END AS status_bucket
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id
    AND i.process_id = '${TRAVEL_PROCESS_ID}'
    AND ${entity_scope}
)
SQL
}

query_travel_summary() {
  local entity_scope="$1"
  echo "
\pset tuples_only on
\pset format unaligned
WITH $(travel_classified_cte "${entity_scope}")
SELECT json_build_object(
  'total', (SELECT count(*) FROM classified WHERE $(travel_status_sql) AND $(travel_date_sql) AND $(travel_user_sql)),
  'pending', (SELECT count(*) FROM classified WHERE status_bucket = 'pending' AND $(travel_status_sql) AND $(travel_date_sql) AND $(travel_user_sql)),
  'completed', (SELECT count(*) FROM classified WHERE status_bucket = 'completed' AND $(travel_status_sql) AND $(travel_date_sql) AND $(travel_user_sql)),
  'rejected', (SELECT count(*) FROM classified WHERE status_bucket = 'rejected' AND $(travel_status_sql) AND $(travel_date_sql) AND $(travel_user_sql)),
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
    END) AS oldest_pending_days
  FROM filtered
  WHERE NULLIF(trim(requester_id), '') IS NOT NULL
  GROUP BY requester_id
),
oldest_pending AS (
  SELECT DISTINCT ON (requester_id)
    requester_id AS user_id,
    pending_step
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
    COALESCE(a.oldest_pending_days, 0) AS oldest_pending_days,
    COALESCE(op.pending_step, '') AS pending_step
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
    AND resolved.user_name !~ '^[Uu][Ss][A-Za-z0-9_-]{6,}$'
  ORDER BY a.pending_count DESC, a.total_count DESC, a.completed_count DESC
) t;
"
}

load_entity_payload() {
  local entity_name="$1"
  local entity_scope
  entity_scope="$(travel_entity_sql "${entity_name}")"
  log "Querying ${entity_name} travel usage (process=${TRAVEL_PROCESS_ID})"
  local summary users
  summary="$(query_travel_summary "${entity_scope}" | psql "${PG_CONN_STRING}" | tr -d '\r' | grep -v '^Output format')"
  users="$(query_travel_users "${entity_scope}" | psql "${PG_CONN_STRING}" | tr -d '\r' | grep -v '^Output format')"
  [[ -n "${summary}" ]] || stop "Failed to retrieve ${entity_name} travel summary."
  [[ -n "${users}" ]] || stop "Failed to retrieve ${entity_name} travel requester breakdown."
  local today_ist
  today_ist="$(TZ='Asia/Kolkata' date +'%Y-%m-%d')"
  jq -c --arg entity "${entity_name}" --arg today "${today_ist}" --argjson summary "${summary}" --argjson users "${users}" '
    def is_kissflow_id:
      type == "string" and test("^[Uu][Ss][A-Za-z0-9_-]{6,}$");
    [$users[]
      | select((.user_name // "") | tostring | length > 0)
      | select((.user_name | is_kissflow_id | not))
    ] as $rows
    | {
        entity: $entity,
        total: ($summary.total // 0),
        pending: ($summary.pending // 0),
        completed: ($summary.completed // 0),
        rejected: ($summary.rejected // 0),
        opened_today: ($summary.opened_today // 0),
        closed_today: ($summary.closed_today // 0),
        total_users: ($rows | length),
        signed_in_today: ([$rows[] | select((.last_sign_in // "") | tostring | startswith($today))] | length),
        users: $rows
      }
  '
}

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."
command -v node >/dev/null 2>&1 || stop "node is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"

apply_template_branding_from_pg
ensure_refexone_logo
refresh_user_last_sign_ins_for_process "${TRAVEL_APP_ID}" "${TRAVEL_PROCESS_ID}"

ENTITIES=()
case "${ENTITY_FILTER_NORM}" in
  refex) ENTITIES=("Refex") ;;
  venwind) ENTITIES=("Venwind") ;;
  *) ENTITIES=("Refex" "Venwind") ;;
esac

SECTIONS_JSON='[]'
for entity in "${ENTITIES[@]}"; do
  section="$(load_entity_payload "${entity}")"
  SECTIONS_JSON="$(jq -c --argjson section "${section}" '. + [$section]' <<< "${SECTIONS_JSON}")"
done

OVERALL_JSON="$(jq -c '
  {
    total: ([.[].total] | add // 0),
    pending: ([.[].pending] | add // 0),
    completed: ([.[].completed] | add // 0),
    rejected: ([.[].rejected] | add // 0),
    opened_today: ([.[].opened_today] | add // 0),
    closed_today: ([.[].closed_today] | add // 0),
    total_users: ([.[].total_users] | add // 0),
    signed_in_today: ([.[].signed_in_today] | add // 0)
  }
' <<< "${SECTIONS_JSON}")"

USAGE_PAYLOAD="$(jq -c --argjson overall "${OVERALL_JSON}" --argjson sections "${SECTIONS_JSON}" '{overall: $overall, sections: $sections}')"
HTML_PARTS="$(printf '%s' "${USAGE_PAYLOAD}" | node "${REPO_ROOT}/services/engagement-pipeline/scripts/build-travel-usage-html.js")"
[[ -n "${HTML_PARTS}" ]] || stop "Failed to build Travel usage HTML sections."

OVERALL_SUMMARY_HTML="$(jq -r '.OverallSummaryHtml // ""' <<< "${HTML_PARTS}")"
ENTITY_SECTIONS_HTML="$(jq -r '.EntitySectionsHtml // ""' <<< "${HTML_PARTS}")"
[[ -n "${ENTITY_SECTIONS_HTML}" ]] || stop "Travel entity sections HTML was empty."

# Fallback rows for older published templates that still have {{UserTableHtml}}.
USER_TABLE_HTML="$(jq -r '
  def is_kissflow_id:
    type == "string" and test("^[Uu][Ss][A-Za-z0-9_-]{6,}$");
  if length > 1 then
    "<tr style=\"background-color:#ffffff;\" bgcolor=\"#ffffff\"><td colspan=\"4\" style=\"padding:16px 14px; border-bottom:1px solid #ececea; color:#64748b !important; text-align:center;\">Requester-wise usage is listed separately for Refex and Venwind above.</td></tr>"
  else
    (.[0].users // []) as $rows
    | [$rows[] | select((.user_name // "") | tostring | length > 0) | select((.user_name | is_kissflow_id | not))] as $visible
    | if ($visible | length) == 0 then
        "<tr style=\"background-color:#ffffff;\" bgcolor=\"#ffffff\"><td colspan=\"4\" style=\"padding:16px 14px; border-bottom:1px solid #ececea; color:#64748b !important; text-align:center;\">No requesters with travel requests in this snapshot.</td></tr>"
      else
        $visible | to_entries | map(
          "<tr style=\"background-color:" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + ";\" bgcolor=\"" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + "\">" +
          "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.user_name // "Unknown") + "</td>" +
          "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + ((.value.last_sign_in // "") | if . == "" or . == "Never" then "-" else . end) + "</td>" +
          "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.pending_count | tostring) + "</b></td>" +
          "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.completed_count | tostring) + "</td>" +
          "</tr>"
        ) | join("")
      end
  end
' <<< "${SECTIONS_JSON}")"
TOTAL_REQUESTS="$(jq -r '.total' <<< "${OVERALL_JSON}")"
PENDING_REQUESTS="$(jq -r '.pending' <<< "${OVERALL_JSON}")"
COMPLETED_REQUESTS="$(jq -r '.completed' <<< "${OVERALL_JSON}")"
REJECTED_REQUESTS="$(jq -r '.rejected' <<< "${OVERALL_JSON}")"
OPENED_TODAY="$(jq -r '.opened_today' <<< "${OVERALL_JSON}")"
CLOSED_TODAY="$(jq -r '.closed_today' <<< "${OVERALL_JSON}")"
TOTAL_USERS="$(jq -r '.total_users' <<< "${OVERALL_JSON}")"
SIGNED_IN_TODAY="$(jq -r '.signed_in_today' <<< "${OVERALL_JSON}")"

case "${ENTITY_FILTER_NORM}" in
  refex) ENTITY_SCOPE="Refex travel requests only" ;;
  venwind) ENTITY_SCOPE="Venwind travel requests only" ;;
  *) ENTITY_SCOPE="Refex and Venwind shown separately" ;;
esac

GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

log "Rendering HTML from published template (PostgreSQL or seed fallback)"

TEMPLATE_SRC="$(mktemp)"
VARS_JSON="$(mktemp)"
trap 'rm -f "${TEMPLATE_SRC}" "${VARS_JSON}"' EXIT

report_template_load_html "${TEMPLATE_SRC}" || stop "Failed to load Travel report template HTML."
report_template_emphasize_users_kpi "${TEMPLATE_SRC}"

if ! grep -qF '{{EntitySectionsHtml}}' "${TEMPLATE_SRC}"; then
  python3 - "${TEMPLATE_SRC}" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
html = path.read_text(encoding="utf-8")
mark = "{{EntitySectionsHtml}}"
if mark in html:
    raise SystemExit(0)
needles = [
    "Request Summary",
    "Users with pending or recent travel requests",
    "Users with pending or recent activity",
]
inserted = False
for needle in needles:
    idx = html.find(needle)
    if idx < 0:
        continue
    tr_start = html.rfind("<tr>", 0, idx)
    if tr_start < 0:
        continue
    html = html[:tr_start] + mark + "\n" + html[tr_start:]
    inserted = True
    break
if not inserted:
    html = html.replace("</body>", mark + "\n</body>")
path.write_text(html, encoding="utf-8")
PY
  log "Injected EntitySectionsHtml placeholder into loaded template"
fi

if ! grep -qF '{{OverallSummaryHtml}}' "${TEMPLATE_SRC}"; then
  python3 - "${TEMPLATE_SRC}" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
html = path.read_text(encoding="utf-8")
if "{{OverallSummaryHtml}}" in html:
    raise SystemExit(0)
idx = html.find("{{EntitySectionsHtml}}")
if idx >= 0:
    html = html[:idx] + "{{OverallSummaryHtml}}\n" + html[idx:]
    path.write_text(html, encoding="utf-8")
PY
fi

REPORT_TITLE="${TEMPLATE_NAME:-}"
if [[ -z "${REPORT_TITLE}" ]]; then
  REPORT_TITLE="${SUBJECT:-Travel Management Daily Usage Report}"
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

REPORT_BODY="Requester-wise Travel Management usage from live Kissflow data (process ${TRAVEL_PROCESS_ID}). ${ENTITY_SCOPE}. Pending ageing is the oldest open request for that requester.${FILTER_NOTE}"

jq -n \
  --arg ReportTitle "${REPORT_TITLE}" \
  --arg ReportDate "${GENERATED_AT_DISPLAY}" \
  --arg EntityScope "${ENTITY_SCOPE}" \
  --arg TotalRequests "${TOTAL_REQUESTS}" \
  --arg PendingRequests "${PENDING_REQUESTS}" \
  --arg CompletedRequests "${COMPLETED_REQUESTS}" \
  --arg RejectedRequests "${REJECTED_REQUESTS}" \
  --arg OpenedToday "${OPENED_TODAY}" \
  --arg ClosedToday "${CLOSED_TODAY}" \
  --arg TotalUsers "${TOTAL_USERS}" \
  --arg SignedInToday "${SIGNED_IN_TODAY}" \
  --arg OverallSummaryHtml "${OVERALL_SUMMARY_HTML}" \
  --arg EntitySectionsHtml "${ENTITY_SECTIONS_HTML}" \
  --arg UserTableHtml "${USER_TABLE_HTML}" \
  --arg ReportBody "${REPORT_BODY}" \
  '{
    ReportTitle: $ReportTitle,
    ReportDate: $ReportDate,
    EntityScope: $EntityScope,
    TotalRequests: $TotalRequests,
    PendingRequests: $PendingRequests,
    CompletedRequests: $CompletedRequests,
    RejectedRequests: $RejectedRequests,
    OpenedToday: $OpenedToday,
    ClosedToday: $ClosedToday,
    TotalUsers: $TotalUsers,
    SignedInToday: $SignedInToday,
    OverallSummaryHtml: $OverallSummaryHtml,
    EntitySectionsHtml: $EntitySectionsHtml,
    UserTableHtml: $UserTableHtml,
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
  --argjson overall "${OVERALL_JSON}" \
  --argjson sections "${SECTIONS_JSON}" '
{
  action: "RENDER_TRAVEL_HTML_REPORT",
  generated_at: $generated_at,
  output_file: $output_file,
  mutation_performed: false,
  entity_filter: $entity_filter,
  status_filter: $status_filter,
  overall: $overall,
  entities: [$sections[] | {entity, total, pending, completed, rejected, total_users}]
}
' > "${AUDIT_FILE}"

log "Travel usage report rendered successfully"
printf '\nOutput file:\n%s\n' "${OUTPUT_FILE}"
printf '\nLatest (stable path):\n%s\n' "${LATEST_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
