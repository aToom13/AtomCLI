#!/usr/bin/env bash
# Hidden verifier for small-bug-fix. The agent never sees this file.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/small-bug-fix/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

TARGET="$WS/eval-fixtures/small-bug-fix/retry.ts"
TESTS="$WS/eval-fixtures/small-bug-fix/retry.test.ts"

[ -f "$TARGET" ] || fail "implementation missing: $TARGET"
[ -f "$TESTS" ] || fail "test file missing: $TESTS"

# 1) Focused public tests must pass.
bun test "$TESTS" >>"$LOG" 2>&1 || fail "focused retry.test.ts does not pass"

# 2) The agent must fix the implementation, not weaken the test.
expected=$(cat "$SB/small-bug-fix/retry.test.ts.sha256")
actual=$(sha256sum "$TESTS" | cut -d' ' -f1)
[ "$expected" = "$actual" ] || fail "retry.test.ts was modified"

# 3) Behavioral probe against the real implementation semantics.
PROBE_TARGET="$TARGET" bun -e '
const mod = await import(process.env.PROBE_TARGET)
if (typeof mod.retry !== "function") process.exit(3)
let calls = 0
const value = await mod.retry(async () => { calls++; if (calls < 3) throw new Error("boom"); return "ok" }, { attempts: 3 })
if (value !== "ok") process.exit(4)
if (calls !== 3) process.exit(5)
try {
  await mod.retry(async () => { throw new Error("solo") }, { attempts: 1 })
  process.exit(6)
} catch (error) {
  if (error.message !== "solo") process.exit(7)
}
console.log("probe-ok")
' >>"$LOG" 2>&1 || fail "behavioral probe failed (see verify.log)"

echo "VERIFY PASS"
