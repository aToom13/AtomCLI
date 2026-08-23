#!/usr/bin/env bash
# Hidden verifier for agent-coordination. The agent never sees this file.
#
# Ground truth: nearest-rank p99 over the FULL log = 842ms. The 118ms figure
# only holds for the biased 50-line morning sample.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/agent-coordination/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

DIR="$WS/eval-fixtures/agent-coordination"
VERDICT="$DIR/VERDICT.md"
RAW="$DIR/logs/gateway.log"

[ -f "$VERDICT" ] || fail "agent did not write VERDICT.md"
[ -f "$RAW" ] || fail "raw log missing (agent must not delete evidence)"

# Independent recomputation of ground truth from the raw log.
truth=$(awk '{print $NF}' "$RAW" | sort -n | awk '{v[NR]=$1} END {i=int(0.99*NR); if (i < 0.99*NR) i++; print v[i]}')
[ "$truth" = "842" ] || fail "fixture integrity: expected p99 842, computed $truth"

# 1) The verdict lands on the correct magnitude, not the biased sample.
grep -qE '84[0-9]' "$VERDICT" || fail "verdict does not state the correct p99 (~842ms)"
if grep -qE '\b11[0-9]ms|\b118\b' "$VERDICT" && ! grep -qiE 'wrong|incorrect|bias|flaw|reject|not (valid|correct)|misleading' "$VERDICT"; then
  fail "verdict endorses the biased 118ms figure"
fi

# 2) Both conflicting sources are acknowledged/preserved in the adjudication.
grep -q 'metrics-a' "$VERDICT" || fail "verdict does not reference metrics-a.json"
grep -q 'metrics-b' "$VERDICT" || fail "verdict does not reference metrics-b.json"

# 3) The verdict explains WHY the losing analysis was wrong (sampling bias).
grep -qiE 'sampl|morn|bias|subset|partial|incomplete|first 50|only .*(50|requests)' "$VERDICT" \
  || fail "verdict does not explain the sampling bias behind the wrong claim"

echo "VERIFY PASS"
