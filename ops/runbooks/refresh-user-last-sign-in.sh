#!/usr/bin/env bash
# Refresh Kissflow last-sign-in for report users and store the best known value.
# LastLoggedInAt is on GET /user/2/{account}/{id} (omitted when the user never signed in).
# The user *list* API does not include it.
#
# Usage:
#   source ops/runbooks/refresh-user-last-sign-in.sh
#   refresh_user_last_sign_ins_for_process "$APPLICATION_ID" "$PROCESS_ID"

refresh_user_last_sign_in_log() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

refresh_user_last_sign_in_parse_jq() {
  cat <<'JQ'
{
  user_id: (.__requested_user_id // ._id // $rid),
  user_name: (.Name // null),
  email: (.Email // null),
  user_type: (._user_type // null),
  active_status: (.Status // null),
  last_sign_in: (
    (if (.LastLoggedInAt | type) == "object" then (.LastLoggedInAt.v // .LastLoggedInAt.dv // .LastLoggedInAt.Date // null)
     elif (.LastLoggedInAt | type) == "string" then .LastLoggedInAt else null end)
    // (if (.Last_Signin | type) == "object" then (.Last_Signin.v // .Last_Signin.dv // null)
        elif (.Last_Signin | type) == "string" then .Last_Signin else null end)
    // (if (.LastSignIn | type) == "object" then (.LastSignIn.v // .LastSignIn.dv // null)
        elif (.LastSignIn | type) == "string" then .LastSignIn else null end)
    // (if (._last_access | type) == "object" then (._last_access.v // ._last_access.dv // null)
        elif (._last_access | type) == "string" then ._last_access else null end)
  ),
  ever_logged_in: (
    .LastLoggedInAt != null or .Last_Signin != null or .LastSignIn != null
    or ._last_access != null or .Ever_Logged_In == true
  ),
  source_payload: .
}
JQ
}

# Fetch one Kissflow user detail into a per-user JSON file (safe for parallel runs).
refresh_user_last_sign_in_fetch_one() {
  local uid="$1" out_file="$2"
  local account_id="${KISSFLOW_ACCOUNT_ID:-AcCMptlq60zH}"
  local base_url="${KISSFLOW_BASE_URL:-https://refexgroup.kissflow.com}"
  local tmp http_code
  tmp="$(mktemp)"
  http_code="$(curl --silent --show-error --location --connect-timeout 15 --max-time 45 \
    --retry 2 --retry-delay 1 \
    -H "X-Access-Key-Id: ${KISSFLOW_KEY:-}" \
    -H "X-Access-Key-Secret: ${KISSFLOW_SECRET:-}" \
    -H "Accept: application/json" \
    --output "${tmp}" --write-out '%{http_code}' \
    "${base_url}/user/2/${account_id}/${uid}" || echo ERR)"
  if [[ "${http_code}" == "200" ]] && jq empty "${tmp}" 2>/dev/null; then
    jq -c --arg rid "${uid}" "$(refresh_user_last_sign_in_parse_jq)" "${tmp}" > "${out_file}"
  fi
  rm -f "${tmp}"
}

# Load normalized JSONL into engagement_reporting."user", keeping any newer previous last_sign_in.
refresh_user_last_sign_in_load_jsonl() {
  local jsonl="$1"
  local env="${ENVIRONMENT:-production}"
  local run_id="${2:-login-refresh-$(date -u +'%Y%m%dT%H%M%SZ')}"
  local gen
  gen="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  local pg
  pg="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE:-engagement_reporting} user=${PGUSER:-postgres}"
  local work
  work="$(mktemp -d)"
  jq -c --arg run_id "${run_id}" --arg gen "${gen}" --arg env "${env}" \
    '. + {snapshot_run_id:$run_id, snapshot_at:$gen, environment:$env}' \
    "${jsonl}" > "${work}/users.jsonl"
  jq -r '[.user_id, .snapshot_at, (.user_name // ""), (.email // ""), (.user_type // ""), (.active_status // ""), (.last_sign_in // ""), (.ever_logged_in | tostring), (.source_payload | tojson)] | @csv' \
    "${work}/users.jsonl" > "${work}/users.csv"

  psql "${pg}" -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS engagement_reporting.stg_login_refresh (
  user_id text, snapshot_at text, user_name text, email text, user_type text,
  active_status text, last_sign_in text, ever_logged_in text, source_payload text
);
TRUNCATE engagement_reporting.stg_login_refresh;
"
  psql "${pg}" -v ON_ERROR_STOP=1 -c \
    "\\copy engagement_reporting.stg_login_refresh FROM '${work}/users.csv' WITH (FORMAT csv)"
  psql "${pg}" -v ON_ERROR_STOP=1 -c "
INSERT INTO engagement_reporting.snapshot_run (
  snapshot_run_id, source_system, environment, application_id, process_id,
  extraction_started_at, extraction_completed_at, load_started_at, load_completed_at,
  status, user_record_count, role_record_count, item_record_count, assignment_record_count,
  unresolved_role_count, source_manifest
) VALUES (
  '${run_id}', 'KISSFLOW', '${env}', 'KISSFLOW_USER_DIRECTORY', 'user_last_sign_in',
  now(), now(), now(), now(), 'COMPLETED', 0, 0, 0, 0, 0, '{}'::jsonb
)
ON CONFLICT (snapshot_run_id) DO NOTHING;
"
  psql "${pg}" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO engagement_reporting."user" (
  environment, user_id, snapshot_at, snapshot_run_id, user_name, email, user_type,
  active_status, last_sign_in, ever_logged_in, source_payload, row_hash
)
SELECT
  '${env}',
  s.user_id,
  s.snapshot_at::timestamptz,
  '${run_id}',
  COALESCE(NULLIF(s.user_name, ''), prev.user_name),
  COALESCE(NULLIF(s.email, ''), prev.email),
  COALESCE(NULLIF(s.user_type, ''), prev.user_type),
  COALESCE(NULLIF(s.active_status, ''), prev.active_status),
  COALESCE(NULLIF(s.last_sign_in, '')::timestamptz, prev.last_sign_in),
  COALESCE(NULLIF(s.ever_logged_in, '')::boolean, prev.ever_logged_in, false),
  CASE
    WHEN NULLIF(s.last_sign_in, '') IS NOT NULL THEN s.source_payload::jsonb
    WHEN prev.source_payload ? 'LastLoggedInAt' THEN
      s.source_payload::jsonb || jsonb_build_object('LastLoggedInAt', prev.source_payload->'LastLoggedInAt')
    ELSE s.source_payload::jsonb
  END,
  md5(COALESCE(s.source_payload, '{}'))
FROM engagement_reporting.stg_login_refresh s
LEFT JOIN LATERAL (
  SELECT u.user_name, u.email, u.user_type, u.active_status, u.last_sign_in, u.ever_logged_in, u.source_payload
  FROM engagement_reporting."user" u
  WHERE u.environment = '${env}' AND u.user_id = s.user_id
  ORDER BY u.last_sign_in DESC NULLS LAST, u.snapshot_at DESC
  LIMIT 1
) prev ON true
WHERE NULLIF(s.user_id, '') IS NOT NULL
ON CONFLICT (environment, user_id, snapshot_at) DO NOTHING;
SQL
  rm -rf "${work}"
}

# Collect user ids that appear on this process snapshot (assignees, role members, created/modified by).
refresh_user_ids_for_process() {
  local app_id="$1"
  local process_id="$2"
  local pg
  pg="host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE:-engagement_reporting} user=${PGUSER:-postgres}"
  psql "${pg}" -t -A -c "
SELECT DISTINCT uid
FROM (
  WITH latest AS (
    SELECT snapshot_run_id
    FROM engagement_reporting.snapshot_run
    WHERE application_id = '$(printf '%s' "${app_id}" | sed "s/'/''/g")'
      AND process_id = '$(printf '%s' "${process_id}" | sed "s/'/''/g")'
      AND environment = '${ENVIRONMENT:-production}'
      AND status NOT IN ('IN_PROGRESS', 'PENDING', 'FAILED')
    ORDER BY COALESCE(load_completed_at, extraction_completed_at, created_at) DESC
    LIMIT 1
  )
  SELECT ia.principal_id AS uid
  FROM engagement_reporting.item_assignment ia, latest l
  WHERE ia.snapshot_run_id = l.snapshot_run_id
    AND ia.principal_type = 'USER'
  UNION
  SELECT pu.user_id
  FROM engagement_reporting.item_assignment ia
  JOIN latest l ON ia.snapshot_run_id = l.snapshot_run_id
  JOIN engagement_reporting.principal_user pu
    ON pu.principal_id = ia.principal_id
   AND pu.principal_type = 'APP_ROLE'
   AND pu.valid_to IS NULL
   AND pu.user_id IS NOT NULL
  WHERE ia.principal_type = 'APP_ROLE'
  UNION
  SELECT pu.user_id
  FROM engagement_reporting.principal_user pu
  WHERE pu.application_id = '$(printf '%s' "${app_id}" | sed "s/'/''/g")'
    AND pu.valid_to IS NULL
    AND pu.principal_type = 'APP_ROLE'
    AND pu.user_id IS NOT NULL
    AND trim(pu.user_id) <> ''
  UNION
  SELECT NULLIF(i.source_payload->'Assigned_To'->>'_id', '')
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id
  UNION
  SELECT NULLIF(i.source_payload->'_created_by'->>'_id', '')
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id
  UNION
  SELECT NULLIF(i.source_payload->'_modified_by'->>'_id', '')
  FROM engagement_reporting.item i, latest l
  WHERE i.snapshot_run_id = l.snapshot_run_id
) ids
WHERE uid IS NOT NULL AND trim(uid) <> ''
ORDER BY 1;
"
}

refresh_user_last_sign_ins_for_process() {
  local app_id="${1:-}"
  local process_id="${2:-}"
  [[ -n "${app_id}" && -n "${process_id}" ]] || return 0
  if [[ -z "${KISSFLOW_KEY:-}" || -z "${KISSFLOW_SECRET:-}" ]]; then
    refresh_user_last_sign_in_log "Skip last-sign-in refresh (Kissflow credentials not set)"
    return 0
  fi

  local ids_file work jsonl
  ids_file="$(mktemp)"
  work="$(mktemp -d)"
  jsonl="$(mktemp)"
  refresh_user_ids_for_process "${app_id}" "${process_id}" > "${ids_file}"
  local count
  count="$(grep -c . "${ids_file}" || true)"
  if [[ "${count}" -eq 0 ]]; then
    refresh_user_last_sign_in_log "No process users to refresh last-sign-in for ${app_id}/${process_id}"
    rm -rf "${ids_file}" "${work}" "${jsonl}"
    return 0
  fi
  refresh_user_last_sign_in_log "Refreshing last-sign-in from Kissflow user detail for ${count} users (${app_id})"

  local running=0
  local max_parallel="${LOGIN_REFRESH_PARALLEL:-8}"
  local idx=0
  while IFS= read -r uid; do
    [[ -z "${uid}" ]] && continue
    idx=$((idx + 1))
    refresh_user_last_sign_in_fetch_one "${uid}" "${work}/${idx}.json" &
    running=$((running + 1))
    if [[ "${running}" -ge "${max_parallel}" ]]; then
      wait
      running=0
    fi
  done < "${ids_file}"
  wait
  cat "${work}"/*.json > "${jsonl}" 2>/dev/null || true

  local fetched
  fetched="$(wc -l < "${jsonl}" | tr -d ' ')"
  if [[ "${fetched}" -gt 0 ]]; then
    refresh_user_last_sign_in_load_jsonl "${jsonl}"
    refresh_user_last_sign_in_log "Stored last-sign-in for ${fetched} Kissflow users"
  else
    refresh_user_last_sign_in_log "Kissflow returned no user-detail rows for last-sign-in"
  fi
  rm -rf "${ids_file}" "${work}" "${jsonl}"
}
