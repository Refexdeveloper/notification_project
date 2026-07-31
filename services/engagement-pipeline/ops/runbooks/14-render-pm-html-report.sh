#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
TEMPLATES_DIR="${REPO_ROOT}/templates/generated"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-14"

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
      AND i.process_status = 'InProgress'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    GROUP BY ia.principal_id
  ) pending_t ON pending_t.user_id = u.user_id
  LEFT JOIN (
    SELECT ia.principal_id AS user_id, count(*) AS completed_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i
      ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    WHERE ia.process_id = '${PM_PROCESS_ID}'
      AND i.process_status = 'Completed'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    GROUP BY ia.principal_id
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
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.last_sign_in // "Never") + "</td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.pending_count | tostring) + "</b></td>" +
    "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.completed_count | tostring) + "</td>" +
    "</tr>"
  ) | join("")
' <<< "${PM_USERS_JSON}")"

PM_TOTAL="$(jq -r '.total_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_ASSIGNED="$(jq -r '.assigned_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_PENDING="$(jq -r '.pending_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_COMPLETED="$(jq -r '.completed_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_OPENED_TODAY="$(jq -r '.opened_today' <<< "${PM_SUMMARY_JSON}")"
PM_CLOSED_TODAY="$(jq -r '.closed_today' <<< "${PM_SUMMARY_JSON}")"

GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

ensure_refexone_logo

cat > "${OUTPUT_FILE}" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Project Management Task Report</title>
</head>
<body style="margin:0; padding:0; background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="background-color:#ffffff !important; border-radius:10px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.10);" bgcolor="#ffffff">

<tr><td style="background:linear-gradient(180deg,#ffffff 0%,#f7f7f6 100%) !important; padding:26px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="180" valign="middle">
<img src="${LOGO_URL}" alt="refexOne" width="168" style="display:block; max-width:168px; height:auto;">
</td>
<td valign="middle" style="padding-left:18px; border-left:1px solid #e5e5e0;">
<div style="font-size:18px; font-weight:bold; color:#1a1a1a !important;">Project Management Task Report</div>
<div style="font-size:12px; color:#6b6b6b !important; margin-top:4px;">Project Task &middot; Project Management Tracker</div>
<div style="font-size:12px; color:#6b6b6b !important; margin-top:2px;">Generated ${GENERATED_AT_DISPLAY}</div>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:0; line-height:0;">
<img src="${DIVIDER_GIF_URL}" alt="" width="680" height="6" style="display:block; width:100%; height:6px; border:0;">
</td></tr>

<tr><td style="padding:24px 32px 6px 32px;" bgcolor="#ffffff">
<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Task Summary</div>
</td></tr>
<tr><td style="padding:8px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="23%" align="center" style="background:linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%) !important; border:1px solid #dfe8f2; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(30,80,160,0.06);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${PM_TOTAL}</div>
<div style="font-size:10.5px; color:#5b7ba3 !important; margin-top:4px;">Total Tasks</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#f2f0fb 0%,#e6e0f5 100%) !important; border:1px solid #d8ceec; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(90,60,160,0.07);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${PM_ASSIGNED}</div>
<div style="font-size:10.5px; color:#6a53a3 !important; margin-top:4px;">Assigned Tasks</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#fffaf2 0%,#fef3e2 100%) !important; border:1px solid #f2e2c4; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(180,120,20,0.07);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${PM_PENDING}</div>
<div style="font-size:10.5px; color:#9a7a3a !important; margin-top:4px;">Pending Tasks</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#f4fbf5 0%,#e0f5e8 100%) !important; border:1px solid #c7ead4; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(26,140,92,0.08);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${PM_COMPLETED}</div>
<div style="font-size:10.5px; color:#3f8f63 !important; margin-top:4px;">Completed Tasks</div></td>
</tr></table></td></tr>

<tr><td style="padding:22px 32px 6px 32px;" bgcolor="#ffffff">
<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Today's Task Activity</div>
</td></tr>
<tr><td style="padding:10px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="48%" align="center" style="background:linear-gradient(180deg,#f2f0fb 0%,#e2d9f5 100%) !important; border:1px solid #cdb8e8; border-radius:10px; padding:26px 10px; box-shadow:0 3px 10px rgba(90,60,160,0.10);">
<div style="font-size:30px; font-weight:bold; color:#6a3fa8 !important;">${PM_OPENED_TODAY}</div>
<div style="font-size:12px; color:#6a3fa8 !important; margin-top:6px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Opened Today</div></td>
<td width="4%"></td>
<td width="48%" align="center" style="background:linear-gradient(180deg,#f2f6fb 0%,#dfeafa 100%) !important; border:1px solid #bcd6f0; border-radius:10px; padding:26px 10px; box-shadow:0 3px 10px rgba(30,80,160,0.10);">
<div style="font-size:30px; font-weight:bold; color:#3468a8 !important;">${PM_CLOSED_TODAY}</div>
<div style="font-size:12px; color:#3468a8 !important; margin-top:6px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Closed Today</div></td>
</tr></table></td></tr>

<tr><td style="padding:26px 32px 6px 32px; font-size:13.5px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">Users with pending or recent activity</td></tr>
<tr><td style="padding:8px 32px 28px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12.5px; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
<tr style="background:linear-gradient(90deg,#4b2e83 0%,#7b52c9 100%) !important;" bgcolor="#4b2e83">
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;">User</td>
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;">Last Signed In</td>
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;" align="center">Pending</td>
<td style="padding:12px 14px; color:#ffffff !important; font-weight:bold;" align="center">Completed</td>
</tr>
${PM_ROWS_HTML}
</table></td></tr>

<tr><td style="padding:4px 32px 24px 32px; font-size:11px; color:#a0a0a0 !important; line-height:1.6;" bgcolor="#ffffff">
Project Tracker covers all entities group-wide.
</td></tr>

<tr><td style="background-color:#faf9f7 !important; padding:18px 32px; border-top:1px solid #ececea; font-size:11px; color:#a0a0a0 !important;" bgcolor="#faf9f7">
Refex Project Management Report &middot; Automated &middot; Do not reply to this email
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML

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
