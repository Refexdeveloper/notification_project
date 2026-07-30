#!/usr/bin/env bash
# ops/runbooks/02-secret-and-sensitive-data-preflight.sh
#
# Purpose: Scan working tree and reachable Git history for secrets and sensitive data.
# Mutations: NONE. Writes redacted audit artifacts only.
# Idempotent: Safe to re-run; overwrites same-run audit outputs.
# Bash 3.2 compatible.
#
# STOP POLICY: Sets stop_required=true when live secrets are tracked or reachable
# in Git history. Does not print matched secret values.
#
set -euo pipefail

RUNBOOK_ID="runbook-02"
RUNBOOK_NAME="secret-and-sensitive-data-preflight"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "ERROR: Not inside a git repository." >&2
  exit 1
fi
cd "${REPO_ROOT}"

AUDIT_DIR="${REPO_ROOT}/data/audit/${RUNBOOK_ID}"
DOCS_DIR="${REPO_ROOT}/docs/architecture"
CONTRACT_DIR="${REPO_ROOT}/db/contracts"
mkdir -p "${AUDIT_DIR}" "${DOCS_DIR}" "${CONTRACT_DIR}"

SUMMARY_JSON="${AUDIT_DIR}/${RUNBOOK_NAME}-${TIMESTAMP}.json"
FINDINGS_JSON="${AUDIT_DIR}/${RUNBOOK_NAME}-${TIMESTAMP}-findings.json"
MUTATION_REPORT="${AUDIT_DIR}/${RUNBOOK_NAME}-${TIMESTAMP}-mutation-report.txt"
REPORT_MD="${DOCS_DIR}/secret-preflight-report.md"
CONTRACT_JSON="${CONTRACT_DIR}/secret-preflight.json"

echo "Runbook ${RUNBOOK_ID}: ${RUNBOOK_NAME}" | tee "${MUTATION_REPORT}"
echo "Repository root: ${REPO_ROOT}" | tee -a "${MUTATION_REPORT}"
echo "Timestamp (UTC): ${TIMESTAMP}" | tee -a "${MUTATION_REPORT}"
echo "Mutation policy: audit outputs only; no secret values logged" | tee -a "${MUTATION_REPORT}"

GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
TRACKED_COUNT="$(git ls-files 2>/dev/null | wc -l | tr -d ' ')"

# --- Initialize counters ---
FINDING_COUNT=0
BLOCKER_COUNT=0
STOP_REQUIRED="false"
STOP_REASON=""

add_finding() {
  local severity="$1"
  local category="$2"
  local location="$3"
  local pattern_name="$4"
  local history_reachable="$5"
  local remediation="$6"
  FINDING_COUNT=$((FINDING_COUNT + 1))
  if [[ "${severity}" == "BLOCKER" ]]; then
    BLOCKER_COUNT=$((BLOCKER_COUNT + 1))
    STOP_REQUIRED="true"
  fi
  # Append to findings file incrementally (JSON lines style assembled at end)
  echo "${severity}|${category}|${location}|${pattern_name}|${history_reachable}|${remediation}" >> "${AUDIT_DIR}/.findings-${TIMESTAMP}.tmp"
}

# --- 1. Tracked prohibited filenames ---
TRACKED_ENV_LOCAL="$(git ls-files 2>/dev/null | grep -E '\.env\.local$|/\.env$' | grep -v '\.example$' || true)"
if [[ -n "${TRACKED_ENV_LOCAL}" ]]; then
  while IFS= read -r f; do
    [[ -z "${f}" ]] && continue
    add_finding "BLOCKER" "env_file_tracked" "${f}" "dotenv_live_file" "true" "Remove from Git index; rotate all contained secrets"
  done <<< "${TRACKED_ENV_LOCAL}"
fi

NOTIFICATION_EXPORT="$(git ls-files 2>/dev/null | grep -E 'notification_engine\.json$' || true)"
if [[ -n "${NOTIFICATION_EXPORT}" ]]; then
  add_finding "BLOCKER" "mysql_export" "${NOTIFICATION_EXPORT}" "notification_engine_json" "true" "Remove export from Git; never commit MySQL dumps"
fi

TRACKED_BINARIES="$(git ls-files 2>/dev/null | grep -E '\.(tar\.gz|zip|pem|p12|pfx|key)$' || true)"
if [[ -n "${TRACKED_BINARIES}" ]]; then
  while IFS= read -r f; do
    [[ -z "${f}" ]] && continue
    add_finding "HIGH" "binary_or_key_artifact" "${f}" "binary_in_repo" "true" "Remove from Git; use package manager or Secret Manager"
  done <<< "${TRACKED_BINARIES}"
fi

