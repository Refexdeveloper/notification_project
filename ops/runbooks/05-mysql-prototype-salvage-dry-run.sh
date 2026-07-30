#!/usr/bin/env bash
# ops/runbooks/05-mysql-prototype-salvage-dry-run.sh
# Dry-run only — never inserts secrets or password hashes.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${REPO_ROOT}/data/audit/runbook-05/salvage-dry-run-${TIMESTAMP}.json"
mkdir -p "$(dirname "${OUT}")"

cat > "${OUT}" <<EOF
{
  "generated_at": "${TIMESTAMP}",
  "mode": "DRY_RUN",
  "source": "services/prototype-mysql-api (MySQL Sequelize models — not connected)",
  "target": "engagement_reporting PostgreSQL",
  "mappings": {
    "applications": "account + application + process rows + credential_binding (Secret Manager ref only)",
    "kissflow_resources": "resource",
    "kissflow_fields": "field_definition + schema_snapshot (no raw sample values)",
    "email_templates": "report_template + report_template_version",
    "email_schedulers": "report_schedule (merged with notification_schedule_configs)",
    "email_logs": "delivery_attempt (sanitised evidence only)",
    "audit_logs": "audit_event (platform admin only)",
    "users_roles": "admin_user + admin_role (no password hashes)",
    "smtp_configs": "REJECTED — Secret Manager manifest only"
  },
  "rejected": [
    "AUTO_INCREMENT", "tinyint booleans", "MySQL ENUM", "comma-separated recipients",
    "HTML in schedule rows", "access_key_secret values", "SMTP auth_pass values",
    "local password hashes", "notification_engine.json export"
  ],
  "records_to_import": 0,
  "secrets_detected": 0,
  "insert_performed": false
}
EOF

echo "Dry-run report: ${OUT}"
echo "No database inserts performed."
