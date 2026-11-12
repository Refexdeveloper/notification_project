#!/usr/bin/env bash
# Runbook 07: Bcc goes on the SMTP envelope only (never a header), no duplicates;
# without BCC the envelope and headers are unchanged.
# Run: bash tests/schedule-bcc-send.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SENDER="${ROOT}/services/engagement-pipeline/ops/runbooks/07-send-email-report.sh"
WORK="$(mktemp -d)"
if [[ -n "${KEEP_WORK:-}" ]]; then echo "work dir: ${WORK}"; else trap 'rm -rf "${WORK}"' EXIT; fi

mkdir -p "${WORK}/root/ops/runbooks" "${WORK}/bin"
cp "${ROOT}/ops/runbooks/load-smtp-creds.sh" "${WORK}/root/ops/runbooks/"
printf '<html><body>report</body></html>' > "${WORK}/report.html"

# Fake curl: record envelope recipients and the uploaded MIME file.
cat > "${WORK}/bin/curl" <<'EOF'
#!/usr/bin/env bash
: > "${CAPTURE_DIR}/rcpt"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mail-rcpt) echo "$2" >> "${CAPTURE_DIR}/rcpt"; shift 2 ;;
    --upload-file) cp "$2" "${CAPTURE_DIR}/mime"; shift 2 ;;
    *) shift ;;
  esac
done
exit 0
EOF
chmod +x "${WORK}/bin/curl"

run_send() {
  local cap="$1"; shift
  mkdir -p "${cap}"
  env -i PATH="${WORK}/bin:${PATH}" HOME="${HOME}" CAPTURE_DIR="${cap}" \
    REPO_ROOT_OVERRIDE="${WORK}/root" REPORT_FILE_OVERRIDE="${WORK}/report.html" \
    SMTP_USER="reports@refex.co.in" SMTP_APP_PASSWORD="x" FROM_EMAIL="reports@refex.co.in" \
    SCHEDULE_ID="11111111-1111-1111-1111-111111111111" SUBJECT="Test" \
    "$@" bash "${SENDER}" > "${cap}/log" 2>&1
}

fail() { echo "FAIL: $*" >&2; exit 1; }

# 1) To + Cc + Bcc (one Bcc duplicates a To address in different case).
run_send "${WORK}/a" TO_LIST="a@x.com,b@x.com" CC="c@x.com" BCC="hidden@x.com, A@X.com ,"
[[ "$(cat "${WORK}/a/rcpt")" == $'a@x.com\nb@x.com\nc@x.com\nhidden@x.com' ]] \
  || fail "envelope should be To, Cc, then new Bcc only: $(tr '\n' ' ' < "${WORK}/a/rcpt")"
grep -qi '^bcc:' "${WORK}/a/mime" && fail "Bcc must never be written as a header"
grep -q '^To: a@x.com,b@x.com$' "${WORK}/a/mime" || fail "To header changed"
grep -q '^Cc: c@x.com' "${WORK}/a/mime" || fail "Cc header changed"
grep -q 'hidden@x.com' "${WORK}/a/mime" && fail "Bcc address leaked into the message"

# 2) No BCC (test send clears it): envelope and headers exactly as before.
run_send "${WORK}/b" TO_LIST="a@x.com" CC="c@x.com" BCC=""
[[ "$(cat "${WORK}/b/rcpt")" == $'a@x.com\nc@x.com' ]] || fail "no-Bcc envelope changed"
grep -qi '^bcc:' "${WORK}/b/mime" && fail "unexpected Bcc header"

# 3) BCC unset entirely (older callers).
run_send "${WORK}/c" TO_LIST="a@x.com"
[[ "$(cat "${WORK}/c/rcpt")" == 'a@x.com' ]] || fail "unset-Bcc envelope changed"

echo "schedule Bcc send: OK"