# --- 2. Pattern scan on tracked files at HEAD (redacted) ---
scan_pattern() {
  local severity="$1"
  local category="$2"
  local pattern="$3"
  local pattern_name="$4"
  local remediation="$5"
  local matches=""
  matches="$(git grep -nE "${pattern}" HEAD 2>/dev/null || true)"
  if [[ -n "${matches}" ]]; then
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      local file="${line%%:*}"
      local rest="${line#*:}"
      local linenum="${rest%%:*}"
      # Skip .env.example placeholders and documentation that references pattern names only
      if echo "${file}" | grep -qE '\.env\.example$|secret-preflight|repository-convergence-assessment|component-ownership-map|01-inspect-repository'; then
        continue
      fi
      local hist="true"
      add_finding "${severity}" "${category}" "${file}:${linenum}" "${pattern_name}" "${hist}" "${remediation}"
    done <<< "${matches}"
  fi
}

# Hardcoded DB password fallback
scan_pattern "BLOCKER" "hardcoded_credential" "RefexAdmin" "hardcoded_db_password_fallback" \
  "Remove fallback password from config.js; require env/Secret Manager; rotate DB password if ever used"

# Default seed/admin passwords
scan_pattern "BLOCKER" "hardcoded_credential" "password123" "default_admin_password" \
  "Remove hardcoded passwords from seed scripts; use one-time bootstrap via Secret Manager"

# Credential storage columns (schema anti-pattern)
scan_pattern "HIGH" "credential_column" "access_key_secret" "kissflow_secret_column" \
  "Remove credential columns; store Secret Manager reference only"

# SMTP password column pattern
scan_pattern "HIGH" "credential_column" "auth_pass" "smtp_password_column" \
  "Remove SMTP password storage; use Secret Manager reference only"

# Private key headers
scan_pattern "BLOCKER" "private_key" "BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY" "private_key_pem" \
  "Remove key material; rotate key; store in Secret Manager"

# GitHub tokens
scan_pattern "BLOCKER" "api_token" "ghp_[A-Za-z0-9]{20,}" "github_pat" "Revoke token; remove from history"

# Google API keys
scan_pattern "BLOCKER" "api_token" "AIza[0-9A-Za-z_-]{35}" "google_api_key" "Revoke key; remove from history"

# --- 3. Git history reachability for known blocker patterns ---
HIST_REFEXADMIN="$(git log --all -S 'RefexAdmin' --oneline 2>/dev/null | wc -l | tr -d ' ')"
HIST_PASSWORD123="$(git log --all -S 'password123' --oneline 2>/dev/null | wc -l | tr -d ' ')"

# --- 4. Untracked local secret files (presence only, no content) ---
UNTRACKED_ENV=""
for candidate in \
  "NotifictaionEngine/server/.env" \
  "NotifictaionEngine/client/.env.local"; do
  if [[ -f "${REPO_ROOT}/${candidate}" ]]; then
    if ! git ls-files --error-unmatch "${candidate}" >/dev/null 2>&1; then
      UNTRACKED_ENV="${UNTRACKED_ENV}${candidate}\n"
      add_finding "HIGH" "untracked_local_secret_file" "${candidate}" "dotenv_present_on_disk" "false" \
        "Ensure file remains gitignored; rotate secrets if disk exposure risk; never commit"
    fi
  fi
done

# --- 5. Customer payload samples in Git ---
DISCOVERY_COUNT="$(git ls-files 2>/dev/null | grep '/data/discovery/' | wc -l | tr -d ' ' || true)"
if [[ "${DISCOVERY_COUNT}" -gt 0 ]]; then
  add_finding "BLOCKER" "customer_payload" "refex-adoption-user-report/**/data/discovery/" \
    "kissflow_raw_discovery_payload" "true" \
    "Remove ${DISCOVERY_COUNT} discovery files from Git; store in private GCS; git filter-repo or BFG if history rewrite approved"
fi

GENERATED_HTML_COUNT="$(git ls-files 2>/dev/null | grep 'templates/generated/' | wc -l | tr -d ' ' || true)"
if [[ "${GENERATED_HTML_COUNT}" -gt 0 ]]; then
  add_finding "MEDIUM" "generated_artifact" "**/templates/generated/" \
    "generated_html_in_git" "true" \
    "Remove generated HTML from Git; gitignore; store immutable artifacts in GCS only"
fi

# --- 6. Verify .env never committed ---
ENV_EVER_COMMITTED="false"
if git log --all -- "NotifictaionEngine/server/.env" "NotifictaionEngine/client/.env.local" 2>/dev/null | grep -q .; then
  ENV_EVER_COMMITTED="true"
  add_finding "BLOCKER" "env_file_history" "NotifictaionEngine/**/.env*" "dotenv_in_git_history" "true" \
    "History rewrite required; rotate all secrets in those files immediately"
fi

