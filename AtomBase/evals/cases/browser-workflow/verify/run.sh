#!/usr/bin/env bash
# Hidden verifier for browser-workflow. The agent never sees this file.
#
# Planted accessibility issues:
#   A1 email input has no associated label
#   A2 submit button is icon-only with no accessible name
#   A3 heading text fails contrast (#cccccc on #ffffff)
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/browser-workflow/verify.log"
: > "$LOG"

cleanup() {
  if [ -f /tmp/atomcli-browser-case.pid ]; then
    kill "$(cat /tmp/atomcli-browser-case.pid)" >/dev/null 2>&1 || true
    rm -f /tmp/atomcli-browser-case.pid
  fi
}
trap cleanup EXIT

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

REPORT="$WS/eval-fixtures/browser-workflow/REPORT.md"
ACCESS="$SB/browser-workflow/access.log"

[ -f "$ACCESS" ] || fail "server access log missing"
[ -f "$REPORT" ] || fail "agent did not write REPORT.md"

# 1) The agent actually navigated the page.
grep -q "GET /" "$ACCESS" || fail "page was never loaded (no GET / in access log)"

# 2) The agent actually completed the form workflow.
grep -q "POST /submit" "$ACCESS" || fail "form was never submitted (no POST /submit in access log)"

# 3) The report identifies at least two of the three planted a11y issues.
R=$(cat "$REPORT")
score=0
echo "$R" | grep -qiE 'label' && score=$((score + 1))
echo "$R" | grep -qiE 'contrast' && score=$((score + 1))
echo "$R" | grep -qiE 'button|icon|accessible name' && score=$((score + 1))
[ "$score" -ge 2 ] || fail "report covers fewer than 2 planted accessibility issues"

echo "VERIFY PASS"
