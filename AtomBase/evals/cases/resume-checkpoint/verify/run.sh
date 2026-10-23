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

# 4) Independently parse every output; formatting does not change JSON meaning.
# Ground truth stays here, outside agent-visible fixture sources.
bun -e '
import { readFileSync } from "node:fs"
const expected = [
  ["Ada Lovelace", "ada@example.com"],
  ["Alan Turing", "alan@example.com"],
  ["Grace Hopper", "grace@example.com"],
  ["Linus Benedict", "linus@example.com"],
  ["Margaret Hamilton", "margaret@example.com"],
  ["Barbara Liskov", "barbara@example.com"],
  ["Donald Knuth", "donald@example.com"],
  ["Edsger Dijkstra", "edsger@example.com"],
  ["Frances Allen", "frances@example.com"],
  ["Gordon Bell", "gordon@example.com"],
]
for (const [index, [name, email]] of expected.entries()) {
  const id = `rec-${String(index + 1).padStart(3, "0")}`
  const record = JSON.parse(readFileSync(`${process.argv[1]}/${id}.json`, "utf8"))
  if (record?.id !== id || record.name !== name || record.email !== email || record.schemaVersion !== 2)
    throw new Error(`${id}.json has an incorrect payload or schemaVersion`)
}
' "$MIGRATED" >>"$LOG" 2>&1 || fail "migrated JSON is invalid or has incorrect record fields"

echo "VERIFY PASS"