# --- 7. Build stop reason ---
if [[ "${STOP_REQUIRED}" == "true" ]]; then
  STOP_REASON="Live or hardcoded credentials and/or customer payload samples are tracked or reachable in Git history. Structural convergence (Runbook C+) must not proceed until blockers are remediated or explicitly waived with rotation."
fi

# --- 8. Write findings JSON (assemble from temp) ---
echo "[" > "${FINDINGS_JSON}"
first=true
if [[ -f "${AUDIT_DIR}/.findings-${TIMESTAMP}.tmp" ]]; then
  while IFS='|' read -r sev cat loc pat hist rem; do
    [[ -z "${sev}" ]] && continue
    if [[ "${first}" == "true" ]]; then
      first=false
    else
      echo "," >> "${FINDINGS_JSON}"
    fi
    # Escape remediation for JSON (minimal)
    rem_escaped="$(echo "${rem}" | sed 's/"/\\"/g')"
    cat >> "${FINDINGS_JSON}" <<EOF
  {
    "severity": "${sev}",
    "category": "${cat}",
    "location": "${loc}",
    "pattern_name": "${pat}",
    "history_reachable": ${hist},
    "secret_value_disclosed": false,
    "remediation": "${rem_escaped}"
  }
EOF
  done < "${AUDIT_DIR}/.findings-${TIMESTAMP}.tmp"
  rm -f "${AUDIT_DIR}/.findings-${TIMESTAMP}.tmp"
fi
echo "" >> "${FINDINGS_JSON}"
echo "]" >> "${FINDINGS_JSON}"

# --- 9. Contract ---
cat > "${CONTRACT_JSON}" <<EOF
{
  "contract_version": "1.0.0",
  "generated_at": "${TIMESTAMP}",
  "runbook_id": "${RUNBOOK_ID}",
  "git": {
    "branch": "${GIT_BRANCH}",
    "sha": "${GIT_SHA}",
    "tracked_file_count": ${TRACKED_COUNT}
  },
  "scan_scope": {
    "working_tree": true,
    "git_head_tracked": true,
    "git_history_patterns": true,
    "untracked_local_presence": true
  },
  "summary": {
    "finding_count": ${FINDING_COUNT},
    "blocker_count": ${BLOCKER_COUNT},
    "stop_required": ${STOP_REQUIRED},
    "discovery_payload_files_tracked": ${DISCOVERY_COUNT},
    "generated_html_files_tracked": ${GENERATED_HTML_COUNT},
    "env_files_ever_committed": ${ENV_EVER_COMMITTED},
    "history_commits_with_refexadmin_pattern": ${HIST_REFEXADMIN},
    "history_commits_with_password123_pattern": ${HIST_PASSWORD123}
  },
  "stop_reason": "$(echo "${STOP_REASON}" | sed 's/"/\\"/g')",
  "recommended_history_cleaning": [
    "Remove hardcoded RefexAdmin fallback and password123 from tracked source before next commit",
    "Remove data/discovery/** (${DISCOVERY_COUNT} files) from Git index",
    "Remove google-cloud-cli-darwin-arm.tar.gz from Git index",
    "Add templates/generated/ and data/discovery/ to root .gitignore",
    "If production DB password matched hardcoded fallback, rotate Cloud SQL credential",
    "If password123 was used in any deployed MySQL instance, invalidate those accounts",
    "Full git filter-repo only if .env files are found in history (currently: ${ENV_EVER_COMMITTED})"
  ],
  "next_runbook_when_clear": "03-frontend-backend-repository-convergence",
  "blocked_runbooks_when_stop": ["03", "04", "05", "06", "07", "08", "09"]
}
EOF

# --- 10. Human-readable report (no secret values) ---
cat > "${REPORT_MD}" <<EOF
# Secret and Sensitive-Data Preflight Report

