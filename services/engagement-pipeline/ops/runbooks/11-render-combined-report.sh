#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
TEMPLATES_DIR="${REPO_ROOT}/templates/generated"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-11"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/report-template-lib.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
OUTPUT_FILE="${TEMPLATES_DIR}/combined-report-${TIMESTAMP}.html"
LATEST_FILE="${TEMPLATES_DIR}/combined-report-latest.html"
AUDIT_FILE="${AUDIT_DIR}/runbook-11-${TIMESTAMP}.json"

LOGO_URL="https://storage.googleapis.com/aasik-refex-report-assets/refexone-logo.png"
DIVIDER_GIF_URL="https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif"

ITSM_APP_ID="IT_Service_Management_A00"
ITSM_PROCESS_ID="Live_IT_Service_Request_A00"
PM_APP_ID="Project_Management_Tracker_A00"
PM_PROCESS_ID="Project_Sub_Task_A01"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"
refresh_user_last_sign_ins_for_process "${ITSM_APP_ID}" "${ITSM_PROCESS_ID}"
refresh_user_last_sign_ins_for_process "${PM_APP_ID}" "${PM_PROCESS_ID}"

log "Querying Refex ITSM role-member sign-in overview"

USER_SUMMARY_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest_users AS (
  SELECT snapshot_run_id FROM engagement_reporting.\"user\" ORDER BY snapshot_at DESC LIMIT 1
),
latest AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.snapshot_run
  WHERE application_id = '${ITSM_APP_ID}'
    AND process_id = '${ITSM_PROCESS_ID}'
  ORDER BY created_at DESC
  LIMIT 1
),
process_roles AS (
  SELECT DISTINCT ia.principal_id AS role_id
  FROM engagement_reporting.item_assignment ia
  JOIN engagement_reporting.item i
    ON i.instance_id = ia.instance_id
   AND i.snapshot_at = ia.snapshot_at
   AND i.snapshot_run_id = ia.snapshot_run_id
  WHERE ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    AND ia.principal_type = 'APP_ROLE'
    AND i.entity = 'Refex'
),
app_members AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  JOIN engagement_reporting.principal p
    ON p.environment = pu.environment
   AND p.application_id = pu.application_id
   AND p.principal_id = pu.principal_id
   AND p.principal_type = pu.principal_type
   AND p.is_current = true
  WHERE pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
    AND lower(coalesce(p.principal_name, p.principal_id, '')) LIKE '%refex%'
    AND lower(coalesce(p.principal_name, p.principal_id, '')) NOT LIKE '%extrovis%'
  UNION
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  JOIN process_roles pr ON pr.role_id = pu.principal_id
  WHERE pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
)
SELECT json_build_object(
  'total_users', (SELECT count(*) FROM app_members),
  'signed_in_users', (
    SELECT count(*)
    FROM ${REPORT_BEST_USER_FROM_SQL}
    JOIN app_members am ON am.user_id = u.user_id
    WHERE COALESCE(u.ever_logged_in, false)
  ),
  'signed_in_today', (
    SELECT count(*)
    FROM ${REPORT_BEST_USER_FROM_SQL}
    JOIN app_members am ON am.user_id = u.user_id
    WHERE ${REPORT_USER_LAST_SIGN_IN_SQL} IS NOT NULL
      AND (${REPORT_USER_LAST_SIGN_IN_SQL} AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ),
  'never_logged_in', (
    SELECT count(*)
    FROM ${REPORT_BEST_USER_FROM_SQL}
    JOIN app_members am ON am.user_id = u.user_id
    WHERE NOT COALESCE(u.ever_logged_in, false)
  )
);
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

log "Querying ITSM ticket summary"

ITSM_SUMMARY_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (SELECT snapshot_run_id FROM engagement_reporting.snapshot_run WHERE application_id = '${ITSM_APP_ID}' AND process_id = '${ITSM_PROCESS_ID}' ORDER BY created_at DESC LIMIT 1),
sla AS (
  SELECT instance_id, process_status,
    (source_payload->'Closure_Time'->>'Closure_Time')::numeric AS sla_target_minutes,
    (${REPORT_ITEM_CREATED_AT_SQL}) AS created_at,
    (${REPORT_ITEM_COMPLETED_AT_SQL}) AS completed_at,
    (
      process_status = 'Completed'
      OR (
        process_status = 'InProgress'
        AND lower(trim(coalesce(current_step, source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
      )
    ) AS is_closed,
    (
      process_status = 'InProgress'
      AND lower(trim(coalesce(current_step, source_payload->>'_current_step', ''))) NOT LIKE '%it tech reopen%'
    ) AS is_open
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id AND i.entity = 'Refex'
)
SELECT json_build_object(
  'total_tickets', (SELECT count(*) FROM sla),
  'open_tickets', (SELECT count(*) FROM sla WHERE is_open),
  'closed_tickets', (SELECT count(*) FROM sla WHERE is_closed),
  'sla_breached_open', (SELECT count(*) FROM sla WHERE is_open AND sla_target_minutes IS NOT NULL AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes),
  'sla_breached_closed', (SELECT count(*) FROM sla WHERE is_closed AND sla_target_minutes IS NOT NULL AND completed_at IS NOT NULL AND EXTRACT(EPOCH FROM (completed_at - created_at)) / 60 > sla_target_minutes),
  'opened_today', (SELECT count(*) FROM sla WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'closed_today', (SELECT count(*) FROM sla WHERE is_closed AND completed_at IS NOT NULL AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)
);
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

log "Querying ITSM per-user breakdown"

ITSM_USERS_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (SELECT snapshot_run_id FROM engagement_reporting.snapshot_run WHERE application_id = '${ITSM_APP_ID}' AND process_id = '${ITSM_PROCESS_ID}' ORDER BY created_at DESC LIMIT 1),
latest_users AS (SELECT snapshot_run_id FROM engagement_reporting.\"user\" ORDER BY snapshot_at DESC LIMIT 1)
SELECT json_agg(t) FROM (
  SELECT
    u.user_name,
    ${REPORT_USER_LAST_SIGN_IN_IST_SQL} AS last_sign_in,
    COALESCE(open_t.open_count, 0) AS open_count,
    COALESCE(closed_t.closed_count, 0) AS closed_count
  FROM ${REPORT_BEST_USER_FROM_SQL}
  LEFT JOIN (
    SELECT ia.principal_id AS user_id, count(*) AS open_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    WHERE ia.principal_type = 'USER'
      AND i.entity = 'Refex'
      AND i.process_status = 'InProgress'
      AND lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) NOT LIKE '%it tech reopen%'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    GROUP BY ia.principal_id
  ) open_t ON open_t.user_id = u.user_id
  LEFT JOIN (
    SELECT (source_payload->'_created_by'->>'_id') AS user_id, count(*) AS closed_count
    FROM engagement_reporting.item
    WHERE entity = 'Refex'
      AND snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      AND (
        process_status = 'Completed'
        OR (
          process_status = 'InProgress'
          AND lower(trim(coalesce(current_step, source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
        )
      )
    GROUP BY (source_payload->'_created_by'->>'_id')
  ) closed_t ON closed_t.user_id = u.user_id
  WHERE (COALESCE(open_t.open_count,0) > 0 OR COALESCE(closed_t.closed_count,0) > 0)
  ORDER BY open_count DESC, closed_count DESC
) t;
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

log "Querying Project Management task summary"

PM_SUMMARY_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (SELECT snapshot_run_id FROM engagement_reporting.snapshot_run WHERE application_id = '${PM_APP_ID}' AND process_id = '${PM_PROCESS_ID}' ORDER BY created_at DESC LIMIT 1),
tasks AS (SELECT instance_id, process_status, current_step, (${REPORT_ITEM_CREATED_AT_SQL}) AS created_at, (${REPORT_ITEM_COMPLETED_AT_SQL}) AS completed_at FROM engagement_reporting.item i, latest l WHERE i.snapshot_run_id = l.snapshot_run_id AND i.process_id = '${PM_PROCESS_ID}')
SELECT json_build_object(
  'total_tasks', (SELECT count(*) FROM tasks),
  'assigned_tasks', (SELECT count(DISTINCT ia.instance_id) FROM engagement_reporting.item_assignment ia, latest l WHERE ia.snapshot_run_id = l.snapshot_run_id AND ia.process_id = '${PM_PROCESS_ID}'),
  'pending_tasks', (SELECT count(*) FROM tasks WHERE process_status = 'InProgress'),
  'completed_tasks', (SELECT count(*) FROM tasks WHERE process_status = 'Completed'),
  'opened_today', (SELECT count(*) FROM tasks WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'closed_today', (SELECT count(*) FROM tasks WHERE process_status = 'Completed' AND completed_at IS NOT NULL AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)
);
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

log "Querying Project Management per-user breakdown"

PM_USERS_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH latest AS (SELECT snapshot_run_id FROM engagement_reporting.snapshot_run WHERE application_id = '${PM_APP_ID}' AND process_id = '${PM_PROCESS_ID}' ORDER BY created_at DESC LIMIT 1),
latest_users AS (SELECT snapshot_run_id FROM engagement_reporting.\"user\" ORDER BY snapshot_at DESC LIMIT 1)
SELECT json_agg(t) FROM (
  SELECT
    u.user_name,
    ${REPORT_USER_LAST_SIGN_IN_IST_SQL} AS last_sign_in,
    COALESCE(pending_t.pending_count, 0) AS pending_count,
    COALESCE(completed_t.completed_count, 0) AS completed_count
  FROM ${REPORT_BEST_USER_FROM_SQL}
  LEFT JOIN (
    SELECT ia.principal_id AS user_id, count(*) AS pending_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    WHERE ia.process_id = '${PM_PROCESS_ID}' AND i.process_status = 'InProgress'
      AND ia.principal_type = 'USER'
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
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

[[ -n "${USER_SUMMARY_JSON}" ]] || stop "Failed to retrieve user summary."
[[ -n "${ITSM_SUMMARY_JSON}" ]] || stop "Failed to retrieve ITSM summary."
[[ -n "${PM_SUMMARY_JSON}" ]] || stop "Failed to retrieve PM summary."

log "Rendering combined HTML report"

TODAY_IST="$(TZ='Asia/Kolkata' date +'%Y-%m-%d')"
MIS_COUNTS="$(jq -c --arg today "${TODAY_IST}" '
  [ .[] | select((.user_name // "") | tostring | length > 0) ] as $rows
  | {
      total: ($rows | length),
      signed_in_today: (
        [$rows[] | select((.last_sign_in // "") | tostring | startswith($today))] | length
      )
    }
' <<< "${ITSM_USERS_JSON}")"
TOTAL_USERS="$(jq -r '.total' <<< "${MIS_COUNTS}")"
SIGNED_IN="$(jq -r '.signed_in_users' <<< "${USER_SUMMARY_JSON}")"
SIGNIN_PCT="$(jq 'if (.total // 0) <= 0 then 0 else ((.signed_in_today // 0) * 100 / .total) | floor end' <<< "${MIS_COUNTS}")"
SIGNED_IN_TODAY="$(jq -r '.signed_in_today' <<< "${MIS_COUNTS}")"
NEVER_LOGGED_IN="$(jq -r '.never_logged_in' <<< "${USER_SUMMARY_JSON}")"

ITSM_TOTAL="$(jq -r '.total_tickets' <<< "${ITSM_SUMMARY_JSON}")"
ITSM_OPEN="$(jq -r '.open_tickets' <<< "${ITSM_SUMMARY_JSON}")"
ITSM_CLOSED="$(jq -r '.closed_tickets' <<< "${ITSM_SUMMARY_JSON}")"
ITSM_SLA_OPEN="$(jq -r '.sla_breached_open' <<< "${ITSM_SUMMARY_JSON}")"
ITSM_SLA_CLOSED="$(jq -r '.sla_breached_closed' <<< "${ITSM_SUMMARY_JSON}")"
ITSM_SLA_TOTAL="$(( ITSM_SLA_OPEN + ITSM_SLA_CLOSED ))"
ITSM_OPENED_TODAY="$(jq -r '.opened_today' <<< "${ITSM_SUMMARY_JSON}")"
ITSM_CLOSED_TODAY="$(jq -r '.closed_today' <<< "${ITSM_SUMMARY_JSON}")"

PM_TOTAL="$(jq -r '.total_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_ASSIGNED="$(jq -r '.assigned_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_PENDING="$(jq -r '.pending_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_COMPLETED="$(jq -r '.completed_tasks' <<< "${PM_SUMMARY_JSON}")"
PM_OPENED_TODAY="$(jq -r '.opened_today' <<< "${PM_SUMMARY_JSON}")"
PM_CLOSED_TODAY="$(jq -r '.closed_today' <<< "${PM_SUMMARY_JSON}")"

ITSM_ROWS_HTML="$(jq -r '
  to_entries | map(
    "<tr style=\"background-color:" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + ";\" bgcolor=\"" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + "\">" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.user_name // "Unknown") + "</td>" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + ((.value.last_sign_in // "") | if . == "" or . == "Never" then "-" else . end) + "</td>" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.open_count | tostring) + "</b></td>" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.closed_count | tostring) + "</td>" +
    "</tr>"
  ) | join("")
' <<< "${ITSM_USERS_JSON}")"

PM_ROWS_HTML="$(jq -r '
  to_entries | map(
    "<tr style=\"background-color:" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + ";\" bgcolor=\"" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + "\">" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.user_name // "Unknown") + "</td>" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + ((.value.last_sign_in // "") | if . == "" or . == "Never" then "-" else . end) + "</td>" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.pending_count | tostring) + "</b></td>" +
    "<td style=\"padding:11px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.completed_count | tostring) + "</td>" +
    "</tr>"
  ) | join("")
' <<< "${PM_USERS_JSON}")"

GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

cat > "${OUTPUT_FILE}" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Refex Kissflow Engagement Report</title>
</head>
<body style="margin:0; padding:0; background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef0f2 !important;" bgcolor="#eef0f2">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="background-color:#ffffff !important; border-radius:10px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.10);" bgcolor="#ffffff">

<tr><td style="background:linear-gradient(180deg,#ffffff 0%,#f7f7f6 100%) !important; padding:26px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="120" valign="middle">
<img src="${LOGO_URL}" alt="Refex" width="100" style="display:block; max-width:100px; height:auto;">
</td>
<td valign="middle" style="padding-left:18px; border-left:1px solid #e5e5e0;">
<div style="font-size:18px; font-weight:bold; color:#1a1a1a !important;">Refex Kissflow Engagement Report</div>
<div style="font-size:12px; color:#6b6b6b !important; margin-top:4px;">IT Service Management &middot; Project Management Tracker</div>
<div style="font-size:12px; color:#6b6b6b !important; margin-top:2px;">Generated ${GENERATED_AT_DISPLAY}</div>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:0; line-height:0;">
<img src="${DIVIDER_GIF_URL}" alt="" width="680" height="6" style="display:block; width:100%; height:6px; border:0;">
</td></tr>

<tr><td style="padding:24px 32px 6px 32px;" bgcolor="#ffffff">
<div style="font-size:12px; font-weight:bold; color:#8a8a8a !important; text-transform:uppercase; letter-spacing:0.5px;">Shared User Sign-in Overview</div>
</td></tr>
<tr><td style="padding:8px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="23%" align="center" style="background:linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%) !important; border:1px solid #dfe8f2; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(30,80,160,0.06);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${TOTAL_USERS}</div>
<div style="font-size:10.5px; color:#5b7ba3 !important; margin-top:4px;">Total Users</div>
<div style="font-size:12px; font-weight:bold; color:#14503a !important; margin-top:2px; line-height:1.25;">${SIGNED_IN_TODAY} of ${TOTAL_USERS} today</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%) !important; border:1px solid #dfe8f2; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(30,80,160,0.06);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${SIGNED_IN}</div>
<div style="font-size:10.5px; color:#5b7ba3 !important; margin-top:4px;">Signed In</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#f0fbf4 0%,#e0f5e8 100%) !important; border:1px solid #c7ead4; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(26,140,92,0.08);">
<div style="font-size:20px; font-weight:bold; color:#1a8c5c !important;">${SIGNIN_PCT}%</div>
<div style="font-size:10.5px; color:#3f8f63 !important; margin-top:4px;">Sign-in Rate</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#f0fbf4 0%,#e0f5e8 100%) !important; border:1px solid #c7ead4; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(26,140,92,0.08);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${SIGNED_IN_TODAY}</div>
<div style="font-size:10.5px; color:#3f8f63 !important; margin-top:4px;">Signed In Today</div></td>
</tr></table></td></tr>

<tr><td style="padding:16px 32px 0 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(90deg,#fff7f0 0%,#fef2e6 100%) !important; border:1px solid #f3d9c4; border-radius:8px;" bgcolor="#fff7f0">
<tr><td style="padding:14px 18px; font-size:12.5px; color:#7a4a1a !important;">
<b>${NEVER_LOGGED_IN} of ${TOTAL_USERS} users</b> have never signed in to Kissflow.
</td></tr></table></td></tr>

<tr><td style="padding:28px 32px 0 32px;">
<div style="height:2px; background:linear-gradient(90deg,#14503a 0%,#1a8c5c 50%,#14503a 100%) !important; border-radius:2px;"></div>
</td></tr>

<tr><td style="padding:22px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td>
<span style="display:inline-block; background-color:#14503a !important; color:#ffffff !important; font-size:11px; font-weight:bold; padding:5px 12px; border-radius:20px; text-transform:uppercase; letter-spacing:0.4px;">IT Service Management</span>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:12px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="23%" align="center" style="background:linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%) !important; border:1px solid #dfe8f2; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(30,80,160,0.06);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${ITSM_TOTAL}</div>
<div style="font-size:10.5px; color:#5b7ba3 !important; margin-top:4px;">All Tickets</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#fffaf2 0%,#fef3e2 100%) !important; border:1px solid #f2e2c4; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(180,120,20,0.07);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${ITSM_OPEN}</div>
<div style="font-size:10.5px; color:#9a7a3a !important; margin-top:4px;">Open Tickets</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#f4fbf5 0%,#e0f5e8 100%) !important; border:1px solid #c7ead4; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(26,140,92,0.08);">
<div style="font-size:20px; font-weight:bold; color:#1a1a1a !important;">${ITSM_CLOSED}</div>
<div style="font-size:10.5px; color:#3f8f63 !important; margin-top:4px;">Closed Tickets</div></td>
<td width="2.6%"></td>
<td width="23%" align="center" style="background:linear-gradient(180deg,#fff5f5 0%,#ffe9e9 100%) !important; border:1px solid #f3cccc; border-radius:8px; padding:16px 4px; box-shadow:0 2px 6px rgba(200,16,46,0.08);">
<div style="font-size:20px; font-weight:bold; color:#c8102e !important;">${ITSM_SLA_TOTAL}</div>
<div style="font-size:10.5px; color:#a35560 !important; margin-top:4px;">SLA Breached</div>
<div style="font-size:9.5px; color:#a35560 !important; margin-top:2px;">Open ${ITSM_SLA_OPEN} &middot; Closed ${ITSM_SLA_CLOSED}</div></td>
</tr></table></td></tr>
<tr><td style="padding:14px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="48%" align="center" style="background:linear-gradient(180deg,#fffaf2 0%,#fdecd0 100%) !important; border:1px solid #f0d9a8; border-radius:10px; padding:20px 10px; box-shadow:0 3px 10px rgba(180,120,20,0.10);">
<div style="font-size:26px; font-weight:bold; color:#9a7a3a !important;">${ITSM_OPENED_TODAY}</div>
<div style="font-size:11px; color:#9a7a3a !important; margin-top:5px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Opened Today</div></td>
<td width="4%"></td>
<td width="48%" align="center" style="background:linear-gradient(180deg,#f2f6fb 0%,#dfeafa 100%) !important; border:1px solid #bcd6f0; border-radius:10px; padding:20px 10px; box-shadow:0 3px 10px rgba(30,80,160,0.10);">
<div style="font-size:26px; font-weight:bold; color:#3468a8 !important;">${ITSM_CLOSED_TODAY}</div>
<div style="font-size:11px; color:#3468a8 !important; margin-top:5px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Closed Today</div></td>
</tr></table></td></tr>

<tr><td style="padding:20px 32px 6px 32px; font-size:13px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">ITSM &mdash; Users with open or recent activity</td></tr>
<tr><td style="padding:6px 32px 20px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12px; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
<tr style="background:linear-gradient(90deg,#14503a 0%,#1a8c5c 100%) !important;" bgcolor="#14503a">
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;">User</td>
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;">Last Signed In</td>
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;" align="center">Open</td>
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;" align="center">Closed</td>
</tr>
${ITSM_ROWS_HTML}
</table></td></tr>

<tr><td style="padding:8px 32px 0 32px;">
<div style="height:2px; background:linear-gradient(90deg,#4b2e83 0%,#7b52c9 50%,#4b2e83 100%) !important; border-radius:2px;"></div>
</td></tr>

<tr><td style="padding:22px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td>
<span style="display:inline-block; background-color:#4b2e83 !important; color:#ffffff !important; font-size:11px; font-weight:bold; padding:5px 12px; border-radius:20px; text-transform:uppercase; letter-spacing:0.4px;">Project Management Tracker</span>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:12px 32px 4px 32px;" bgcolor="#ffffff">
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
<tr><td style="padding:14px 32px 4px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="48%" align="center" style="background:linear-gradient(180deg,#f2f0fb 0%,#e2d9f5 100%) !important; border:1px solid #cdb8e8; border-radius:10px; padding:20px 10px; box-shadow:0 3px 10px rgba(90,60,160,0.10);">
<div style="font-size:26px; font-weight:bold; color:#6a3fa8 !important;">${PM_OPENED_TODAY}</div>
<div style="font-size:11px; color:#6a3fa8 !important; margin-top:5px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Opened Today</div></td>
<td width="4%"></td>
<td width="48%" align="center" style="background:linear-gradient(180deg,#f2f6fb 0%,#dfeafa 100%) !important; border:1px solid #bcd6f0; border-radius:10px; padding:20px 10px; box-shadow:0 3px 10px rgba(30,80,160,0.10);">
<div style="font-size:26px; font-weight:bold; color:#3468a8 !important;">${PM_CLOSED_TODAY}</div>
<div style="font-size:11px; color:#3468a8 !important; margin-top:5px; font-weight:bold; text-transform:uppercase; letter-spacing:0.4px;">Closed Today</div></td>
</tr></table></td></tr>

<tr><td style="padding:20px 32px 6px 32px; font-size:13px; font-weight:bold; color:#1a1a1a !important;" bgcolor="#ffffff">Project Tracker &mdash; Users with pending or recent activity</td></tr>
<tr><td style="padding:6px 32px 28px 32px;" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12px; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
<tr style="background:linear-gradient(90deg,#4b2e83 0%,#7b52c9 100%) !important;" bgcolor="#4b2e83">
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;">User</td>
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;">Last Signed In</td>
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;" align="center">Pending</td>
<td style="padding:10px 14px; color:#ffffff !important; font-weight:bold;" align="center">Completed</td>
</tr>
${PM_ROWS_HTML}
</table></td></tr>

<tr><td style="padding:4px 32px 24px 32px; font-size:11px; color:#a0a0a0 !important; line-height:1.6;" bgcolor="#ffffff">
ITSM scoped to Entity = Refex. Project Tracker covers all entities group-wide.
</td></tr>

<tr><td style="background-color:#faf9f7 !important; padding:18px 32px; border-top:1px solid #ececea; font-size:11px; color:#a0a0a0 !important;" bgcolor="#faf9f7">
Refex Kissflow Engagement Report &middot; Automated &middot; Do not reply to this email
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
  --argjson user_summary "${USER_SUMMARY_JSON}" \
  --argjson itsm_summary "${ITSM_SUMMARY_JSON}" \
  --argjson pm_summary "${PM_SUMMARY_JSON}" '
{
  action: "RENDER_COMBINED_HTML_REPORT",
  generated_at: $generated_at,
  output_file: $output_file,
  mutation_performed: false,
  user_summary: $user_summary,
  itsm_summary: $itsm_summary,
  pm_summary: $pm_summary
}
' > "${AUDIT_FILE}"

log "Combined report rendered successfully"
printf '\nOutput file:\n%s\n' "${OUTPUT_FILE}"
printf '\nLatest (stable path):\n%s\n' "${LATEST_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
