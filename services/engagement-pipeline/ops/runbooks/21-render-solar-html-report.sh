#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT_OVERRIDE:-/app}"
TEMPLATES_DIR="${REPO_ROOT}/templates/generated"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-21"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/report-template-lib.sh"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
OUTPUT_FILE="${TEMPLATES_DIR}/solar-report-${TIMESTAMP}.html"
LATEST_FILE="${TEMPLATES_DIR}/solar-report-latest.html"
AUDIT_FILE="${AUDIT_DIR}/runbook-21-${TIMESTAMP}.json"

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

SOLAR_APP_ID="${SOLAR_APP_ID:-Solar_Site_Expense_Governance_Syst_A00}"
SOLAR_PROCESS_ID="${SOLAR_PROCESS_ID:-${PROCESS_ID:-Technician_Reimbursement__YTLM}}"
APPLICATION_ID="${APPLICATION_ID:-${SOLAR_APP_ID}}"

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || stop "jq is not installed."
command -v psql >/dev/null 2>&1 || stop "psql is not installed."

mkdir -p "${TEMPLATES_DIR}" "${AUDIT_DIR}"

apply_template_branding_from_pg
refresh_user_last_sign_ins_for_process "${SOLAR_APP_ID}" "${SOLAR_PROCESS_ID}"

log "Querying Solar Reinvestment Request summary"