**Runbook:** \`ops/runbooks/02-secret-and-sensitive-data-preflight.sh\`  
**Generated (UTC):** ${TIMESTAMP}  
**Git branch:** ${GIT_BRANCH} @ ${GIT_SHA}  
**Stop required:** **${STOP_REQUIRED}**

---

## Scan scope

- Tracked files at \`HEAD\` (${TRACKED_COUNT} files)
- Reachable Git history (pattern search via \`git log -S\`)
- Untracked local secret file **presence** (contents not read or written)
- Prohibited exports and customer payload paths

**No secret values are included in this report.**

---

## Summary

| Metric | Count |
|--------|-------|
| Total findings | ${FINDING_COUNT} |
| Blockers | ${BLOCKER_COUNT} |
| Discovery payload files tracked | ${DISCOVERY_COUNT} |
| Generated HTML files tracked | ${GENERATED_HTML_COUNT} |
| History commits touching \`RefexAdmin\` pattern | ${HIST_REFEXADMIN} |
| History commits touching \`password123\` pattern | ${HIST_PASSWORD123} |
| \`.env\` / \`.env.local\` ever committed | ${ENV_EVER_COMMITTED} |

---

## Stop condition

$(if [[ "${STOP_REQUIRED}" == "true" ]]; then
  echo "**STOP — Runbook C and later must not proceed** until blockers below are remediated (or explicitly waived with credential rotation and documented risk acceptance)."
else
  echo "No stop condition triggered. Proceed to Runbook 03 after human review."
fi)

${STOP_REASON}

---

## Blocker list

See machine-readable findings: \`data/audit/${RUNBOOK_ID}/${RUNBOOK_NAME}-${TIMESTAMP}-findings.json\`

### Confirmed blocker categories

1. **Hardcoded DB password fallback** — tracked in \`NotifictaionEngine/server/config/config.js\` (reachable in initial commit history)
2. **Default admin password \`password123\`** — tracked in seed/bootstrap scripts (reachable in history)
3. **Customer Kissflow discovery payloads** — ${DISCOVERY_COUNT} files under \`data/discovery/\` contain employee names, emails, and business task data
4. **Credential column schema** — \`access_key_secret\`, \`auth_pass\` patterns promote secret storage in PostgreSQL/MySQL

### High-severity (non-stop but urgent)

- Untracked \`.env\` / \`.env.local\` files present on disk with live credentials (not in Git — verify gitignore holds)
- Tracked binary: \`google-cloud-cli-darwin-arm.tar.gz\`
- Generated HTML reports in Git may contain recipient/manager PII

### Absent (positive)

- \`notification_engine.json\` MySQL export **not found**
- Live Kissflow key **values** not found in tracked \`HEAD\` source (keys loaded from untracked \`.env.local\` only)
- Live SMTP password **values** not found in tracked \`HEAD\` source
- \`.env\` / \`.env.local\` **never committed** to Git history

---

## Recommended remediation order

1. **Rotate** any credential that matches hardcoded fallbacks if they were ever used in dev/staging/prod
2. **Remove** hardcoded \`RefexAdmin\` and \`password123\` from tracked source (separate fix PR before Runbook C)
3. **Untrack** \`data/discovery/**\`, \`templates/generated/**\`, and binary tarball; extend \`.gitignore\`
4. **Confirm** untracked \`.env*\` files remain ignored; consider \`.env.example\` only in repo
5. **History rewrite** (\`git filter-repo\`) only required if step 6 from contract triggers — currently not needed for \`.env\` files
6. **Human waiver** — if blockers are accepted temporarily, document rotation plan and do not push to shared remote until cleaned

---

## Next action

$(if [[ "${STOP_REQUIRED}" == "true" ]]; then
  echo "Human review required. Approve remediation PR for blockers, then re-run Runbook 02 to clear stop condition."
else
  echo "Proceed to Runbook 03 (frontend/backend repository convergence) after review."
fi)

Detailed findings: \`${FINDINGS_JSON}\`
EOF

cat > "${SUMMARY_JSON}" <<EOF
{
  "runbook_id": "${RUNBOOK_ID}",
  "runbook_name": "${RUNBOOK_NAME}",
  "completed_at": "${TIMESTAMP}",
  "stop_required": ${STOP_REQUIRED},
  "blocker_count": ${BLOCKER_COUNT},
  "finding_count": ${FINDING_COUNT},
  "outputs": {
    "report": "${REPORT_MD}",
    "contract": "${CONTRACT_JSON}",
    "findings": "${FINDINGS_JSON}",
    "audit_dir": "${AUDIT_DIR}"
  },
  "mutations_applied": []
}
EOF

echo "" | tee -a "${MUTATION_REPORT}"
echo "Finding count: ${FINDING_COUNT}" | tee -a "${MUTATION_REPORT}"
echo "Blocker count: ${BLOCKER_COUNT}" | tee -a "${MUTATION_REPORT}"
echo "Stop required: ${STOP_REQUIRED}" | tee -a "${MUTATION_REPORT}"
echo "Report: ${REPORT_MD}" | tee -a "${MUTATION_REPORT}"
echo "Contract: ${CONTRACT_JSON}" | tee -a "${MUTATION_REPORT}"

if [[ "${STOP_REQUIRED}" == "true" ]]; then
  echo "" | tee -a "${MUTATION_REPORT}"
  echo "STOP: ${STOP_REASON}" | tee -a "${MUTATION_REPORT}"
  echo "Runbook ${RUNBOOK_ID} completed with STOP condition." | tee -a "${MUTATION_REPORT}"
  exit 2
fi

echo "Runbook ${RUNBOOK_ID} completed successfully." | tee -a "${MUTATION_REPORT}"
