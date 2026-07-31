#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
TEMPLATES_DIR="${REPO_ROOT}/templates/generated"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-06"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/report-template-lib.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

PG_CONN_STRING="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
OUTPUT_FILE="${TEMPLATES_DIR}/report-${TIMESTAMP}.html"
LATEST_FILE="${TEMPLATES_DIR}/report-latest.html"
AUDIT_FILE="${AUDIT_DIR}/runbook-06-${TIMESTAMP}.json"

LOGO_URL="https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png"
DIVIDER_GIF_URL="https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif"
REFEXONE_LOGO_URL="${LOGO_URL}"

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

ITSM_APP_ID="${ITSM_APP_ID:-IT_Service_Management_A00}"
ITSM_PROCESS_ID="${ITSM_PROCESS_ID:-${PROCESS_ID:-Live_IT_Service_Request_A00}}"
APPLICATION_ID="${APPLICATION_ID:-${ITSM_APP_ID}}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"

apply_template_branding_from_pg

log "Querying summary metrics from PostgreSQL (latest snapshot, Refex entity only)"

SUMMARY_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.snapshot_run
  WHERE application_id = '${ITSM_APP_ID}'
    AND process_id = '${ITSM_PROCESS_ID}'
    AND environment = 'production'
    AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  ORDER BY COALESCE(load_completed_at, extraction_completed_at, created_at) DESC
  LIMIT 1
),
sla AS (
  SELECT
    instance_id,
    process_status,
    (source_payload->'Closure_Time'->>'Closure_Time')::numeric AS sla_target_minutes,
    (source_payload->>'_created_at')::timestamptz AS created_at,
    NULLIF(source_payload->>'_completed_at','')::timestamptz AS completed_at
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id AND i.entity = 'Refex'
)
SELECT json_build_object(
  'total_users', (SELECT count(*) FROM engagement_reporting.\"user\" u, latest l WHERE u.snapshot_run_id = l.snapshot_run_id),
  'signed_in_users', (SELECT count(*) FROM engagement_reporting.\"user\" u, latest l WHERE u.snapshot_run_id = l.snapshot_run_id AND u.ever_logged_in),
  'signed_in_today', (SELECT count(*) FROM engagement_reporting.\"user\" u, latest l WHERE u.snapshot_run_id = l.snapshot_run_id AND (u.last_sign_in AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'never_logged_in', (SELECT count(*) FROM engagement_reporting.\"user\" u, latest l WHERE u.snapshot_run_id = l.snapshot_run_id AND NOT u.ever_logged_in),
  'opened_today', (SELECT count(*) FROM sla WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'closed_today', (SELECT count(*) FROM sla WHERE process_status = 'Completed' AND completed_at IS NOT NULL AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'total_tickets', (SELECT count(*) FROM sla),
  'sla_breached_open', (SELECT count(*) FROM sla WHERE process_status = 'InProgress' AND sla_target_minutes IS NOT NULL AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes),
  'sla_breached_closed', (SELECT count(*) FROM sla WHERE process_status = 'Completed' AND sla_target_minutes IS NOT NULL AND completed_at IS NOT NULL AND EXTRACT(EPOCH FROM (completed_at - created_at)) / 60 > sla_target_minutes)
);
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

log "Querying per-user breakdown (latest snapshot, Refex entity only)"

USERS_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.snapshot_run
  WHERE application_id = '${ITSM_APP_ID}'
    AND process_id = '${ITSM_PROCESS_ID}'
    AND environment = 'production'
    AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  ORDER BY COALESCE(load_completed_at, extraction_completed_at, created_at) DESC
  LIMIT 1
)
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
  SELECT
    u.user_name,
    to_char(u.last_sign_in AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS last_sign_in,
    u.ever_logged_in,
    COALESCE(open_t.open_count, 0) AS open_count,
    COALESCE(closed_t.closed_count, 0) AS closed_count
  FROM engagement_reporting.\"user\" u
  INNER JOIN latest l ON u.snapshot_run_id = l.snapshot_run_id
  LEFT JOIN (
    SELECT ia.principal_id AS user_id, count(*) AS open_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    WHERE ia.principal_type = 'USER' AND i.process_status = 'InProgress' AND i.entity = 'Refex'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    GROUP BY ia.principal_id
  ) open_t ON open_t.user_id = u.user_id
  LEFT JOIN (
    SELECT (source_payload->'_created_by'->>'_id') AS user_id, count(*) AS closed_count
    FROM engagement_reporting.item
    WHERE process_status = 'Completed' AND entity = 'Refex'
      AND snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    GROUP BY (source_payload->'_created_by'->>'_id')
  ) closed_t ON closed_t.user_id = u.user_id
  WHERE (COALESCE(open_t.open_count,0) > 0 OR COALESCE(closed_t.closed_count,0) > 0)
  ORDER BY open_count DESC, closed_count DESC
) t;
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

[[ -n "${SUMMARY_JSON}" ]] || stop "Failed to retrieve summary metrics."
[[ -n "${USERS_JSON}" ]] || stop "Failed to retrieve user breakdown."

log "Rendering HTML report"

ROWS_HTML="$(jq -r '
  to_entries | map(
    "<tr style=\"background-color:" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + ";\" bgcolor=\"" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + "\">" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.user_name // "Unknown") + "</td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.last_sign_in // "Never") + "</td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.open_count | tostring) + "</b></td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.closed_count | tostring) + "</td>" +
    "</tr>"
  ) | join("")
' <<< "${USERS_JSON}")"

TOTAL_USERS="$(jq -r '.total_users' <<< "${SUMMARY_JSON}")"
SIGNED_IN="$(jq -r '.signed_in_users' <<< "${SUMMARY_JSON}")"
SIGNIN_PCT="$(jq -n --argjson s "${SUMMARY_JSON}" '(($s.signed_in_users // 0) * 100 / (($s.total_users // 1)) ) | floor')"
SIGNED_IN_TODAY="$(jq -r '.signed_in_today' <<< "${SUMMARY_JSON}")"
SIGNIN_RATE_TODAY="$(jq -n --argjson s "${SUMMARY_JSON}" '(($s.signed_in_today // 0) * 100 / (($s.total_users // 1)) ) | floor')"
NEVER_LOGGED_IN="$(jq -r '.never_logged_in' <<< "${SUMMARY_JSON}")"
OPENED_TODAY="$(jq -r '.opened_today' <<< "${SUMMARY_JSON}")"
CLOSED_TODAY="$(jq -r '.closed_today' <<< "${SUMMARY_JSON}")"

TOTAL_OPEN="$(jq '[.[].open_count] | add // 0' <<< "${USERS_JSON}")"
TOTAL_CLOSED="$(jq '[.[].closed_count] | add // 0' <<< "${USERS_JSON}")"
TOTAL_TICKETS="$(jq -r '.total_tickets' <<< "${SUMMARY_JSON}")"
SLA_BREACHED_OPEN="$(jq -r '.sla_breached_open' <<< "${SUMMARY_JSON}")"
SLA_BREACHED_CLOSED="$(jq -r '.sla_breached_closed' <<< "${SUMMARY_JSON}")"
SLA_BREACHED_TOTAL="$(( SLA_BREACHED_OPEN + SLA_BREACHED_CLOSED ))"

GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

log "Rendering HTML from published template (PostgreSQL or seed fallback)"

TEMPLATE_SRC="$(mktemp)"
VARS_JSON="$(mktemp)"
trap 'rm -f "${TEMPLATE_SRC}" "${VARS_JSON}"' EXIT

report_template_load_html "${TEMPLATE_SRC}" || stop "Failed to load ITSM report template HTML."

jq -n \
  --arg ReportTitle "Kissflow User Engagement Report" \
  --arg ReportDate "${GENERATED_AT_DISPLAY}" \
  --arg SignedInUsers "${SIGNED_IN}" \
  --arg SignInRate "${SIGNIN_PCT}" \
  --arg SignedInToday "${SIGNED_IN_TODAY}" \
  --arg SignInRateToday "${SIGNIN_RATE_TODAY}" \
  --arg NeverSignedIn "${NEVER_LOGGED_IN}" \
  --arg TotalUsers "${TOTAL_USERS}" \
  --arg TotalTickets "${TOTAL_TICKETS}" \
  --arg OpenTickets "${TOTAL_OPEN}" \
  --arg ClosedTickets "${TOTAL_CLOSED}" \
  --arg SlaBreachedTotal "${SLA_BREACHED_TOTAL}" \
  --arg SlaBreachedOpen "${SLA_BREACHED_OPEN}" \
  --arg SlaBreachedClosed "${SLA_BREACHED_CLOSED}" \
  --arg OpenedToday "${OPENED_TODAY}" \
  --arg ClosedToday "${CLOSED_TODAY}" \
  --arg UserTableHtml "${ROWS_HTML}" \
  --arg ReportBody "Scoped to Entity = Refex only. SLA Breached compares actual ticket duration against the configured SLA target from Kissflow's Approval Matrix." \
  '{
    ReportTitle: $ReportTitle,
    ReportDate: $ReportDate,
    SignedInUsers: $SignedInUsers,
    SignInRate: $SignInRate,
    SignedInToday: $SignedInToday,
    SignInRateToday: $SignInRateToday,
    NeverSignedIn: $NeverSignedIn,
    TotalUsers: $TotalUsers,
    TotalTickets: $TotalTickets,
    OpenTickets: $OpenTickets,
    ClosedTickets: $ClosedTickets,
    SlaBreachedTotal: $SlaBreachedTotal,
    SlaBreachedOpen: $SlaBreachedOpen,
    SlaBreachedClosed: $SlaBreachedClosed,
    OpenedToday: $OpenedToday,
    ClosedToday: $ClosedToday,
    UserTableHtml: $UserTableHtml,
    ReportBody: $ReportBody
  }' > "${VARS_JSON}"

report_template_render "${OUTPUT_FILE}" "${VARS_JSON}" "${TEMPLATE_SRC}" \
  || stop "Failed to render ITSM report template."

cp "${OUTPUT_FILE}" "${LATEST_FILE}"

jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg output_file "${OUTPUT_FILE}" \
  --argjson summary "${SUMMARY_JSON}" \
  --argjson total_open "${TOTAL_OPEN}" \
  --argjson total_closed "${TOTAL_CLOSED}" '
{
  action: "RENDER_HTML_REPORT",
  generated_at: $generated_at,
  output_file: $output_file,
  mutation_performed: false,
  summary: ($summary + {total_open: $total_open, total_closed: $total_closed})
}
' > "${AUDIT_FILE}"

log "Report rendered successfully"
printf '\nOutput file:\n%s\n' "${OUTPUT_FILE}"
printf '\nLatest (stable path):\n%s\n' "${LATEST_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
