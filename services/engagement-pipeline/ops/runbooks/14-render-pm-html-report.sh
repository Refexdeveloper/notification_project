#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
TEMPLATES_DIR="${REPO_ROOT}/templates/generated"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-14"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/report-template-lib.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
OUTPUT_FILE="${TEMPLATES_DIR}/pm-report-${TIMESTAMP}.html"
LATEST_FILE="${TEMPLATES_DIR}/pm-report-latest.html"
AUDIT_FILE="${AUDIT_DIR}/runbook-14-${TIMESTAMP}.json"

LOGO_URL="https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png"
DIVIDER_GIF_URL="https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif"
REFEXONE_LOGO_URL="${LOGO_URL}"

PG_CONN_STRING="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

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

PM_APP_ID="${PM_APP_ID:-Project_Management_Tracker_A00}"
PM_PROCESS_ID="${PM_PROCESS_ID:-${PROCESS_ID:-Project_Sub_Task_A01}}"
APPLICATION_ID="${APPLICATION_ID:-${PM_APP_ID}}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"

apply_template_branding_from_pg

log "Querying Project Management task summary"

PM_SUMMARY_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.snapshot_run
  WHERE application_id = '${PM_APP_ID}'
    AND process_id = '${PM_PROCESS_ID}'
    AND environment = 'production'
    AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  ORDER BY COALESCE(load_completed_at, extraction_completed_at, created_at) DESC
  LIMIT 1
),
tasks AS (
  SELECT
    instance_id,
    process_status,
    (source_payload->>'_created_at')::timestamptz AS created_at,
    NULLIF(source_payload->>'_completed_at','')::timestamptz AS completed_at
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id
    AND i.process_id = '${PM_PROCESS_ID}'
),
latest_users AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.\"user\"
  ORDER BY snapshot_at DESC
  LIMIT 1
),
pm_process_roles AS (
  SELECT DISTINCT ia.principal_id AS role_id
  FROM engagement_reporting.item_assignment ia, latest l
  WHERE ia.snapshot_run_id = l.snapshot_run_id
    AND ia.process_id = '${PM_PROCESS_ID}'
    AND ia.principal_type = 'APP_ROLE'
),
pm_role_members AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.application_id = '${PM_APP_ID}'
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
  UNION
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  JOIN pm_process_roles pr ON pr.role_id = pu.principal_id
  WHERE pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
),
pm_app_users AS (
  SELECT user_id FROM pm_role_members
  UNION
  SELECT DISTINCT ia.principal_id AS user_id
  FROM engagement_reporting.item_assignment ia, latest l
  WHERE ia.snapshot_run_id = l.snapshot_run_id
    AND ia.process_id = '${PM_PROCESS_ID}'
    AND ia.principal_type = 'USER'
    AND ia.principal_id IS NOT NULL
    AND trim(ia.principal_id) <> ''
    AND NOT EXISTS (SELECT 1 FROM pm_role_members)
)
SELECT json_build_object(
  'total_tasks', (SELECT count(*) FROM tasks),
  'assigned_tasks', (
    SELECT count(DISTINCT ia.instance_id)
    FROM engagement_reporting.item_assignment ia, latest l
    WHERE ia.snapshot_run_id = l.snapshot_run_id
      AND ia.process_id = '${PM_PROCESS_ID}'
  ),
  'pending_tasks', (SELECT count(*) FROM tasks WHERE process_status = 'InProgress'),
  'completed_tasks', (SELECT count(*) FROM tasks WHERE process_status = 'Completed'),
  'opened_today', (
    SELECT count(*) FROM tasks
    WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ),
  'closed_today', (
    SELECT count(*) FROM tasks
    WHERE process_status = 'Completed'
      AND completed_at IS NOT NULL
      AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ),
  'total_app_users', (SELECT count(*) FROM pm_app_users),
  'signed_in_today', (
    SELECT count(*)
    FROM engagement_reporting.\"user\" u
    JOIN latest_users lu ON u.snapshot_run_id = lu.snapshot_run_id
    JOIN pm_app_users pu ON pu.user_id = u.user_id
    WHERE u.last_sign_in IS NOT NULL
      AND (u.last_sign_in AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date
  )
);
" | psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

log "Querying Project Management per-user breakdown"

PM_USERS_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.snapshot_run
  WHERE application_id = '${PM_APP_ID}'
    AND process_id = '${PM_PROCESS_ID}'
    AND environment = 'production'
    AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  ORDER BY COALESCE(load_completed_at, extraction_completed_at, created_at) DESC
  LIMIT 1
),
latest_users AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.\"user\"
  ORDER BY snapshot_at DESC
  LIMIT 1
)
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
  SELECT
    u.user_name,
    to_char(u.last_sign_in AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS last_sign_in,
    COALESCE(pending_t.pending_count, 0) AS pending_count,
    COALESCE(completed_t.completed_count, 0) AS completed_count
  FROM engagement_reporting.\"user\" u
  JOIN latest_users lu ON u.snapshot_run_id = lu.snapshot_run_id
  LEFT JOIN (
    SELECT ia.principal_id AS user_id, count(*) AS pending_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i
      ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    WHERE ia.process_id = '${PM_PROCESS_ID}'
      AND ia.principal_type = 'USER'
      AND i.process_status = 'InProgress'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    GROUP BY ia.principal_id
  ) pending_t ON pending_t.user_id = u.user_id
  LEFT JOIN (
    SELECT assignee_id AS user_id, count(*) AS completed_count
    FROM (
      SELECT DISTINCT ON (i.instance_id)
        i.instance_id,
        COALESCE(
          NULLIF(i.source_payload->'Assigned_To'->>'_id', ''),
          NULLIF(ia.principal_id, ''),
          NULLIF(i.source_payload->'_modified_by'->>'_id', '')
        ) AS assignee_id
      FROM engagement_reporting.item i
      LEFT JOIN engagement_reporting.item_assignment ia
        ON ia.instance_id = i.instance_id
       AND ia.snapshot_at = i.snapshot_at
       AND ia.principal_type = 'USER'
       AND ia.snapshot_run_id = i.snapshot_run_id
      WHERE i.process_id = '${PM_PROCESS_ID}'
        AND i.process_status = 'Completed'
        AND i.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      ORDER BY i.instance_id, ia.principal_id NULLS LAST
    ) completed_items
    WHERE assignee_id IS NOT NULL
    GROUP BY assignee_id
  ) completed_t ON completed_t.user_id = u.user_id
  WHERE (COALESCE(pending_t.pending_count,0) > 0 OR COALESCE(completed_t.completed_count,0) > 0)
  ORDER BY pending_count DESC, completed_count DESC
) t;
" | psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

