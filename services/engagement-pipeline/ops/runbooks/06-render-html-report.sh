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

# Entity scope for ticket metrics.
# Empty / "all" / "*" = every ticket on this process (used for Extrovis).
# Default for the classic Refex process remains Entity=Refex.
if [[ -z "${ENTITY_FILTER+x}" ]]; then
  if [[ "${ITSM_PROCESS_ID}" == *[Ee]xtrovis* ]]; then
    ENTITY_FILTER=""
  else
    ENTITY_FILTER="Refex"
  fi
fi
if [[ "${ENTITY_FILTER}" == "all" || "${ENTITY_FILTER}" == "*" ]]; then
  ENTITY_FILTER=""
fi
ENTITY_FILTER_SQL="$(printf '%s' "${ENTITY_FILTER}" | sed "s/'/''/g")"
ENTITY_SCOPE_SQL="(
  '${ENTITY_FILTER_SQL}' = ''
  OR i.entity = '${ENTITY_FILTER_SQL}'
)"
ENTITY_SCOPE_SQL_BARE="(
  '${ENTITY_FILTER_SQL}' = ''
  OR entity = '${ENTITY_FILTER_SQL}'
)"

# Total Users = members of this process's Kissflow app roles only
# (Refex roles on the Refex report, Extrovis roles on the Extrovis report).
# Never fall back to the account-wide user directory.
if [[ "${ITSM_PROCESS_ID}" == *[Ee]xtrovis* ]]; then
  ROLE_NAME_SCOPE_SQL="(
    lower(coalesce(p.principal_name, p.principal_id, '')) LIKE '%extrovis%'
  )"
else
  ROLE_NAME_SCOPE_SQL="(
    lower(coalesce(p.principal_name, p.principal_id, '')) LIKE '%refex%'
    AND lower(coalesce(p.principal_name, p.principal_id, '')) NOT LIKE '%extrovis%'
  )"
fi

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"

apply_template_branding_from_pg
refresh_user_last_sign_ins_for_process "${ITSM_APP_ID}" "${ITSM_PROCESS_ID}"

if [[ -n "${ENTITY_FILTER}" ]]; then
  log "Querying summary metrics (process=${ITSM_PROCESS_ID}, entity=${ENTITY_FILTER})"
else
  log "Querying summary metrics (process=${ITSM_PROCESS_ID}, all entities on this process)"
