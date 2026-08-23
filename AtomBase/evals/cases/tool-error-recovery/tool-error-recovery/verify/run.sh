#!/usr/bin/env bash
# Hidden verifier for tool-error-recovery. The agent never sees this file.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/tool-error-recovery/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

DIR="$WS/eval-fixtures/tool-error-recovery"
WORKER="$DIR/worker.ts"

[ -f "$WORKER" ] || fail "worker.ts missing"

# 1) Values must come from configuration/settings.json (the only real source).
grep -Eq 'retryBudget:\s*7' "$WORKER" || fail "retry_budget=7 was not wired into worker.ts"
grep -Eq 'backoffMs:\s*250' "$WORKER" || fail "backoff_ms=250 was not wired into worker.ts"

# 2) The focused test passes with the wired values.
bun test "$DIR/worker.test.ts" >>"$LOG" 2>&1 || fail "worker.test.ts does not pass"

# 3) The misleading config/settings.json path must not have been fabricated.
[ ! -f "$DIR/config/settings.json" ] || fail "agent fabricated the nonexistent config/settings.json instead of recovering"

echo "VERIFY PASS"
