#!/usr/bin/env bash
# ops/runbooks/32-provision-schedulers-from-postgresql.sh
#
# Create/update Cloud Scheduler jobs from engagement_reporting.report_schedule rows.
# Each job calls refex-schedule-runner with ?schedule_id=<uuid>.
#
# Usage:
#   bash ops/runbooks/32-provision-schedulers-from-postgresql.sh plan
#   SCHEDULE_RUNNER_URL=https://refex-schedule-runner-xxx.run.app \
#     PROVISION_APPROVED=true bash ops/runbooks/32-provision-schedulers-from-postgresql.sh sync
#   PROVISION_APPROVED=true bash ops/runbooks/32-provision-schedulers-from-postgresql.sh pause-all
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

GCP_PROJECT="${GCP_PROJECT:-master-diorama-489103-u2}"
GCP_REGION="${GCP_REGION:-asia-south1}"
SCHEDULE_RUNNER_URL="${SCHEDULE_RUNNER_URL:-}"
SCHEDULER_SA="${SCHEDULER_SA:-aasik-refex-report-scheduler@master-diorama-489103-u2.iam.gserviceaccount.com}"
ENVIRONMENT="${ENVIRONMENT:-production}"
APPLICATION_ID="${APPLICATION_ID:-}"
ACTIVE_ONLY="${ACTIVE_ONLY:-false}"

PGDATABASE="${PGDATABASE:-engagement_reporting}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-}"
PG_CONN="host=${PGHOST:-127.0.0.1} port=${PGPORT:-5432} dbname=${PGDATABASE} user=${PGUSER}"

log() { printf '[runbook-32] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_approval() {
  [[ "${PROVISION_APPROVED:-}" == "true" ]] || die "Set PROVISION_APPROVED=true to mutate Cloud Scheduler jobs"
}

require_gcloud() {
  command -v gcloud >/dev/null 2>&1 || die "gcloud CLI required"
  command -v psql >/dev/null 2>&1 || die "psql required"
  command -v jq >/dev/null 2>&1 || die "jq required"
}

job_name_for() {
  local legacy_id="$1"
  local schedule_id="$2"
  if [[ -n "${legacy_id}" && "${legacy_id}" != "null" ]]; then
    printf '%s' "${legacy_id}"
    return
  fi
  printf 'ne-schedule-%s' "$(echo "${schedule_id}" | tr '[:upper:]' '[:lower:]' | cut -c1-36)"
}

fetch_schedules_json() {
  local app_filter=""
  if [[ -n "${APPLICATION_ID}" ]]; then
    app_filter="AND rdv.config->>'application_id' = '${APPLICATION_ID}'"
  fi
  local active_filter=""
  if [[ "${ACTIVE_ONLY}" == "true" ]]; then
    active_filter="AND rs.is_active = true"
  fi

  psql "${PG_CONN}" -t -A -c "
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
    FROM (
      SELECT
        rs.report_schedule_id::text AS schedule_id,
        rs.cron_expression,
        rs.timezone,
        rs.is_active,
        rd.name AS schedule_name,
        rdv.config->>'application_id' AS application_id,
        rdv.config->>'legacy_scheduler_id' AS legacy_scheduler_id
      FROM engagement_reporting.report_schedule rs
      JOIN engagement_reporting.report_definition_version rdv
        ON rdv.report_definition_version_id = rs.report_definition_version_id
      JOIN engagement_reporting.report_definition rd
        ON rd.report_definition_id = rdv.report_definition_id
      JOIN engagement_reporting.account a ON a.account_id = rd.account_id
      WHERE a.environment = '${ENVIRONMENT}'
        ${app_filter}
        ${active_filter}
      ORDER BY rd.name
    ) t;
  "
}

plan() {
  require_gcloud
  log "Cloud Scheduler provision plan"
  log "Project:          ${GCP_PROJECT}"
  log "Region:           ${GCP_REGION}"
  log "Environment:      ${ENVIRONMENT}"
  log "Schedule runner:  ${SCHEDULE_RUNNER_URL:-<set SCHEDULE_RUNNER_URL>}"
  log "Scheduler SA:     ${SCHEDULER_SA}"
  log "Active only:      ${ACTIVE_ONLY}"
  log ""
  local rows
  rows="$(fetch_schedules_json)"
  local count
  count="$(printf '%s' "${rows}" | jq 'length')"
  log "PostgreSQL schedules: ${count}"
  printf '%s' "${rows}" | jq -r '.[] | "- \(.schedule_name) [\(.schedule_id)] cron=\(.cron_expression) tz=\(.timezone) active=\(.is_active) job=\(.legacy_scheduler_id // "ne-schedule-<id>")"'
  log ""
  log "Legacy scheduler (unchanged by this runbook unless you pause manually):"
  log "  aasik-refex-report-itsm-a00-svcreq-a00-scheduler"
  log ""
  log "Deploy schedule runner first:"
  log "  bash ops/runbooks/32-deploy-schedule-runner.sh plan"
  log "  DEPLOY_APPROVED=true bash ops/runbooks/32-deploy-schedule-runner.sh deploy"
}

