#!/usr/bin/env bash
# tests/run-repo-tests.sh — repository-level checks (no cloud mutation)
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# 1. No hardcoded DB password in archived prototype backend config
if ! grep -rq 'RefexAdmin' archive/prototype-mysql-api/config/ 2>/dev/null; then
  pass "no RefexAdmin in prototype config"
else
  fail "no RefexAdmin in prototype config"
fi

# 2. No password123 in seed scripts
if ! grep -rq 'password123' archive/prototype-mysql-api/scripts/ 2>/dev/null; then
  pass "no password123 in seed scripts"
else
  fail "no password123 in seed scripts"
fi

# 3. Discovery data not tracked
DISC="$(git ls-files 2>/dev/null | grep -c 'data/discovery' || true)"
if [[ "${DISC}" -eq 0 ]]; then
  pass "discovery not tracked"
else
  fail "discovery not tracked (${DISC} files)"
fi

# 4. notification_engine.json absent
if [[ ! -f notification_engine.json ]]; then
  pass "no mysql export"
else
  fail "no mysql export"
fi

# 5. OpenAPI present
if [[ -f openapi/backend-api.yaml ]]; then
  pass "openapi exists"
else
  fail "openapi exists"
fi

# 6. Migrations present
if [[ -f db/migrations/001-canonical-engagement-model.sql ]]; then
  pass "migration 001 exists"
else
  fail "migration 001 exists"
fi
if [[ -f db/migrations/002-platform-extensions.sql ]]; then
  pass "migration 002 exists"
else
  fail "migration 002 exists"
fi

# 7. Secrets manifest
if [[ -f config/secrets.manifest.yaml ]]; then
  pass "secrets manifest exists"
else
  fail "secrets manifest exists"
fi

# 8. Frontend runtime API config
if grep -q 'VITE_USE_BACKEND_API' apps/admin-ui/.env.example; then
  pass "admin ui backend api flag documented"
else
  fail "admin ui backend api flag documented"
fi
if [[ -f apps/admin-ui/src/services/backendApi.ts ]]; then
  pass "backendApi client exists"
else
  fail "backendApi client exists"
fi

# 9. Canonical layout
if [[ -d apps/admin-ui ]]; then
  pass "admin-ui exists"
else
  fail "admin-ui exists"
fi
if [[ -d services/engagement-pipeline ]]; then
  pass "engagement-pipeline exists"
else
  fail "engagement-pipeline exists"
fi
if [[ -d services/backend-api ]]; then
  pass "backend-api exists"
else
  fail "backend-api exists"
fi
if [[ -f services/backend-api/Dockerfile ]]; then
  pass "backend-api Dockerfile exists"
else
  fail "backend-api Dockerfile exists"
fi
if [[ -f apps/admin-ui/Dockerfile ]]; then
  pass "admin-ui Dockerfile exists"
else
  fail "admin-ui Dockerfile exists"
fi

# 10. MySQL prototype archived (not under services/)
if [[ -d archive/prototype-mysql-api ]]; then
  pass "mysql prototype archived"
else
  fail "mysql prototype archived"
fi
if [[ ! -d services/prototype-mysql-api ]]; then
  pass "mysql prototype removed from services/"
else
  fail "mysql prototype removed from services/"
fi

# 11. No legacy Vite proxy to MySQL API
if ! grep -q 'localhost:4000' apps/admin-ui/vite.config.ts 2>/dev/null; then
  pass "no vite proxy to mysql api"
else
  fail "no vite proxy to mysql api"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]]