[[ -n "${PM_SUMMARY_JSON}" ]] || stop "Failed to retrieve PM summary."
[[ -n "${PM_USERS_JSON}" ]] || stop "Failed to retrieve PM user breakdown."

log "Rendering PM HTML report"

PM_ROWS_HTML="$(jq -r '
  to_entries | map(
    "<tr style=\"background-color:" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + ";\" bgcolor=\"" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + "\">" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.user_name // "Unknown") + "</td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + ((.value.last_sign_in // "") | if . == "" or . == "Never" then "-" else . end) + "</td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.pending_count | tostring) + "</b></td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.completed_count | tostring) + "</td>" +
    "</tr>"
  ) | join("")
' <<< "${PM_USERS_JSON}")"

PM_TOTAL="$(jq -r '.total_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_PENDING="$(jq -r '.pending_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_COMPLETED="$(jq -r '.completed_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_OPENED_TODAY="$(jq -r '.opened_today' <<< "${PM_SUMMARY_JSON}")"
PM_CLOSED_TODAY="$(jq -r '.closed_today' <<< "${PM_SUMMARY_JSON}")"
PM_TOTAL_USERS="$(jq -r '.total_app_users // 0' <<< "${PM_SUMMARY_JSON}")"
PM_SIGNED_IN_TODAY="$(jq -r '.signed_in_today // 0' <<< "${PM_SUMMARY_JSON}")"

GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

log "Rendering PM HTML from published template (PostgreSQL or seed fallback)"

TEMPLATE_SRC="$(mktemp)"
VARS_JSON="$(mktemp)"
trap 'rm -f "${TEMPLATE_SRC}" "${VARS_JSON}"' EXIT

report_template_load_html "${TEMPLATE_SRC}" || stop "Failed to load PM report template HTML."

REPORT_TITLE="${TEMPLATE_NAME:-}"
if [[ -z "${REPORT_TITLE}" ]]; then
  REPORT_TITLE="${SUBJECT:-Project Management Task Report}"
fi

jq -n \
  --arg ReportTitle "${REPORT_TITLE}" \
  --arg ReportDate "${GENERATED_AT_DISPLAY}" \
  --arg TotalTasks "${PM_TOTAL}" \
  --arg PendingTasks "${PM_PENDING}" \
  --arg CompletedTasks "${PM_COMPLETED}" \
  --arg OpenedToday "${PM_OPENED_TODAY}" \
  --arg ClosedToday "${PM_CLOSED_TODAY}" \
  --arg TotalUsers "${PM_TOTAL_USERS}" \
  --arg SignedInToday "${PM_SIGNED_IN_TODAY}" \
  --arg UserTableHtml "${PM_ROWS_HTML}" \
  --arg ReportBody "Project Tracker covers all entities group-wide." \
  '{
    ReportTitle: $ReportTitle,
    ReportDate: $ReportDate,
    TotalTasks: $TotalTasks,
    PendingTasks: $PendingTasks,
    CompletedTasks: $CompletedTasks,
    OpenedToday: $OpenedToday,
    ClosedToday: $ClosedToday,
    TotalUsers: $TotalUsers,
    SignedInToday: $SignedInToday,
    UserTableHtml: $UserTableHtml,
    ReportBody: $ReportBody
  }' > "${VARS_JSON}"

report_template_render "${OUTPUT_FILE}" "${VARS_JSON}" "${TEMPLATE_SRC}" \
  || stop "Failed to render PM report template."

cp "${OUTPUT_FILE}" "${LATEST_FILE}"

jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg output_file "${OUTPUT_FILE}" \
  --argjson summary "${PM_SUMMARY_JSON}" \
  --argjson user_count "$(jq 'length' <<< "${PM_USERS_JSON}")" '
{
  action: "RENDER_PM_HTML_REPORT",
  generated_at: $generated_at,
  output_file: $output_file,
  mutation_performed: false,
  summary: $summary,
  active_users_in_table: $user_count
}
' > "${AUDIT_FILE}"

log "PM report rendered successfully"
printf '\nOutput file:\n%s\n' "${OUTPUT_FILE}"
printf '\nLatest (stable path):\n%s\n' "${LATEST_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