sync_one() {
  local schedule_id="$1"
  local cron="$2"
  local tz="$3"
  local is_active="$4"
  local job_name="$5"
  local uri="${SCHEDULE_RUNNER_URL%/}/?schedule_id=${schedule_id}"

  if gcloud scheduler jobs describe "${job_name}" \
    --location="${GCP_REGION}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${job_name}" \
      --location="${GCP_REGION}" --project="${GCP_PROJECT}" \
      --schedule="${cron}" \
      --time-zone="${tz}" \
      --uri="${uri}" \
      --http-method=GET \
      --oidc-service-account-email="${SCHEDULER_SA}" \
      --oidc-token-audience="${SCHEDULE_RUNNER_URL}" \
      --quiet
    log "Updated job ${job_name}"
  else
    gcloud scheduler jobs create http "${job_name}" \
      --location="${GCP_REGION}" --project="${GCP_PROJECT}" \
      --schedule="${cron}" \
      --time-zone="${tz}" \
      --uri="${uri}" \
      --http-method=GET \
      --oidc-service-account-email="${SCHEDULER_SA}" \
      --oidc-token-audience="${SCHEDULE_RUNNER_URL}" \
      --quiet
    log "Created job ${job_name}"
  fi

  if [[ "${is_active}" == "true" ]]; then
    gcloud scheduler jobs resume "${job_name}" \
      --location="${GCP_REGION}" --project="${GCP_PROJECT}" --quiet 2>/dev/null || true
    log "  state: ENABLED (is_active=true in PostgreSQL)"
  else
    gcloud scheduler jobs pause "${job_name}" \
      --location="${GCP_REGION}" --project="${GCP_PROJECT}" --quiet 2>/dev/null || true
    log "  state: PAUSED (is_active=false in PostgreSQL)"
  fi
}

sync_all() {
  require_approval
  require_gcloud
  [[ -n "${SCHEDULE_RUNNER_URL}" ]] || die "Set SCHEDULE_RUNNER_URL to the deployed refex-schedule-runner URL"

  local rows
  rows="$(fetch_schedules_json)"
  local count
  count="$(printf '%s' "${rows}" | jq 'length')"
  [[ "${count}" -gt 0 ]] || die "No schedules found for environment=${ENVIRONMENT}"

  log "Syncing ${count} Cloud Scheduler job(s)"
  while IFS= read -r row; do
    [[ -n "${row}" ]] || continue
    local schedule_id cron tz is_active legacy_id job_name
    schedule_id="$(printf '%s' "${row}" | jq -r '.schedule_id')"
    cron="$(printf '%s' "${row}" | jq -r '.cron_expression')"
    tz="$(printf '%s' "${row}" | jq -r '.timezone')"
    is_active="$(printf '%s' "${row}" | jq -r '.is_active')"
    legacy_id="$(printf '%s' "${row}" | jq -r '.legacy_scheduler_id // empty')"
    job_name="$(job_name_for "${legacy_id}" "${schedule_id}")"
    sync_one "${schedule_id}" "${cron}" "${tz}" "${is_active}" "${job_name}"
  done < <(printf '%s' "${rows}" | jq -c '.[]')

  log "Sync complete"
}

pause_all() {
  require_approval
  require_gcloud
  local rows
  rows="$(fetch_schedules_json)"
  while IFS= read -r row; do
    [[ -n "${row}" ]] || continue
    local schedule_id legacy_id job_name
    schedule_id="$(printf '%s' "${row}" | jq -r '.schedule_id')"
    legacy_id="$(printf '%s' "${row}" | jq -r '.legacy_scheduler_id // empty')"
    job_name="$(job_name_for "${legacy_id}" "${schedule_id}")"
    if gcloud scheduler jobs describe "${job_name}" \
      --location="${GCP_REGION}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
      gcloud scheduler jobs pause "${job_name}" \
        --location="${GCP_REGION}" --project="${GCP_PROJECT}" --quiet
      log "Paused ${job_name}"
    fi
  done < <(printf '%s' "${rows}" | jq -c '.[]')
}

usage() {
  cat <<EOF
Usage: $0 {plan|sync|pause-all}

  plan       — list PostgreSQL schedules and intended Cloud Scheduler jobs (safe)
  sync       — create/update jobs (PROVISION_APPROVED=true, SCHEDULE_RUNNER_URL required)
  pause-all  — pause all provisioned jobs (PROVISION_APPROVED=true)

Environment:
  SCHEDULE_RUNNER_URL  — e.g. https://refex-schedule-runner-xxx.run.app
  ENVIRONMENT          — default production
  APPLICATION_ID       — optional filter
  ACTIVE_ONLY          — if true, only sync is_active schedules from PG query
EOF
}

ACTION="${1:-plan}"
case "${ACTION}" in
  plan) plan ;;
  sync) sync_all ;;
  pause-all) pause_all ;;
  *) usage; exit 1 ;;
esac
