#!/usr/bin/env bash
# ops/runbooks/sync-kissflow-env-local.sh
#
# Copy Kissflow prod credentials into apps/admin-ui/.env.local
# (from .env.local if set, otherwise GCP Secret Manager via load-kissflow-creds.sh)
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ENV_FILE="${REPO_ROOT}/apps/admin-ui/.env.local"

# shellcheck source=/dev/null
source "${REPO_ROOT}/ops/runbooks/load-kissflow-creds.sh"

[[ -f "${ENV_FILE}" ]] || cp "${REPO_ROOT}/apps/admin-ui/.env.example" "${ENV_FILE}"

python3 - "${ENV_FILE}" "${KISSFLOW_ACCOUNT_ID}" "${KISSFLOW_KEY}" "${KISSFLOW_SECRET}" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
account, key_id, key_secret = sys.argv[2:5]
updates = {
    "VITE_KISSFLOW_PROD_ACCOUNT_ID": account,
    "VITE_KISSFLOW_PROD_ACCESS_KEY_ID": key_id,
    "VITE_KISSFLOW_PROD_ACCESS_KEY_SECRET": key_secret,
}
lines = path.read_text(encoding="utf-8").splitlines()
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else None
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
print(f"Updated {path.name} with prod Kissflow credentials (account {account}).")
print("Restart Admin UI: cd apps/admin-ui && npm run dev")
PY