fi

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
    lower(trim(coalesce(current_step, source_payload->>'_current_step', ''))) AS step_lc,
    (source_payload->'Closure_Time'->>'Closure_Time')::numeric AS sla_target_minutes,
    (${REPORT_ITEM_CREATED_AT_SQL}) AS created_at,
    (${REPORT_ITEM_COMPLETED_AT_SQL}) AS completed_at,
    -- ITSM: Completed OR InProgress on step "IT Tech Reopen" counts as Closed (not Open).
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
    ) AS is_open,
    -- Kissflow Source field (Email / WhatsApp / Mobile / Web).
    lower(trim(coalesce(
      NULLIF(trim(source_payload->>'Source'), ''),
      NULLIF(trim(source_payload->'Source'->>'Name'), ''),
      NULLIF(trim(source_payload->'Source'->>'Value'), ''),
      NULLIF(trim(source_payload->>'Ticket_Source'), ''),
      NULLIF(trim(source_payload->>'Channel'), ''),
      ''
    ))) AS source_raw
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id AND ${ENTITY_SCOPE_SQL}
),
sla_sourced AS (
  SELECT
    *,
    CASE
      WHEN source_raw LIKE '%whats%' THEN 'WhatsApp'
      WHEN source_raw LIKE '%email%' OR source_raw LIKE '%e-mail%' OR source_raw LIKE '%e mail%' THEN 'Email'
      WHEN source_raw LIKE '%mobile%' OR source_raw LIKE '%android%' OR source_raw LIKE '%ios%' THEN 'Mobile'
      WHEN source_raw LIKE '%web%' OR source_raw LIKE '%portal%' OR source_raw LIKE '%browser%' THEN 'Web'
      ELSE 'Other'
    END AS source_channel
  FROM sla
),
latest_users AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.\"user\"
  ORDER BY snapshot_at DESC
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
    AND ${ENTITY_SCOPE_SQL}
),
named_role_members AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  JOIN engagement_reporting.principal p
    ON p.environment = pu.environment
   AND p.application_id = pu.application_id
   AND p.principal_id = pu.principal_id
   AND p.principal_type = pu.principal_type
   AND p.is_current = true
  WHERE pu.application_id = '${ITSM_APP_ID}'
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
    AND ${ROLE_NAME_SCOPE_SQL}
),
process_role_members AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  JOIN process_roles pr ON pr.role_id = pu.principal_id
  WHERE pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
),
app_members AS (
  SELECT user_id FROM named_role_members
  UNION
  SELECT user_id FROM process_role_members
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
  ),
  'opened_today', (SELECT count(*) FROM sla WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'closed_today', (SELECT count(*) FROM sla WHERE completed_at IS NOT NULL AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
  'total_tickets', (SELECT count(*) FROM sla),
  'sla_breached_open', (SELECT count(*) FROM sla WHERE is_open AND sla_target_minutes IS NOT NULL AND EXTRACT(EPOCH FROM (now() - created_at)) / 60 > sla_target_minutes),
  'sla_breached_closed', (SELECT count(*) FROM sla WHERE is_closed AND sla_target_minutes IS NOT NULL AND completed_at IS NOT NULL AND EXTRACT(EPOCH FROM (completed_at - created_at)) / 60 > sla_target_minutes),
  'source_all', json_build_object(
    'Email', (SELECT count(*) FROM sla_sourced WHERE source_channel = 'Email'),
    'WhatsApp', (SELECT count(*) FROM sla_sourced WHERE source_channel = 'WhatsApp'),
    'Mobile', (SELECT count(*) FROM sla_sourced WHERE source_channel = 'Mobile'),
    'Web', (SELECT count(*) FROM sla_sourced WHERE source_channel = 'Web'),
    'Other', (SELECT count(*) FROM sla_sourced WHERE source_channel = 'Other')
  ),
  'source_open', json_build_object(
    'Email', (SELECT count(*) FROM sla_sourced WHERE is_open AND source_channel = 'Email'),
    'WhatsApp', (SELECT count(*) FROM sla_sourced WHERE is_open AND source_channel = 'WhatsApp'),
    'Mobile', (SELECT count(*) FROM sla_sourced WHERE is_open AND source_channel = 'Mobile'),
    'Web', (SELECT count(*) FROM sla_sourced WHERE is_open AND source_channel = 'Web'),
    'Other', (SELECT count(*) FROM sla_sourced WHERE is_open AND source_channel = 'Other')
  ),
  'source_opened_today', json_build_object(
    'Email', (SELECT count(*) FROM sla_sourced WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND source_channel = 'Email'),
    'WhatsApp', (SELECT count(*) FROM sla_sourced WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND source_channel = 'WhatsApp'),
    'Mobile', (SELECT count(*) FROM sla_sourced WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND source_channel = 'Mobile'),
    'Web', (SELECT count(*) FROM sla_sourced WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND source_channel = 'Web'),
    'Other', (SELECT count(*) FROM sla_sourced WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND source_channel = 'Other')
  )
);
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

if [[ -n "${ENTITY_FILTER}" ]]; then
  log "Querying per-user breakdown (latest snapshot, entity=${ENTITY_FILTER})"
else
  log "Querying per-user breakdown (latest snapshot, all entities on process=${ITSM_PROCESS_ID})"
fi

# Build user rows from ticket activity first, then attach Kissflow user profile when present.
# Extrovis (and sparse snapshots) can have assignees/creators that are not in \"user\" yet —
# still show them so the table is not empty when tickets exist.
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
),
latest_users AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.\"user\"
  WHERE environment = 'production'
  ORDER BY snapshot_at DESC
  LIMIT 1
),
assignee_name AS (
  -- _current_assigned_to is usually a JSON array; never treat the Kissflow user id as a display name.
  SELECT
    i.instance_id,
    i.snapshot_at,
    elem->>'_id' AS user_id,
    NULLIF(trim(elem->>'Name'), '') AS display_name
  FROM engagement_reporting.item i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(i.source_payload->'_current_assigned_to') = 'array'
        THEN i.source_payload->'_current_assigned_to'
      WHEN jsonb_typeof(i.source_payload->'_current_assigned_to') = 'object'
        THEN jsonb_build_array(i.source_payload->'_current_assigned_to')
      ELSE '[]'::jsonb
    END
  ) elem
  WHERE i.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
    AND elem->>'_id' IS NOT NULL
    AND coalesce(elem->>'Kind', 'User') IN ('User', 'USER')
),
activity AS (
  SELECT
    user_id,
    MAX(NULLIF(trim(display_name), '')) AS display_name,
    SUM(open_count)::int AS open_count,
    SUM(closed_count)::int AS closed_count
  FROM (
    SELECT
      ia.principal_id AS user_id,
      MAX(COALESCE(
        NULLIF(trim(ia.source_payload->>'Name'), ''),
        NULLIF(trim(ia.source_payload->>'name'), ''),
        NULLIF(trim(an.display_name), '')
      )) AS display_name,
      count(*)::int AS open_count,
      0 AS closed_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i
      ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    LEFT JOIN assignee_name an
      ON an.instance_id = ia.instance_id
     AND an.snapshot_at = ia.snapshot_at
     AND an.user_id = ia.principal_id
    WHERE ia.principal_type = 'USER'
      AND ${ENTITY_SCOPE_SQL}
      AND i.process_status = 'InProgress'
      AND lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) NOT LIKE '%it tech reopen%'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      AND ia.principal_id IS NOT NULL
      AND trim(ia.principal_id) <> ''
    GROUP BY ia.principal_id

    UNION ALL

    SELECT
      (i.source_payload->'_created_by'->>'_id') AS user_id,
      MAX(NULLIF(trim(i.source_payload->'_created_by'->>'Name'), '')) AS display_name,
      0 AS open_count,
      count(*)::int AS closed_count
    FROM engagement_reporting.item i
    WHERE ${ENTITY_SCOPE_SQL}
      AND i.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      AND (
        i.process_status = 'Completed'
        OR (
          i.process_status = 'InProgress'
          AND lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
        )
      )
      AND NULLIF(trim(i.source_payload->'_created_by'->>'_id'), '') IS NOT NULL
    GROUP BY 1
  ) raw
  GROUP BY user_id
),
sla_by_user AS (
  -- Same attribution as activity: open → current assignee; closed → creator.
  SELECT
    user_id,
    SUM(sla_count)::int AS sla_breached_count
  FROM (
    SELECT
      ia.principal_id AS user_id,
      count(*)::int AS sla_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i
      ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    WHERE ia.principal_type = 'USER'
      AND ${ENTITY_SCOPE_SQL}
      AND i.process_status = 'InProgress'
      AND lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) NOT LIKE '%it tech reopen%'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      AND ia.principal_id IS NOT NULL
      AND trim(ia.principal_id) <> ''
      AND (i.source_payload->'Closure_Time'->>'Closure_Time')::numeric IS NOT NULL
      AND (${REPORT_ITEM_CREATED_AT_I_SQL}) IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - (${REPORT_ITEM_CREATED_AT_I_SQL}))) / 60
          > (i.source_payload->'Closure_Time'->>'Closure_Time')::numeric
    GROUP BY ia.principal_id

    UNION ALL

    SELECT
      (i.source_payload->'_created_by'->>'_id') AS user_id,
      count(*)::int AS sla_count
    FROM engagement_reporting.item i
    WHERE ${ENTITY_SCOPE_SQL}
      AND i.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      AND (
        i.process_status = 'Completed'
        OR (
          i.process_status = 'InProgress'
          AND lower(trim(coalesce(i.current_step, i.source_payload->>'_current_step', ''))) LIKE '%it tech reopen%'
        )
      )
      AND NULLIF(trim(i.source_payload->'_created_by'->>'_id'), '') IS NOT NULL
      AND (i.source_payload->'Closure_Time'->>'Closure_Time')::numeric IS NOT NULL
      AND (${REPORT_ITEM_COMPLETED_AT_I_SQL}) IS NOT NULL
      AND EXTRACT(EPOCH FROM (
            (${REPORT_ITEM_COMPLETED_AT_I_SQL})
            - (${REPORT_ITEM_CREATED_AT_I_SQL})
          )) / 60
          > (i.source_payload->'Closure_Time'->>'Closure_Time')::numeric
    GROUP BY 1
  ) breached
  GROUP BY user_id
)
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
  SELECT
    resolved.user_name,
    ${REPORT_USER_LAST_SIGN_IN_IST_SQL} AS last_sign_in,
    COALESCE(u.ever_logged_in, false) AS ever_logged_in,
    a.open_count,
    a.closed_count,
    COALESCE(s.sla_breached_count, 0) AS sla_breached_count
  FROM activity a
  LEFT JOIN sla_by_user s ON s.user_id = a.user_id
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
    SELECT NULLIF(trim(COALESCE(u.user_name, a.display_name)), '') AS user_name
  ) resolved
  WHERE (a.open_count > 0 OR a.closed_count > 0)
    -- Drop Kissflow id leftovers (e.g. UsDOsv9zuEDL) and blank names
    AND resolved.user_name IS NOT NULL
    AND resolved.user_name <> a.user_id
    AND resolved.user_name !~ '^[Uu][Ss][A-Za-z0-9_-]{6,}$'
  ORDER BY a.open_count DESC, a.closed_count DESC
) t;
" | psql "host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

