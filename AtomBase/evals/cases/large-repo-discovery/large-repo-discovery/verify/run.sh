#!/usr/bin/env bash
# Hidden verifier for large-repo-discovery. The agent never sees this file.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/large-repo-discovery/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

ANSWER="$WS/eval-fixtures/large-repo-discovery/ANSWER.md"
[ -f "$ANSWER" ] || fail "agent did not write ANSWER.md"

# 1) Both exact targets must be cited (definition file AND covering test).
grep -q 'orion-gate-v2\.ts' "$ANSWER" || fail "definition file orion-gate-v2.ts not cited"
grep -q 'orion-gate-v2\.test\.ts' "$ANSWER" || fail "covering test orion-gate-v2.test.ts not cited"

# 2) Precision: decoys must not be presented as the answer.
grep -qE 'orion-gate\.ts|orion-gate-roadmap\.ts|ORION_GATE_V3|[^V]ORION_GATE[^_]' "$ANSWER" \
  && fail "answer cites a decoy (legacy ORION_GATE or roadmap)"

# 3) Anti-dumping: the answer stays a concise citation list, not a content dump.
lines=$(grep -cE '[A-Za-z0-9_./-]+\.(ts|md)' "$ANSWER" || true)
[ "$lines" -le 8 ] || fail "answer looks like a broad file dump ($lines path-like lines)"

echo "VERIFY PASS"
