#!/usr/bin/env bash
# Persist email send outcome to engagement_reporting.report_run + report_delivery
# so Admin UI Sent history and per-app History tab can list deliveries.
set -Eeuo pipefail

log() { printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"

if ! command -v psql >/dev/null 2>&1; then
  log "psql not available — skipping delivery history record"
  exit 0
fi

PSQL=(psql "host=${PGHOST:-localhost} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}" -v ON_ERROR_STOP=1)

ENVIRONMENT="${ENVIRONMENT:-production}"
APPLICATION_ID="${APPLICATION_ID:-}"
PROCESS_ID="${PROCESS_ID:-}"
DELIVERY_STATUS="${DELIVERY_STATUS:-${STATUS:-SENT}}"
REPORT_RUN_ID="${REPORT_RUN_ID:-report-run-$(date -u +'%Y%m%dT%H%M%SZ')}"
NOW="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
COMPLETED_AT="${COMPLETED_AT:-${NOW}}"
SCHEDULE_ID="${SCHEDULE_ID:-}"
ERROR_MESSAGE="${ERROR_MESSAGE:-}"

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

case "${DELIVERY_STATUS}" in
  SENT) RUN_STATUS="COMPLETED" ;;
  FAILED) RUN_STATUS="FAILED" ;;
  *) RUN_STATUS="FAILED" ;;
esac

if [[ -z "${APPLICATION_ID}" ]]; then
  log "APPLICATION_ID not set — skipping delivery history record"
  exit 0
fi

if [[ -z "${PROCESS_ID}" ]]; then
  PROCESS_ID="${APPLICATION_ID}"
fi

SNAPSHOT_RUN_ID="${SNAPSHOT_RUN_ID:-}"
if [[ -z "${SNAPSHOT_RUN_ID}" ]]; then
  SNAPSHOT_RUN_ID="$("${PSQL[@]}" -t -A -c "
    SELECT snapshot_run_id
    FROM engagement_reporting.snapshot_run
    WHERE environment = '$(sql_escape "${ENVIRONMENT}")'
      AND application_id = '$(sql_escape "${APPLICATION_ID}")'
      AND process_id = '$(sql_escape "${PROCESS_ID}")'
    ORDER BY created_at DESC
    LIMIT 1;
  " | tr -d '[:space:]')"
fi

if [[ -z "${SNAPSHOT_RUN_ID}" ]]; then
  SNAPSHOT_RUN_ID="$("${PSQL[@]}" -t -A -c "
    SELECT snapshot_run_id
    FROM engagement_reporting.snapshot_run
    WHERE environment = '$(sql_escape "${ENVIRONMENT}")'
      AND application_id = '$(sql_escape "${APPLICATION_ID}")'
    ORDER BY created_at DESC
    LIMIT 1;
  " | tr -d '[:space:]')"
fi

if [[ -z "${SNAPSHOT_RUN_ID}" ]]; then
  log "No snapshot_run_id found for ${APPLICATION_ID}/${PROCESS_ID} — skipping delivery history record"
  exit 0
fi

RECIPIENTS="${RECIPIENTS:-${RECIPIENT:-}}"
if [[ -z "${RECIPIENTS}" ]]; then
  log "No recipients — skipping delivery history record"
  exit 0
fi

ERR_SQL="NULL"
if [[ -n "${ERROR_MESSAGE}" ]]; then
  ERR_SQL="'$(sql_escape "${ERROR_MESSAGE}")'"
fi

IDEMPOTENCY_SQL="NULL"
if [[ -n "${SCHEDULE_ID}" ]]; then
  IDEMPOTENCY_SQL="'$(sql_escape "${SCHEDULE_ID}-${NOW}")'"
fi

"${PSQL[@]}" -c "
INSERT INTO engagement_reporting.report_run (
  report_run_id,
  snapshot_run_id,
  environment,
  application_id,
  process_id,
  scheduled_at,
  started_at,
  completed_at,
  status,
  error_message,
  idempotency_key
) VALUES (
  '$(sql_escape "${REPORT_RUN_ID}")',
  '$(sql_escape "${SNAPSHOT_RUN_ID}")',
  '$(sql_escape "${ENVIRONMENT}")',
  '$(sql_escape "${APPLICATION_ID}")',
  '$(sql_escape "${PROCESS_ID}")',
  '${COMPLETED_AT}'::timestamptz,
  '${COMPLETED_AT}'::timestamptz,
  '${COMPLETED_AT}'::timestamptz,
  '${RUN_STATUS}',
  ${ERR_SQL},
  ${IDEMPOTENCY_SQL}
)
ON CONFLICT (report_run_id) DO UPDATE SET
  status = EXCLUDED.status,
  scheduled_at = EXCLUDED.scheduled_at,
  started_at = EXCLUDED.started_at,
  completed_at = EXCLUDED.completed_at,
  error_message = EXCLUDED.error_message;
"

IFS=',' read -r -a RCPT_ARRAY <<< "${RECIPIENTS}"
for addr in "${RCPT_ARRAY[@]}"; do
  addr="${addr#"${addr%%[![:space:]]*}"}"
  addr="${addr%"${addr##*[![:space:]]}"}"
  [[ -z "${addr}" ]] && continue

  DELIVERED_AT_SQL="NULL"
  if [[ "${DELIVERY_STATUS}" == "SENT" ]]; then
    DELIVERED_AT_SQL="'${COMPLETED_AT}'::timestamptz"
  fi

  "${PSQL[@]}" -c "
  INSERT INTO engagement_reporting.report_delivery (
    report_run_id,
    recipient_email,
    delivery_status,
    attempted_at,
    delivered_at,
    error_message
  ) VALUES (
    '$(sql_escape "${REPORT_RUN_ID}")',
    '$(sql_escape "${addr}")',
    '$(sql_escape "${DELIVERY_STATUS}")',
    '${COMPLETED_AT}'::timestamptz,
    ${DELIVERED_AT_SQL},
    ${ERR_SQL}
  )
  ON CONFLICT (report_run_id, recipient_email) DO UPDATE SET
    delivery_status = EXCLUDED.delivery_status,
    attempted_at = EXCLUDED.attempted_at,
    delivered_at = EXCLUDED.delivered_at,
    error_message = EXCLUDED.error_message;
  "
done

log "Recorded delivery history: report_run_id=${REPORT_RUN_ID} status=${RUN_STATUS} app=${APPLICATION_ID}"