[[ -n "${SUMMARY_JSON}" ]] || stop "Failed to retrieve summary metrics."
[[ -n "${USERS_JSON}" ]] || stop "Failed to retrieve user breakdown."

log "Rendering HTML report"

ROWS_HTML="$(jq -r '
  def is_kissflow_id:
    type == "string" and test("^[Uu][Ss][A-Za-z0-9_-]{6,}$");
  [ .[]
    | select((.user_name // "") | tostring | length > 0)
    | select((.user_name | is_kissflow_id | not))
  ] as $rows
  | if ($rows | length) == 0 then
    "<tr style=\"background-color:#ffffff;\" bgcolor=\"#ffffff\"><td colspan=\"5\" style=\"padding:16px 14px; border-bottom:1px solid #ececea; color:#64748b !important; text-align:center;\">No users with open or closed tickets in this snapshot.</td></tr>"
  else
    $rows | to_entries | map(
      "<tr style=\"background-color:" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + ";\" bgcolor=\"" + (if (.key % 2 == 0) then "#faf9f7" else "#ffffff" end) + "\">" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.user_name // "Unknown") + "</td>" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + ((.value.last_sign_in // "") | if . == "" or . == "Never" then "-" else . end) + "</td>" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.open_count | tostring) + "</b></td>" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.closed_count | tostring) + "</td>" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#c8102e !important;\" align=\"center\"><b>" + ((.value.sla_breached_count // 0) | tostring) + "</b></td>" +
      "</tr>"
    ) | join("")
  end
' <<< "${USERS_JSON}")"

TODAY_IST="$(TZ='Asia/Kolkata' date +'%Y-%m-%d')"
MIS_COUNTS="$(jq -c --arg today "${TODAY_IST}" '
  def is_kissflow_id:
    type == "string" and test("^[Uu][Ss][A-Za-z0-9_-]{6,}$");
  [ .[]
    | select((.user_name // "") | tostring | length > 0)
    | select((.user_name | is_kissflow_id | not))
  ] as $rows
  | {
      total: ($rows | length),
      signed_in_today: (
        [$rows[] | select((.last_sign_in // "") | tostring | startswith($today))] | length
      )
    }
' <<< "${USERS_JSON}")"
TOTAL_USERS="$(jq -r '.total' <<< "${MIS_COUNTS}")"
SIGNED_IN_TODAY="$(jq -r '.signed_in_today' <<< "${MIS_COUNTS}")"
SIGNED_IN="$(jq -r '.signed_in_users' <<< "${SUMMARY_JSON}")"
SIGNIN_PCT="$(jq '
  if (.total // 0) <= 0 then 0 else ((.signed_in_today // 0) * 100 / .total) | floor end
' <<< "${MIS_COUNTS}")"
SIGNIN_RATE_TODAY="${SIGNIN_PCT}"
NEVER_LOGGED_IN="$(jq -r '.never_logged_in' <<< "${SUMMARY_JSON}")"
OPENED_TODAY="$(jq -r '.opened_today // 0' <<< "${SUMMARY_JSON}")"
CLOSED_TODAY="$(jq -r '.closed_today // 0' <<< "${SUMMARY_JSON}")"

TOTAL_OPEN="$(jq '[.[].open_count] | add // 0' <<< "${USERS_JSON}")"
TOTAL_CLOSED="$(jq '[.[].closed_count] | add // 0' <<< "${USERS_JSON}")"
TOTAL_TICKETS="$(jq -r '.total_tickets' <<< "${SUMMARY_JSON}")"
SLA_BREACHED_OPEN="$(jq -r '.sla_breached_open' <<< "${SUMMARY_JSON}")"
SLA_BREACHED_CLOSED="$(jq -r '.sla_breached_closed' <<< "${SUMMARY_JSON}")"
SLA_BREACHED_TOTAL="$(( SLA_BREACHED_OPEN + SLA_BREACHED_CLOSED ))"

SOURCE_EMAIL_ALL="$(jq -r '.source_all.Email // 0' <<< "${SUMMARY_JSON}")"
SOURCE_WHATSAPP_ALL="$(jq -r '.source_all.WhatsApp // 0' <<< "${SUMMARY_JSON}")"
SOURCE_MOBILE_ALL="$(jq -r '.source_all.Mobile // 0' <<< "${SUMMARY_JSON}")"
SOURCE_WEB_ALL="$(jq -r '.source_all.Web // 0' <<< "${SUMMARY_JSON}")"
SOURCE_OTHER_ALL="$(jq -r '.source_all.Other // 0' <<< "${SUMMARY_JSON}")"
SOURCE_EMAIL_OPEN="$(jq -r '.source_open.Email // 0' <<< "${SUMMARY_JSON}")"
SOURCE_WHATSAPP_OPEN="$(jq -r '.source_open.WhatsApp // 0' <<< "${SUMMARY_JSON}")"
SOURCE_MOBILE_OPEN="$(jq -r '.source_open.Mobile // 0' <<< "${SUMMARY_JSON}")"
SOURCE_WEB_OPEN="$(jq -r '.source_open.Web // 0' <<< "${SUMMARY_JSON}")"
SOURCE_OTHER_OPEN="$(jq -r '.source_open.Other // 0' <<< "${SUMMARY_JSON}")"
SOURCE_EMAIL_TODAY="$(jq -r '.source_opened_today.Email // 0' <<< "${SUMMARY_JSON}")"
SOURCE_WHATSAPP_TODAY="$(jq -r '.source_opened_today.WhatsApp // 0' <<< "${SUMMARY_JSON}")"
SOURCE_MOBILE_TODAY="$(jq -r '.source_opened_today.Mobile // 0' <<< "${SUMMARY_JSON}")"
SOURCE_WEB_TODAY="$(jq -r '.source_opened_today.Web // 0' <<< "${SUMMARY_JSON}")"
SOURCE_OTHER_TODAY="$(jq -r '.source_opened_today.Other // 0' <<< "${SUMMARY_JSON}")"
SOURCE_TODAY_TOTAL="$(( SOURCE_EMAIL_TODAY + SOURCE_WHATSAPP_TODAY + SOURCE_MOBILE_TODAY + SOURCE_WEB_TODAY + SOURCE_OTHER_TODAY ))"

# Compact All | Today-open source panel (email-safe). Built in Node (same markup as Admin UI preview)
# so jq never JSON-escapes style="..." attributes (that made Extrovis/Refex panels look unstyled).
SOURCE_BREAKDOWN_HTML="$(
  SOURCE_EMAIL_ALL="${SOURCE_EMAIL_ALL}" \
  SOURCE_WHATSAPP_ALL="${SOURCE_WHATSAPP_ALL}" \
  SOURCE_MOBILE_ALL="${SOURCE_MOBILE_ALL}" \
  SOURCE_WEB_ALL="${SOURCE_WEB_ALL}" \
  SOURCE_OTHER_ALL="${SOURCE_OTHER_ALL}" \
  SOURCE_EMAIL_TODAY="${SOURCE_EMAIL_TODAY}" \
  SOURCE_WHATSAPP_TODAY="${SOURCE_WHATSAPP_TODAY}" \
  SOURCE_MOBILE_TODAY="${SOURCE_MOBILE_TODAY}" \
  SOURCE_WEB_TODAY="${SOURCE_WEB_TODAY}" \
  SOURCE_OTHER_TODAY="${SOURCE_OTHER_TODAY}" \
  TOTAL_TICKETS="${TOTAL_TICKETS}" \
  SOURCE_TODAY_TOTAL="${SOURCE_TODAY_TOTAL}" \
  node "${REPO_ROOT}/services/engagement-pipeline/scripts/build-itsm-source-breakdown.js"
)"
[[ -n "${SOURCE_BREAKDOWN_HTML}" ]] || stop "Failed to build SourceBreakdownHtml panels."

# Kept empty on purpose — source belongs in the Ticket source panels, not inside KPI cards.
OPENED_TODAY_SOURCE_HTML=""

GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

log "Rendering HTML from published template (PostgreSQL or seed fallback)"

TEMPLATE_SRC="$(mktemp)"
VARS_JSON="$(mktemp)"
trap 'rm -f "${TEMPLATE_SRC}" "${VARS_JSON}"' EXIT

report_template_load_html "${TEMPLATE_SRC}" || stop "Failed to load ITSM report template HTML."
report_template_emphasize_users_kpi "${TEMPLATE_SRC}"

# Extrovis reports omit User Sign-in Overview (even if an older published template still has it).
if [[ "${ITSM_PROCESS_ID}" == *[Ee]xtrovis* ]] && grep -qF 'User Sign-in Overview' "${TEMPLATE_SRC}"; then
  python3 - "${TEMPLATE_SRC}" <<'PY'
import re
import sys
from pathlib import Path
path = Path(sys.argv[1])
html = path.read_text(encoding="utf-8")
# Remove from User Sign-in Overview header through the divider before Overall ITSM Ticket Summary.
pattern = re.compile(
    r'<tr>\s*<td[^>]*>\s*<div[^>]*>User Sign-in Overview</div>\s*</td>\s*</tr>'
    r'.*?'
    r'(?=<tr>\s*<td[^>]*>\s*<div[^>]*>Overall ITSM Ticket Summary</div>)',
    re.IGNORECASE | re.DOTALL,
)
updated, n = pattern.subn("", html, count=1)
if n:
    path.write_text(updated, encoding="utf-8")
PY
  log "Removed User Sign-in Overview for Extrovis process ${ITSM_PROCESS_ID}"
fi

# Older published templates may not include {{SourceBreakdownHtml}} — inject before Today's activity.
if ! grep -qF '{{SourceBreakdownHtml}}' "${TEMPLATE_SRC}"; then
  python3 - "${TEMPLATE_SRC}" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
html = path.read_text(encoding="utf-8")
mark = "{{SourceBreakdownHtml}}"
if mark in html:
    raise SystemExit(0)
needles = [
    "Today's Ticket Activity",
    "Today\u2019s Ticket Activity",
    "Users with open or recent activity",
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
  log "Injected SourceBreakdownHtml placeholder into loaded template"
fi

# Strip leftover Opened Today source chips (source lives in Ticket source panels only).
if grep -qF '{{OpenedTodaySourceHtml}}' "${TEMPLATE_SRC}" || grep -qiF 'Source today' "${TEMPLATE_SRC}"; then
  python3 - "${TEMPLATE_SRC}" <<'PY'
import re
import sys
from pathlib import Path
path = Path(sys.argv[1])
html = path.read_text(encoding="utf-8")
html = html.replace("{{OpenedTodaySourceHtml}}", "")
html = re.sub(
    r'<div[^>]*>\s*Source today\s*</div>\s*<div[^>]*>.*?</div>\s*</div>',
    "",
    html,
    flags=re.IGNORECASE | re.DOTALL,
)
path.write_text(html, encoding="utf-8")
PY
  log "Removed source chips from Opened Today KPI card"
fi

# Match Admin UI preview: template name → subject → default.
REPORT_TITLE="${TEMPLATE_NAME:-}"
if [[ -z "${REPORT_TITLE}" ]]; then
  REPORT_TITLE="${SUBJECT:-Kissflow User Engagement Report}"
fi

jq -n \
  --arg ReportTitle "${REPORT_TITLE}" \
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
  --arg SourceEmailAll "${SOURCE_EMAIL_ALL}" \
  --arg SourceWhatsAppAll "${SOURCE_WHATSAPP_ALL}" \
  --arg SourceMobileAll "${SOURCE_MOBILE_ALL}" \
  --arg SourceWebAll "${SOURCE_WEB_ALL}" \
  --arg SourceEmailOpen "${SOURCE_EMAIL_OPEN}" \
  --arg SourceWhatsAppOpen "${SOURCE_WHATSAPP_OPEN}" \
  --arg SourceMobileOpen "${SOURCE_MOBILE_OPEN}" \
  --arg SourceWebOpen "${SOURCE_WEB_OPEN}" \
  --arg SourceBreakdownHtml "${SOURCE_BREAKDOWN_HTML}" \
  --arg OpenedTodaySourceHtml "${OPENED_TODAY_SOURCE_HTML}" \
  --arg UserTableHtml "${ROWS_HTML}" \
  --arg ReportBody "$(
    if [[ -n "${ENTITY_FILTER}" ]]; then
      printf 'Scoped to process %s · Entity = %s. SLA Breached compares actual ticket duration against the configured SLA target from Kissflow'\''s Approval Matrix.' "${ITSM_PROCESS_ID}" "${ENTITY_FILTER}"
    else
      printf 'Scoped to process %s (all entities on this process — Extrovis/non-Refex). SLA Breached compares actual ticket duration against the configured SLA target from Kissflow'\''s Approval Matrix.' "${ITSM_PROCESS_ID}"
    fi
  )" \
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
    SourceEmailAll: $SourceEmailAll,
    SourceWhatsAppAll: $SourceWhatsAppAll,
    SourceMobileAll: $SourceMobileAll,
    SourceWebAll: $SourceWebAll,
    SourceEmailOpen: $SourceEmailOpen,
    SourceWhatsAppOpen: $SourceWhatsAppOpen,
    SourceMobileOpen: $SourceMobileOpen,
    SourceWebOpen: $SourceWebOpen,
    SourceBreakdownHtml: $SourceBreakdownHtml,
    OpenedTodaySourceHtml: $OpenedTodaySourceHtml,
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