SOLAR_SUMMARY_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH $(report_latest_snapshot_cte "'${SOLAR_APP_ID}'" "'${SOLAR_PROCESS_ID}'"),
tasks AS (
  SELECT
    instance_id,
    process_status,
    current_step,
    (${REPORT_ITEM_CREATED_AT_SQL}) AS created_at,
    (${REPORT_ITEM_COMPLETED_AT_SQL}) AS completed_at,
    CASE
      WHEN lower(trim(concat_ws(' ',
        coalesce(current_step, ''),
        coalesce(source_payload->>'Service_Category', ''),
        coalesce(source_payload->'Service_Category'->>'Name', ''),
        coalesce(source_payload->>'Expense_Type', ''),
        coalesce(source_payload->'Expense_Type'->>'Name', ''),
        coalesce(source_payload->>'Category', ''),
        coalesce(source_payload->'Category'->>'Name', ''),
        coalesce(source_payload->>'Department', ''),
        coalesce(source_payload->'Department'->>'Name', ''),
        coalesce(source_payload->>'Cost_Center', ''),
        coalesce(source_payload->>'Request_Type', '')
      ))) ~ '(financ|account|treasury|audit|invoice)' THEN 'finance'
      ELSE 'operation'
    END AS cat
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id
    AND i.process_id = '${SOLAR_PROCESS_ID}'
),
latest_users AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.\"user\"
  ORDER BY snapshot_at DESC
  LIMIT 1
),
solar_process_roles AS (
  SELECT DISTINCT ia.principal_id AS role_id
  FROM engagement_reporting.item_assignment ia, latest l
  WHERE ia.snapshot_run_id = l.snapshot_run_id
    AND ia.process_id = '${SOLAR_PROCESS_ID}'
    AND ia.principal_type = 'APP_ROLE'
),
solar_role_members AS (
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.application_id = '${SOLAR_APP_ID}'
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
  UNION
  SELECT DISTINCT pu.user_id
  FROM engagement_reporting.principal_user pu
  JOIN solar_process_roles pr ON pr.role_id = pu.principal_id
  WHERE pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
),
solar_app_users AS (
  SELECT user_id FROM solar_role_members
  UNION
  SELECT DISTINCT ia.principal_id AS user_id
  FROM engagement_reporting.item_assignment ia, latest l
  WHERE ia.snapshot_run_id = l.snapshot_run_id
    AND ia.process_id = '${SOLAR_PROCESS_ID}'
    AND ia.principal_type = 'USER'
    AND ia.principal_id IS NOT NULL
    AND trim(ia.principal_id) <> ''
    AND NOT EXISTS (SELECT 1 FROM solar_role_members)
)
SELECT json_build_object(
  'total_requests', (SELECT count(*) FROM tasks),
  'open_requests', (SELECT count(*) FROM tasks WHERE process_status = 'InProgress'),
  'closed_requests', (SELECT count(*) FROM tasks WHERE process_status = 'Completed'),
  'opened_today', (
    SELECT count(*) FROM tasks
    WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ),
  'closed_today', (
    SELECT count(*) FROM tasks
    WHERE completed_at IS NOT NULL
      AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  ),
  'operation_total', (SELECT count(*) FROM tasks WHERE cat = 'operation'),
  'operation_open', (SELECT count(*) FROM tasks WHERE cat = 'operation'
      AND process_status NOT IN ('Completed', 'Closed', 'Withdrawn')
      AND lower(coalesce(process_status, '')) !~ '(reject|cancel|withdraw)'),
  'operation_closed', (SELECT count(*) FROM tasks WHERE cat = 'operation'
      AND (process_status IN ('Completed', 'Closed')
        OR lower(coalesce(process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled'))),
  'finance_total', (SELECT count(*) FROM tasks WHERE cat = 'finance'),
  'finance_open', (SELECT count(*) FROM tasks WHERE cat = 'finance'
      AND process_status NOT IN ('Completed', 'Closed', 'Withdrawn')
      AND lower(coalesce(process_status, '')) !~ '(reject|cancel|withdraw)'),
  'finance_closed', (SELECT count(*) FROM tasks WHERE cat = 'finance'
      AND (process_status IN ('Completed', 'Closed')
        OR lower(coalesce(process_status, '')) IN ('completed', 'closed', 'done', 'approved', 'paid', 'settled'))),
  'total_app_users', (SELECT count(*) FROM solar_app_users),
  'signed_in_users', (
    SELECT count(*)
    FROM ${REPORT_BEST_USER_FROM_SQL}
    JOIN solar_app_users su ON su.user_id = u.user_id
    WHERE COALESCE(u.ever_logged_in, false)
  ),
  'signed_in_today', (
    SELECT count(*)
    FROM solar_app_users su
    LEFT JOIN LATERAL (
      SELECT u0.last_sign_in, u0.source_payload
      FROM engagement_reporting.\"user\" u0
      WHERE u0.user_id = su.user_id
        AND u0.environment = 'production'
      ORDER BY
        ${REPORT_BEST_USER_ORDER_SQL}
      LIMIT 1
    ) u ON true
    WHERE ${REPORT_USER_LAST_SIGN_IN_SQL} IS NOT NULL
      AND (${REPORT_USER_LAST_SIGN_IN_SQL} AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date
  )
);
" | psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

log "Querying Solar Reinvestment Request per-user breakdown"

SOLAR_USERS_JSON="$(echo "
\pset tuples_only on
\pset format unaligned
WITH $(report_latest_snapshot_cte "'${SOLAR_APP_ID}'" "'${SOLAR_PROCESS_ID}'"),
latest_users AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.\"user\"
  WHERE environment = 'production'
  ORDER BY snapshot_at DESC
  LIMIT 1
),
activity AS (
  SELECT user_id, SUM(open_count)::int AS open_count, SUM(closed_count)::int AS closed_count
  FROM (
    SELECT ia.principal_id AS user_id, count(*)::int AS open_count, 0 AS closed_count
    FROM engagement_reporting.item_assignment ia
    JOIN engagement_reporting.item i
      ON i.instance_id = ia.instance_id AND i.snapshot_at = ia.snapshot_at
    WHERE ia.process_id = '${SOLAR_PROCESS_ID}'
      AND ia.principal_type = 'USER'
      AND i.process_status = 'InProgress'
      AND ia.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      AND ia.principal_id IS NOT NULL
      AND trim(ia.principal_id) <> ''
    GROUP BY ia.principal_id
    UNION ALL
    SELECT assignee_id AS user_id, 0 AS open_count, count(*)::int AS closed_count
    FROM (
      SELECT DISTINCT ON (i.instance_id)
        i.instance_id,
        COALESCE(
          NULLIF(i.source_payload->'Site_Incharge'->>'_id', ''),
          NULLIF(ia.principal_id, ''),
          NULLIF(i.source_payload->'_modified_by'->>'_id', '')
        ) AS assignee_id
      FROM engagement_reporting.item i
      LEFT JOIN engagement_reporting.item_assignment ia
        ON ia.instance_id = i.instance_id
       AND ia.snapshot_at = i.snapshot_at
       AND ia.principal_type = 'USER'
       AND ia.snapshot_run_id = i.snapshot_run_id
      WHERE i.process_id = '${SOLAR_PROCESS_ID}'
        AND i.process_status = 'Completed'
        AND i.snapshot_run_id = (SELECT snapshot_run_id FROM latest)
      ORDER BY i.instance_id, ia.principal_id NULLS LAST
    ) completed_items
    WHERE assignee_id IS NOT NULL
    GROUP BY assignee_id
  ) counts
  GROUP BY user_id
)
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
  SELECT
    COALESCE(NULLIF(trim(u.user_name), ''), a.user_id) AS user_name,
    ${REPORT_USER_LAST_SIGN_IN_IST_SQL} AS last_sign_in,
    a.open_count,
    a.closed_count
  FROM activity a
  LEFT JOIN LATERAL (
    SELECT u0.user_name, u0.last_sign_in, u0.ever_logged_in, u0.source_payload
    FROM engagement_reporting.\"user\" u0
    WHERE u0.user_id = a.user_id
      AND u0.environment = 'production'
    ORDER BY
      ${REPORT_BEST_USER_ORDER_SQL}
    LIMIT 1
  ) u ON true
  WHERE (a.open_count > 0 OR a.closed_count > 0)
  ORDER BY a.open_count DESC, a.closed_count DESC
) t;
" | psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" | tr -d "\r" | grep -v "^Output format")"

[[ -n "${SOLAR_SUMMARY_JSON}" ]] || stop "Failed to retrieve Solar summary."
[[ -n "${SOLAR_USERS_JSON}" ]] || stop "Failed to retrieve Solar user breakdown."

log "Rendering Solar HTML report"

TODAY_IST="$(TZ='Asia/Kolkata' date +'%Y-%m-%d')"
SOLAR_ROWS_HTML="$(jq -r --arg today "${TODAY_IST}" '
  def signed_today: ((.value.last_sign_in // "") | tostring | startswith($today));
  def row_bg: if signed_today then "#dcfce7" elif (.key % 2 == 0) then "#faf9f7" else "#ffffff" end;
  def signin_style: if signed_today then "padding:12px 14px; border-bottom:1px solid #bbf7d0; color:#166534 !important; font-weight:bold;" else "padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" end;
  if length == 0 then
    "<tr style=\"background-color:#ffffff;\" bgcolor=\"#ffffff\"><td colspan=\"4\" style=\"padding:16px 14px; border-bottom:1px solid #ececea; color:#64748b !important; text-align:center;\">No users with open or closed requests in this snapshot.</td></tr>"
  else
    to_entries | map(
      "<tr style=\"background-color:" + row_bg + ";\" bgcolor=\"" + row_bg + "\">" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\">" + (.value.user_name // "Unknown") + "</td>" +
      "<td style=\"" + signin_style + "\">" + ((.value.last_sign_in // "") | if . == "" or . == "Never" then "-" else . end) + "</td>" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\"><b>" + (.value.open_count | tostring) + "</b></td>" +
      "<td style=\"padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;\" align=\"center\">" + (.value.closed_count | tostring) + "</td>" +
      "</tr>"
    ) | join("")
  end
' <<< "${SOLAR_USERS_JSON}")"

SOLAR_MIS_COUNTS="$(jq -c --arg today "${TODAY_IST}" '
  [ .[] | select((.user_name // "") | tostring | length > 0) ] as $rows
  | {
      total: ($rows | length),
      signed_in_today: (
        [$rows[] | select((.last_sign_in // "") | tostring | startswith($today))] | length
      )
    }
' <<< "${SOLAR_USERS_JSON}")"
SOLAR_TOTAL="$(jq -r '.total_requests // 0' <<< "${SOLAR_SUMMARY_JSON}")"
SOLAR_OPEN="$(jq -r '.open_requests // 0' <<< "${SOLAR_SUMMARY_JSON}")"
SOLAR_CLOSED="$(jq -r '.closed_requests // 0' <<< "${SOLAR_SUMMARY_JSON}")"
SOLAR_OPENED_TODAY="$(jq -r '.opened_today // 0' <<< "${SOLAR_SUMMARY_JSON}")"
SOLAR_CLOSED_TODAY="$(jq -r '.closed_today // 0' <<< "${SOLAR_SUMMARY_JSON}")"
if report_live_today_kpis "${SOLAR_PROCESS_ID}" "${SOLAR_APP_ID}" ""; then
  log "Live Kissflow ticket KPIs: total=${REPORT_LIVE_TOTAL_TICKETS:-?} open=${REPORT_LIVE_OPEN_TICKETS:-?} closed=${REPORT_LIVE_CLOSED_TICKETS:-?} opened_today=${REPORT_LIVE_OPENED_TODAY:-?}"
  SOLAR_OPENED_TODAY="$(report_prefer_live_today "${SOLAR_OPENED_TODAY}" "${REPORT_LIVE_OPENED_TODAY}")"
  SOLAR_TOTAL="$(report_prefer_live_today "${SOLAR_TOTAL}" "${REPORT_LIVE_TOTAL_TICKETS}")"
  SOLAR_OPEN="$(report_prefer_live_today "${SOLAR_OPEN}" "${REPORT_LIVE_OPEN_TICKETS}")"
  SOLAR_CLOSED="$(report_prefer_live_today "${SOLAR_CLOSED}" "${REPORT_LIVE_CLOSED_TICKETS}")"
  if [[ -n "${REPORT_LIVE_CLOSED_TODAY}" && "${REPORT_LIVE_CLOSED_TODAY}" =~ ^[0-9]+$ && "${REPORT_LIVE_CLOSED_TODAY}" -ge "${SOLAR_CLOSED_TODAY}" ]]; then
    SOLAR_CLOSED_TODAY="${REPORT_LIVE_CLOSED_TODAY}"
  fi
fi
SOLAR_TOTAL_USERS="$(jq -r '.total' <<< "${SOLAR_MIS_COUNTS}")"
SOLAR_SIGNED_IN_TODAY="$(jq -r '.signed_in_today' <<< "${SOLAR_MIS_COUNTS}")"
SOLAR_SIGNIN_RATE_TODAY="$(jq -r '
  (.total // 0) as $total
  | (.signed_in_today // 0) as $today
  | (if $total <= 0 then 0 else (($today * 100 / $total) | floor) end)
  | tostring + "%"
' <<< "${SOLAR_MIS_COUNTS}")"

GENERATED_AT_DISPLAY="$(TZ='Asia/Kolkata' date +'%Y-%m-%d %H:%M IST')"

log "Building Operation vs Finance category sections (dashboard parity)"
CATEGORY_JSON="$(jq -c '{
  operation: {
    total: (.operation_total // 0),
    open: (.operation_open // 0),
    closed: (.operation_closed // 0)
  },
  finance: {
    total: (.finance_total // 0),
    open: (.finance_open // 0),
    closed: (.finance_closed // 0)
  }
}' <<< "${SOLAR_SUMMARY_JSON}")"
SOLAR_CATEGORY_HTML="$(printf '%s' "${CATEGORY_JSON}" | node "${REPO_ROOT}/services/engagement-pipeline/scripts/build-solar-category-html.js")"
[[ -n "${SOLAR_CATEGORY_HTML}" ]] || SOLAR_CATEGORY_HTML=""

log "Rendering Solar HTML from published template (PostgreSQL or seed fallback)"

TEMPLATE_SRC="$(mktemp)"
VARS_JSON="$(mktemp)"
trap 'rm -f "${TEMPLATE_SRC}" "${VARS_JSON}"' EXIT

report_template_load_html "${TEMPLATE_SRC}" || stop "Failed to load Solar report template HTML."
report_template_emphasize_users_kpi "${TEMPLATE_SRC}"

SEED_TEMPLATE="${REPO_ROOT}/db/seeds/solar-reinvestment-template.html"
# Force seed layout when published Admin UI HTML is missing Operation vs Finance addon.
if [[ -f "${SEED_TEMPLATE}" ]]; then
  if ! grep -qF '{{CategorySectionsHtml}}' "${TEMPLATE_SRC}"; then
    log "Published Solar template missing CategorySectionsHtml — using seed layout (Operation vs Finance)"
    cp "${SEED_TEMPLATE}" "${TEMPLATE_SRC}"
  fi
fi

REPORT_TITLE="${TEMPLATE_NAME:-}"
if [[ -z "${REPORT_TITLE}" ]]; then
  REPORT_TITLE="${SUBJECT:-Solar Reinvestment Request Report}"
fi

jq -n \
  --arg ReportTitle "${REPORT_TITLE}" \
  --arg ReportDate "${GENERATED_AT_DISPLAY}" \
  --arg TotalRequests "${SOLAR_TOTAL}" \
  --arg OpenRequests "${SOLAR_OPEN}" \
  --arg ClosedRequests "${SOLAR_CLOSED}" \
  --arg OpenedToday "${SOLAR_OPENED_TODAY}" \
  --arg ClosedToday "${SOLAR_CLOSED_TODAY}" \
  --arg TotalUsers "${SOLAR_TOTAL_USERS}" \
  --arg SignedInToday "${SOLAR_SIGNED_IN_TODAY}" \
  --arg UserTableHtml "${SOLAR_ROWS_HTML}" \
  --arg CategorySectionsHtml "${SOLAR_CATEGORY_HTML}" \
  --arg ReportBody "Solar Expense Hub · Reinvestment Request. Operation vs Finance matches the Solar Expense Hub dashboard (Finance = finance/account/treasury/audit/invoice; all other = Operation)." \
  '{
    ReportTitle: $ReportTitle,
    ReportDate: $ReportDate,
    TotalRequests: $TotalRequests,
    OpenRequests: $OpenRequests,
    ClosedRequests: $ClosedRequests,
    OpenedToday: $OpenedToday,
    ClosedToday: $ClosedToday,
    TotalUsers: $TotalUsers,
    SignedInToday: $SignedInToday,
    UserTableHtml: $UserTableHtml,
    CategorySectionsHtml: $CategorySectionsHtml,
    ReportBody: $ReportBody
  }' > "${VARS_JSON}"

report_template_render "${OUTPUT_FILE}" "${VARS_JSON}" "${TEMPLATE_SRC}" \
  || stop "Failed to render Solar report template."

cp "${OUTPUT_FILE}" "${LATEST_FILE}"

jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg output_file "${OUTPUT_FILE}" \
  --argjson summary "${SOLAR_SUMMARY_JSON}" \
  --argjson user_count "$(jq 'length' <<< "${SOLAR_USERS_JSON}")" '
{
  action: "RENDER_SOLAR_HTML_REPORT",
  generated_at: $generated_at,
  output_file: $output_file,
  mutation_performed: false,
  summary: $summary,
  active_users_in_table: $user_count
}
' > "${AUDIT_FILE}"

log "Solar report rendered successfully"
printf '\nOutput file:\n%s\n' "${OUTPUT_FILE}"
printf '\nLatest (stable path):\n%s\n' "${LATEST_FILE}"
printf '\nAudit record:\n%s\n' "${AUDIT_FILE}"
