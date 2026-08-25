#!/usr/bin/env bash
# Shared helpers: load published template HTML from PostgreSQL (or seed fallback) and render placeholders.

report_template_repo_root() {
  local lib_dir candidate override
  override="${REPO_ROOT_OVERRIDE:-}"

  if [[ -n "${override}" && -d "${override}/db/seeds" ]]; then
    printf '%s' "${override}"
    return 0
  fi

  if [[ -n "${REPO_ROOT:-}" && -d "${REPO_ROOT}/db/seeds" ]]; then
    printf '%s' "${REPO_ROOT}"
    return 0
  fi

  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for candidate in \
    "$(cd "${lib_dir}/../.." && pwd)" \
    "$(cd "${lib_dir}/../../.." && pwd)" \
    "${override}" \
    "${REPO_ROOT:-}" \
    "/app"; do
    [[ -n "${candidate}" && -d "${candidate}/db/seeds" ]] || continue
    printf '%s' "${candidate}"
    return 0
  done

  printf '%s' "${override:-${REPO_ROOT:-/app}}"
}

# shellcheck source=/dev/null
if [[ -f "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/refresh-user-last-sign-in.sh" ]]; then
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/refresh-user-last-sign-in.sh"
fi

report_template_pg_conn() {
  printf 'host=%s port=%s dbname=%s user=%s' \
    "${PGHOST:-localhost}" "${PGPORT:-5432}" "${PGDATABASE:-engagement_reporting}" "${PGUSER:-postgres}"
}

