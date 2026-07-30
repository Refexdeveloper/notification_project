#!/usr/bin/env bash
# ops/runbooks/02b-remediate-secret-blockers.sh
#
# Purpose: Remediate Runbook 02 blockers before structural convergence.
# Mutations: source fixes, git index cleanup, .gitignore updates.
# Idempotent: safe to re-run.
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
AUDIT_DIR="${REPO_ROOT}/data/audit/runbook-02b"
mkdir -p "${AUDIT_DIR}"
REPORT="${AUDIT_DIR}/remediate-${TIMESTAMP}.txt"

exec > >(tee -a "${REPORT}") 2>&1

echo "Runbook 02b: remediate secret blockers @ ${TIMESTAMP}"

# --- 1. Extend .gitignore ---
GITIGNORE="${REPO_ROOT}/.gitignore"
append_if_missing() {
  local line="$1"
  grep -qxF "${line}" "${GITIGNORE}" 2>/dev/null || echo "${line}" >> "${GITIGNORE}"
}

append_if_missing ""
append_if_missing "# Customer / generated artifacts (Runbook 02b)"
append_if_missing "**/data/discovery/"
append_if_missing "**/templates/generated/"
append_if_missing "*.tar.gz"
append_if_missing "google-cloud-cli-*"

# --- 2. Remove sensitive paths from Git index (keep on disk) ---
UNTRACK_PATHS=(
  "refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report/data/discovery"
  "refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report/templates/generated"
  "refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report/google-cloud-cli-darwin-arm.tar.gz"
)

for p in "${UNTRACK_PATHS[@]}"; do
  if [[ -e "${REPO_ROOT}/${p}" ]]; then
    git rm -r --cached --ignore-unmatch "${p}" 2>/dev/null || true
    echo "Untracked from Git index: ${p}"
  fi
done

# --- 3. Fix hardcoded credentials in source ---
CONFIG_JS="${REPO_ROOT}/NotifictaionEngine/server/config/config.js"
if [[ -f "${CONFIG_JS}" ]]; then
  python3 <<'PY'
from pathlib import Path
p = Path("NotifictaionEngine/server/config/config.js")
text = p.read_text()
old = "const password =\n  process.env.DB_PASS || process.env.DB_PASSWORD || 'RefexAdmin@123';"
new = "const password = process.env.DB_PASS || process.env.DB_PASSWORD;\nif (!password) {\n  throw new Error('DB_PASS or DB_PASSWORD must be set (Secret Manager / env — no hardcoded fallback)');\n}"
if old in text:
    text = text.replace(old, new)
    p.write_text(text)
    print("Patched config.js: removed hardcoded DB password fallback")
elif "RefexAdmin" in text:
    raise SystemExit("config.js still contains RefexAdmin — manual fix required")
else:
    print("config.js already clean")
PY
fi

# Seed scripts: require env for bootstrap password
for script in NotifictaionEngine/server/scripts/seed.js NotifictaionEngine/server/scripts/create_users.js NotifictaionEngine/server/scripts/activateLeadTracker505.js; do
  if [[ -f "${REPO_ROOT}/${script}" ]]; then
    python3 - "${script}" <<'PY'
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text()
changed = False
text, n = re.subn(r"password:\s*'password123'", "password: process.env.BOOTSTRAP_ADMIN_PASSWORD", text)
if n: changed = True
text, n = re.subn(r"password:\s*'operator123'", "password: process.env.BOOTSTRAP_OPERATOR_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD", text)
if n: changed = True
text, n = re.subn(r"password:\s*'viewer123'", "password: process.env.BOOTSTRAP_VIEWER_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD", text)
if n: changed = True
text, n = re.subn(r"password:\s*'raghul123'", "password: process.env.BOOTSTRAP_ADMIN_PASSWORD", text)
if n: changed = True
text, n = re.subn(r"const password = process\.env\.ADMIN_PASSWORD \|\| 'password123';",
                  "const password = process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;\n  if (!password) throw new Error('ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD required');", text)
if n: changed = True
text = text.replace("(password123)", "(from BOOTSTRAP_ADMIN_PASSWORD env)")
if changed:
    p.write_text(text)
    print(f"Patched {p}")
else:
    print(f"No password literals to patch in {p}")
PY
  fi
done

# Remove backup runbook with potential secret echoes
BAK="refex-adoption-user-report-Live_IT_Service_Request_A00/refex-adoption-user-report/ops/runbooks/07-send-email-report.sh.bak"
if [[ -f "${REPO_ROOT}/${BAK}" ]]; then
  git rm -f --ignore-unmatch "${BAK}" 2>/dev/null || rm -f "${REPO_ROOT}/${BAK}"
  echo "Removed ${BAK}"
fi

# Update .env.example with bootstrap vars
ENV_EXAMPLE="${REPO_ROOT}/NotifictaionEngine/server/.env.example"
if ! grep -q BOOTSTRAP_ADMIN_PASSWORD "${ENV_EXAMPLE}" 2>/dev/null; then
  cat >> "${ENV_EXAMPLE}" <<'EOF'

# Local bootstrap only — never commit real values
BOOTSTRAP_ADMIN_PASSWORD=
ADMIN_PASSWORD=
EOF
fi

echo "Runbook 02b complete. Re-run ops/runbooks/02-secret-and-sensitive-data-preflight.sh"
