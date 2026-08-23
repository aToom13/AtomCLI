#!/usr/bin/env bash
# Hidden verifier for resume-checkpoint. The agent never sees this file.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/resume-checkpoint/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

DIR="$WS/eval-fixtures/resume-checkpoint"
MIGRATED="$DIR/migrated"

[ -d "$MIGRATED" ] || fail "migrated/ directory missing"

# 1) The focused test passes (all ten records present).
bun test "$DIR/migrate.test.ts" >>"$LOG" 2>&1 || fail "migrate.test.ts does not pass"

# 2) Exactly the ten expected outputs, nothing else.
count=$(ls "$MIGRATED" | wc -l)
[ "$count" -eq 10 ] || fail "expected 10 migrated files, found $count"

# 3) Completed work was NOT redone or altered: first five files are byte-identical.
(cd "$WS" && sha256sum -c "$SB/resume-checkpoint/completed.sha256") >>"$LOG" 2>&1 \
  || fail "already-migrated records 1-5 were modified (completed work was redone)"

# 4) Every record carries schemaVersion: 2.
for file in "$MIGRATED"/*.json; do
  grep -q '"schemaVersion":2' "$file" || fail "$(basename "$file") lacks schemaVersion 2"
done

# 5) New records carry the correct payload.
grep -q 'Barbara Liskov' "$MIGRATED/rec-006.json" || fail "rec-006 content wrong"
grep -q 'Gordon Bell' "$MIGRATED/rec-010.json" || fail "rec-010 content wrong"

echo "VERIFY PASS"
