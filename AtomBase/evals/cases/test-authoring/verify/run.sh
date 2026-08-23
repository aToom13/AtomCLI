#!/usr/bin/env bash
# Hidden verifier for test-authoring. The agent never sees this file.
#
# The core trick: the agent's tests must FAIL against deliberately mutated
# implementations and PASS against the real one. Tests that only restate the
# implementation (or assert nothing) cannot survive the mutation rounds.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/test-authoring/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

DIR="$WS/eval-fixtures/test-authoring"
IMPL="$DIR/slugify.ts"
TESTS="$DIR/slugify.test.ts"

[ -f "$IMPL" ] || fail "implementation missing: $IMPL"
[ -f "$TESTS" ] || fail "agent did not create slugify.test.ts"

ORIGINAL_HASH=$(sha256sum "$IMPL" | cut -d' ' -f1)
restore() {
  mv -f "$IMPL.bak" "$IMPL" 2>/dev/null || true
  local now
  now=$(sha256sum "$IMPL" | cut -d' ' -f1)
  [ "$now" = "$ORIGINAL_HASH" ] || fail "implementation was not restored cleanly"
}
trap 'rm -f "$IMPL.bak"' EXIT

cat > "$SB/test-authoring/mutate.py" <<'PYEOF'
import pathlib, sys

MUTATIONS = {
    # Separator runs no longer collapse ("a  b" -> "a--b").
    "A": ('/[^a-z0-9]+/g', '/[^a-z0-9]/g'),
    # Accent stripping removed ("Café" -> "caf-e").
    "B": ('.replace(/[\\u0300-\\u036f]/g, "")', ''),
    # Edge-dash trimming removed ("--hi--" -> "-hi-").
    "C": ('.replace(/^-+|-+$/g, "")', ''),
}

name, target = sys.argv[1], sys.argv[2]
old, new = MUTATIONS[name]
p = pathlib.Path(target)
src = p.read_text()
if old not in src:
    raise SystemExit(f"mutation {name} target not found")
p.write_text(src.replace(old, new, 1))
PYEOF

# Each round works on a fresh copy of the pristine implementation.
mutate() {
  cp "$IMPL" "$IMPL.bak"
  python3 "$SB/test-authoring/mutate.py" "$1" "$IMPL" >>"$LOG" 2>&1
}

# 1) Agent's suite passes against the real implementation.
bun test "$TESTS" >>"$LOG" 2>&1 || fail "agent tests do not pass on the real implementation"

# 2) Mutation A: separator collapse.
mutate A || fail "mutation A could not be applied"
if bun test "$TESTS" >>"$LOG" 2>&1; then
  restore
  fail "tests survived mutation A (separator collapse not covered)"
fi
restore

# 3) Mutation B: accent stripping.
mutate B || fail "mutation B could not be applied"
if bun test "$TESTS" >>"$LOG" 2>&1; then
  restore
  fail "tests survived mutation B (accent stripping not covered)"
fi
restore

# 4) Mutation C: edge trimming.
mutate C || fail "mutation C could not be applied"
if bun test "$TESTS" >>"$LOG" 2>&1; then
  restore
  fail "tests survived mutation C (edge trimming not covered)"
fi
restore

echo "VERIFY PASS"
