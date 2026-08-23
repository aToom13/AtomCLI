#!/usr/bin/env bash
# Hidden verifier for provider-audit. The agent never sees this file.
#
# Four defects are planted:
#   F1 alpha hits /v1 while the contract says /v2
#   F2 alpha has no request timeout (contract: 5s)
#   F3 beta advertises streaming but buffers the whole response
#   F4 gamma retries a non-idempotent POST with no idempotency key
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/provider-audit/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

REPORT="$WS/eval-fixtures/provider-audit/AUDIT.md"
[ -f "$REPORT" ] || fail "agent did not write AUDIT.md"

R=$(cat "$REPORT")

finding() { # name, file-pattern, evidence-pattern
  echo "$R" | grep -qE "$2" || fail "$1: report does not reference $2"
  echo "$R" | grep -qiE "$3" || fail "$1: report lacks evidence for $3"
}

# F1: wrong endpoint version in alpha.
finding "F1 endpoint version" 'alpha' '/v1|v1/|version 1|api version'
echo "$R" | grep -qE '/v2|v2/' || fail "F1: report does not mention the required /v2 contract"

# F2: missing timeout in alpha.
finding "F2 timeout" 'alpha' 'timeout'

# F3: beta streaming claim vs buffered implementation.
finding "F3 streaming" 'beta' 'stream'

# F4: gamma retrying non-idempotent POST without idempotency key.
finding "F4 retry safety" 'gamma' 'retry|idempot'

# Findings must cite concrete file evidence, not generic advice.
echo "$R" | grep -qE 'alpha\.ts' || fail "report does not cite alpha.ts"
echo "$R" | grep -qE 'beta\.ts' || fail "report does not cite beta.ts"
echo "$R" | grep -qE 'gamma\.ts' || fail "report does not cite gamma.ts"

echo "VERIFY PASS"