# Last sign-in from the user row, then Kissflow payload fallbacks.
# Expects table/alias `u` on engagement_reporting."user".
REPORT_USER_LAST_SIGN_IN_SQL="COALESCE(
  u.last_sign_in,
  CASE
    WHEN coalesce(u.source_payload #>> '{LastLoggedInAt,v}', '') ~ '^[0-9]{4}-'
      THEN (u.source_payload #>> '{LastLoggedInAt,v}')::timestamptz
    WHEN coalesce(u.source_payload #>> '{LastLoggedInAt,dv}', '') ~ '^[0-9]{4}-'
      THEN (u.source_payload #>> '{LastLoggedInAt,dv}')::timestamptz
    WHEN jsonb_typeof(u.source_payload->'LastLoggedInAt') = 'string'
     AND coalesce(u.source_payload->>'LastLoggedInAt','') ~ '^[0-9]{4}-'
      THEN (u.source_payload->>'LastLoggedInAt')::timestamptz
    WHEN coalesce(u.source_payload #>> '{Last_Signin,v}', '') ~ '^[0-9]{4}-'
      THEN (u.source_payload #>> '{Last_Signin,v}')::timestamptz
    WHEN coalesce(u.source_payload #>> '{_last_access,v}', '') ~ '^[0-9]{4}-'
      THEN (u.source_payload #>> '{_last_access,v}')::timestamptz
    ELSE NULL
  END
)"
REPORT_USER_LAST_SIGN_IN_IST_SQL="to_char((${REPORT_USER_LAST_SIGN_IN_SQL}) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')"
# Prefer the user row with the newest last-sign-in across all snapshots (not the latest ingest).
REPORT_BEST_USER_ORDER_SQL="COALESCE(
  u0.last_sign_in,
  CASE
    WHEN coalesce(u0.source_payload #>> '{LastLoggedInAt,v}', '') ~ '^[0-9]{4}-'
      THEN (u0.source_payload #>> '{LastLoggedInAt,v}')::timestamptz
    WHEN coalesce(u0.source_payload #>> '{LastLoggedInAt,dv}', '') ~ '^[0-9]{4}-'
      THEN (u0.source_payload #>> '{LastLoggedInAt,dv}')::timestamptz
    WHEN jsonb_typeof(u0.source_payload->'LastLoggedInAt') = 'string'
     AND coalesce(u0.source_payload->>'LastLoggedInAt','') ~ '^[0-9]{4}-'
      THEN (u0.source_payload->>'LastLoggedInAt')::timestamptz
    WHEN coalesce(u0.source_payload #>> '{Last_Signin,v}', '') ~ '^[0-9]{4}-'
      THEN (u0.source_payload #>> '{Last_Signin,v}')::timestamptz
    ELSE NULL
  END
) DESC NULLS LAST,
  u0.snapshot_at DESC"
REPORT_BEST_USER_FROM_SQL="(
  SELECT DISTINCT ON (u0.user_id)
    u0.user_id, u0.user_name, u0.last_sign_in, u0.ever_logged_in, u0.source_payload
  FROM engagement_reporting.\"user\" u0
  WHERE u0.environment = 'production'
  ORDER BY u0.user_id, ${REPORT_BEST_USER_ORDER_SQL}
) u"

# Parse a Kissflow datetime jsonb value (ISO string, {v}/{dv}, naive IST).
# Arg: jsonb expression such as source_payload->'_created_at'
report_kf_ts_sql() {
  local col="${1:?jsonb datetime expression required}"
  cat <<EOF
CASE
  WHEN jsonb_typeof(${col}) = 'number' THEN
    CASE
      WHEN (${col} #>> '{}')::numeric > 1000000000000
        THEN to_timestamp(((${col} #>> '{}')::numeric) / 1000.0)
      WHEN (${col} #>> '{}')::numeric > 1000000000
        THEN to_timestamp((${col} #>> '{}')::numeric)
      ELSE NULL
    END
  WHEN jsonb_typeof(${col}) = 'string'
   AND (${col} #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    CASE
      WHEN (${col} #>> '{}') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        THEN (${col} #>> '{}')::timestamptz
      ELSE (${col} #>> '{}')::timestamp AT TIME ZONE 'Asia/Kolkata'
    END
  WHEN jsonb_typeof(${col}) = 'object'
   AND coalesce(${col}->>'v', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    CASE
      WHEN (${col}->>'v') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        THEN (${col}->>'v')::timestamptz
      ELSE (${col}->>'v')::timestamp AT TIME ZONE 'Asia/Kolkata'
    END
  WHEN jsonb_typeof(${col}) = 'object'
   AND coalesce(${col}->>'dv', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    CASE
      WHEN (${col}->>'dv') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        THEN (${col}->>'dv')::timestamptz
      ELSE (${col}->>'dv')::timestamp AT TIME ZONE 'Asia/Kolkata'
    END
  ELSE NULL
END
EOF
}

# Item created-at. Kissflow system field is _created_at; some apps only set Requested_Date.
report_item_created_at_sql() {
  local src="${1:-source_payload}"
  cat <<EOF
COALESCE(
  $(report_kf_ts_sql "${src}->'_created_at'"),
  $(report_kf_ts_sql "${src}->'Requested_Date'"),
  $(report_kf_ts_sql "${src}->'Requester_Date__Time'"),
  $(report_kf_ts_sql "${src}->'_submitted_at'"),
  $(report_kf_ts_sql "${src}->'CreatedAt'"),
  $(report_kf_ts_sql "${src}->'Created_On'"),
  $(report_kf_ts_sql "${src}->'Lead_Created_Date'")
)
EOF
}

# Item completed-at. Kissflow process list payloads omit _completed_at —
# use _modified_at when the item is business-closed (Completed / reopen hold).
# ITSM reopen hold (IT Tech Reopen / ReOpen Window / Employee Feedback) prefers
# _modified_at first — matches aasik_ITSM getRefexClosedAtRaw.
# Arg1: source_payload expression. Arg2: table qualifier prefix (e.g. "i." or "").
report_item_completed_at_sql() {
  local src="${1:-source_payload}"
  local q="${2:-}"
  local step_expr="lower(trim(coalesce(${q}current_step, ${src}->>'_current_step', '')))"
  local reopen_sql="(
    ${q}process_status = 'InProgress'
    AND (
      ${step_expr} LIKE '%it tech reopen%'
      OR ${step_expr} LIKE '%reopen window%'
      OR ${step_expr} LIKE '%employee feedback%'
      OR ${step_expr} LIKE '%employee verification%'
      OR ${step_expr} = 'ticket reopen'
      OR (${step_expr} LIKE '%ticket reopen%' AND ${step_expr} NOT LIKE '%reopened%')
    )
    AND ${step_expr} NOT LIKE '%it agent pickup%'
    AND ${step_expr} NOT LIKE '%it agent solution%'
    AND ${step_expr} NOT LIKE '%dependency%'
  )"
  cat <<EOF
CASE
  WHEN ${reopen_sql} THEN
    COALESCE(
      $(report_kf_ts_sql "${src}->'_modified_at'"),
      $(report_kf_ts_sql "${src}->'_completed_at'"),
      $(report_kf_ts_sql "${src}->'_closed_at'"),
      $(report_kf_ts_sql "${src}->'Completed_On'"),
      $(report_kf_ts_sql "${src}->'Closed_On'"),
      $(report_kf_ts_sql "${src}->'Completed_Date'"),
      $(report_kf_ts_sql "${src}->'Closed_Date'")
    )
  ELSE
    COALESCE(
      $(report_kf_ts_sql "${src}->'_completed_at'"),
      $(report_kf_ts_sql "${src}->'_closed_at'"),
      $(report_kf_ts_sql "${src}->'Completed_On'"),
      $(report_kf_ts_sql "${src}->'Closed_On'"),
      $(report_kf_ts_sql "${src}->'Completed_Date'"),
      $(report_kf_ts_sql "${src}->'Closed_Date'"),
      CASE
        WHEN ${q}process_status = 'Completed'
          OR lower(coalesce(${q}process_status, '')) IN ('completed', 'complete')
          OR lower(trim(coalesce(${src}->>'Lead_Status', ''))) IN ('close', 'closed', 'completed', 'done')
        THEN $(report_kf_ts_sql "${src}->'_modified_at'")
        ELSE NULL
      END
    )
END
EOF
}

REPORT_ITEM_CREATED_AT_SQL="$(report_item_created_at_sql source_payload)"
REPORT_ITEM_COMPLETED_AT_SQL="$(report_item_completed_at_sql source_payload '')"
REPORT_ITEM_CREATED_AT_I_SQL="$(report_item_created_at_sql i.source_payload)"
REPORT_ITEM_COMPLETED_AT_I_SQL="$(report_item_completed_at_sql i.source_payload 'i.')"
REPORT_IST_TODAY_SQL="(now() AT TIME ZONE 'Asia/Kolkata')::date"

# Overlay ticket KPIs from live Kissflow list (Lead Tracker pattern).
# Sets REPORT_LIVE_* counts and REPORT_LIVE_SOURCE_JSON (source_all / source_opened_today).
# Args: process_id, application_id (optional), entity_filter (optional).
report_live_today_kpis() {
  local process_id="${1:-}"
  local application_id="${2:-}"
  local entity_filter="${3:-}"
  REPORT_LIVE_OPENED_TODAY=""
  REPORT_LIVE_CLOSED_TODAY=""
  REPORT_LIVE_TOTAL_TICKETS=""
  REPORT_LIVE_OPEN_TICKETS=""
  REPORT_LIVE_CLOSED_TICKETS=""
  REPORT_LIVE_SOURCE_JSON=""
  [[ -n "${process_id}" ]] || return 1
  local script="${REPO_ROOT:-}/services/engagement-pipeline/scripts/count-live-today-kpis.js"
  if [[ ! -f "${script}" ]]; then
    script="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/services/engagement-pipeline/scripts/count-live-today-kpis.js"
  fi
  [[ -f "${script}" ]] || return 1
  command -v node >/dev/null 2>&1 || return 1
  local json
  if ! json="$(
    PROCESS_ID="${process_id}" \
    APPLICATION_ID="${application_id}" \
    ENTITY_FILTER="${entity_filter}" \
    node "${script}" 2>/dev/null
  )"; then
    return 1
  fi
  REPORT_LIVE_OPENED_TODAY="$(jq -r '.opened_today // empty' <<< "${json}" 2>/dev/null || true)"
  REPORT_LIVE_CLOSED_TODAY="$(jq -r '.closed_today // empty' <<< "${json}" 2>/dev/null || true)"
  REPORT_LIVE_TOTAL_TICKETS="$(jq -r '.total_tickets // empty' <<< "${json}" 2>/dev/null || true)"
  REPORT_LIVE_OPEN_TICKETS="$(jq -r '.open_tickets // empty' <<< "${json}" 2>/dev/null || true)"
  REPORT_LIVE_CLOSED_TICKETS="$(jq -r '.closed_tickets // empty' <<< "${json}" 2>/dev/null || true)"
  REPORT_LIVE_SOURCE_JSON="$(jq -c '{source_all:(.source_all//{}),source_open:(.source_open//{}),source_opened_today:(.source_opened_today//{})}' <<< "${json}" 2>/dev/null || true)"
  [[ -n "${REPORT_LIVE_OPENED_TODAY}${REPORT_LIVE_CLOSED_TODAY}${REPORT_LIVE_TOTAL_TICKETS}" ]] || return 1
  return 0
}

# Prefer live overlay when present; keep SQL value as fallback.
report_prefer_live_today() {
  local sql_val="${1:-0}"
  local live_val="${2:-}"
  if [[ -n "${live_val}" && "${live_val}" =~ ^[0-9]+$ ]]; then
    printf '%s' "${live_val}"
  else
    printf '%s' "${sql_val:-0}"
  fi
}

# Prefer the newest completed snapshot (scheduled ingest writes this just before render).
# item_record_count is only a tie-breaker so a sparse same-second run cannot win over a fuller one.
# Arg1: application_id SQL literal (already quoted). Arg2: process_id SQL literal.
report_latest_snapshot_cte() {
  local app_lit="${1:?application_id literal required}"
  local proc_lit="${2:?process_id literal required}"
  cat <<EOF
latest AS (
  SELECT snapshot_run_id
  FROM engagement_reporting.snapshot_run
  WHERE application_id = ${app_lit}
    AND process_id = ${proc_lit}
    AND environment = 'production'
    AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
  ORDER BY
    COALESCE(load_completed_at, extraction_completed_at, created_at) DESC,
    COALESCE(item_record_count, 0) DESC
  LIMIT 1
)
EOF
}

# MIS table row background: green when last_sign_in (YYYY-MM-DD …) is today IST.
# Usage inside jq with --arg today "${TODAY_IST}".
REPORT_MIS_ROW_BG_JQ='(if ((.value.last_sign_in // "") | tostring | startswith($today)) then "#dcfce7" elif (.key % 2 == 0) then "#faf9f7" else "#ffffff" end)'
REPORT_MIS_SIGNIN_CELL_JQ='(if ((.value.last_sign_in // "") | tostring | startswith($today)) then "padding:12px 14px; border-bottom:1px solid #bbf7d0; color:#166534 !important; font-weight:bold;" else "padding:12px 14px; border-bottom:1px solid #ececea; color:#1a1a1a !important;" end)'

report_template_seed_for_app() {
  case "${1:-}" in
    IT_Service_Management_A00)
      # Extrovis process uses the Extrovis seed (no User Sign-in Overview).
      if [[ "${ITSM_PROCESS_ID:-${PROCESS_ID:-}}" == *[Ee]xtrovis* ]]; then
        printf '%s' 'db/seeds/itsm-extrovis-engagement-template.html'
      else
        printf '%s' 'db/seeds/itsm-engagement-template.html'
      fi
      ;;
    Project_Management_Tracker_A00) printf '%s' 'db/seeds/pm-engagement-template.html' ;;
    Solar_Site_Expense_Governance_Syst_A00) printf '%s' 'db/seeds/solar-reinvestment-template.html' ;;
    Lead_Trcaker_A00) printf '%s' 'db/seeds/lead-tracker-report-template.html' ;;
    EMS_001_A00) printf '%s' 'db/seeds/expense-engagement-template.html' ;;
    Expense_and_Travel_Management_A00) printf '%s' 'db/seeds/travel-engagement-template.html' ;;
    *) return 1 ;;
  esac
}

report_template_file_looks_like_html() {
  local f="$1"
  [[ -s "${f}" ]] || return 1
  local head
  head="$(head -c 64 "${f}" | tr -d '\r' | sed 's/^[[:space:]]*//')"
  [[ "${head}" == \<* ]]
}

# Decode base64 payload from psql (-t -A) into $1. Avoids COPY text-format escaping
# which turns real newlines into literal "\n" visible in the emailed HTML.
report_template_decode_b64_to_file() {
  local out_file="$1"
  local b64
  b64="$(tr -d '\r\n[:space:]')"
  [[ -n "${b64}" ]] || return 1
  if command -v base64 >/dev/null 2>&1; then
    if printf '%s' "${b64}" | base64 --decode > "${out_file}" 2>/dev/null; then
      return 0
    fi
    if printf '%s' "${b64}" | base64 -d > "${out_file}" 2>/dev/null; then
      return 0
    fi
    if printf '%s' "${b64}" | base64 -D > "${out_file}" 2>/dev/null; then
      return 0
    fi
  fi
  # Fallback when base64 CLI is unavailable (Node is always present in schedule-runner).
  B64_PAYLOAD="${b64}" OUT_FILE="${out_file}" node -e \
    "require('fs').writeFileSync(process.env.OUT_FILE, Buffer.from(process.env.B64_PAYLOAD, 'base64'))" \
    2>/dev/null
}

# Prefer published inline HTML over stale seed file paths.
# Writes resolved template HTML to $1 (output file path).
report_template_load_html() {
  local out_file="$1"
  local repo
  repo="$(report_template_repo_root)"
  local pg_conn
  pg_conn="$(report_template_pg_conn)"
  local loaded=0
  local b64_tmp
  b64_tmp="$(mktemp)"

  # Stream latest template version as base64 (avoids shell truncation AND COPY \n escaping).
  if [[ -n "${TEMPLATE_ID:-}" ]]; then
    if psql "${pg_conn}" -v ON_ERROR_STOP=1 -t -A -c "
      SELECT encode(convert_to(content_ref, 'UTF8'), 'base64')
      FROM engagement_reporting.report_template_version
      WHERE report_template_id = '${TEMPLATE_ID}'::uuid
      ORDER BY
        CASE
          WHEN ltrim(content_ref) LIKE '<!%' THEN 0
          WHEN ltrim(content_ref) ILIKE '<html%' THEN 0
          WHEN ltrim(content_ref) LIKE '<%' THEN 0
          ELSE 1
        END,
        version_number DESC
      LIMIT 1
    " > "${b64_tmp}" 2>/dev/null \
      && report_template_decode_b64_to_file "${out_file}" < "${b64_tmp}" \
      && report_template_file_looks_like_html "${out_file}"; then
      loaded=1
    fi
  fi

  # Fallback: latest published template bound to this application (inline preferred).
  if [[ "${loaded}" -ne 1 && -n "${APPLICATION_ID:-}" ]]; then
    if psql "${pg_conn}" -v ON_ERROR_STOP=1 -t -A -c "
      SELECT encode(convert_to(rtv.content_ref, 'UTF8'), 'base64')
      FROM engagement_reporting.report_template_version rtv
      JOIN engagement_reporting.report_definition_version rdv
        ON rdv.config->>'template_id' = rtv.report_template_id::text
      WHERE rdv.config->>'application_id' = '${APPLICATION_ID}'
        AND COALESCE(rdv.config->>'status', 'published') = 'published'
      ORDER BY
        CASE
          WHEN ltrim(rtv.content_ref) LIKE '<!%' THEN 0
          WHEN ltrim(rtv.content_ref) ILIKE '<html%' THEN 0
          WHEN ltrim(rtv.content_ref) LIKE '<%' THEN 0
          ELSE 1
        END,
        rtv.version_number DESC,
        rdv.frozen_at DESC NULLS LAST
      LIMIT 1
    " > "${b64_tmp}" 2>/dev/null \
      && report_template_decode_b64_to_file "${out_file}" < "${b64_tmp}" \
      && report_template_file_looks_like_html "${out_file}"; then
      loaded=1
    fi
  fi

  rm -f "${b64_tmp}"

  if [[ "${loaded}" -eq 1 ]]; then
    return 0
  fi

  # Legacy: content_ref is a seed file path — copy from disk (may be stale vs Admin UI publish).
  local content_ref=""
  if [[ -n "${TEMPLATE_ID:-}" ]]; then
    content_ref="$(psql "${pg_conn}" -t -A -c "
      SELECT COALESCE((
        SELECT rtv.content_ref
        FROM engagement_reporting.report_template_version rtv
        WHERE rtv.report_template_id = '${TEMPLATE_ID}'::uuid
          AND ltrim(rtv.content_ref) NOT LIKE '<!%'
          AND ltrim(rtv.content_ref) NOT ILIKE '<html%'
          AND ltrim(rtv.content_ref) NOT LIKE '<%'
        ORDER BY rtv.version_number DESC
        LIMIT 1
      ), '');
    " 2>/dev/null | tr -d '\r' | head -c 512 || true)"
  fi

  if [[ -z "${content_ref}" || "${content_ref}" == \<* ]]; then
    content_ref="$(report_template_seed_for_app "${APPLICATION_ID:-}" || true)"
  fi

  [[ -n "${content_ref}" ]] || { rm -f "${out_file}"; return 1; }

  local abs="${content_ref}"
  if [[ "${abs}" != /* ]]; then
    abs="${repo}/${content_ref}"
  fi

  if [[ -f "${abs}" ]]; then
    cp "${abs}" "${out_file}"
    return 0
  fi

  rm -f "${out_file}"
  return 1
}

# Renders placeholders using apply-report-template.js
# Args: $1=output_html $2=vars_json_file $3=source_template_html_file
report_template_render() {
  local output_file="$1"
  local vars_file="$2"
  local template_file="$3"
  local repo script
  repo="$(report_template_repo_root)"
  script="${repo}/services/engagement-pipeline/scripts/apply-report-template.js"

  [[ -f "${script}" ]] || return 1
  [[ -f "${template_file}" ]] || return 1
  [[ -f "${vars_file}" ]] || return 1

  TEMPLATE_HTML_IN="${template_file}" \
  TEMPLATE_VARS_JSON="${vars_file}" \
  TEMPLATE_HTML_OUT="${output_file}" \
  node "${script}"
}

# Make the Total Users KPI subtitle readable in email: "3 of 32 today".
report_template_emphasize_users_kpi() {
  local html_file="$1"
  [[ -f "${html_file}" ]] || return 0
  python3 - "${html_file}" <<'PY'
import re
import sys
from pathlib import Path
path = Path(sys.argv[1])
html = path.read_text(encoding="utf-8")
html = re.sub(
    r"\{\{\s*SignedInToday\s*\}\}\s+signed in today",
    "{{SignedInToday}} of {{TotalUsers}} today",
    html,
    flags=re.IGNORECASE,
)
html = re.sub(
    r'font-size:9(?:\.5)?px;\s*color:#3f8f63\s*!important;\s*margin-top:2px;">(\{\{\s*SignedInToday\s*\}\})',
    r'font-size:11px; font-weight:bold; color:#14503a !important; margin-top:2px; line-height:1.25;">\1',
    html,
    flags=re.IGNORECASE,
)
path.write_text(html, encoding="utf-8")
PY
}
