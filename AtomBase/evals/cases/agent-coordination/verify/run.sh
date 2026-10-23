#!/usr/bin/env bash
# Hidden verifier for agent-coordination. The agent never sees this file.
#
# Ground truth: nearest-rank p99 over the FULL log = 842ms. A narrower
# sample claim does not establish the full-log percentile.
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

# Neither source can be rewritten to agree with the conclusion.
(cd "$DIR" && sha256sum -c "$SB/agent-coordination/evidence.sha256") >>"$LOG" 2>&1 \
  || fail "raw log or evidence sources changed"

# Grade the public structured contract, never a list of prose synonyms.
bun -e '
import { readFileSync, statSync } from "node:fs"
const dir = process.argv[1]
if (statSync(`${dir}/VERDICT.md`).size > 1024 * 1024) throw new Error("verdict exceeds 1 MiB")
const text = readFileSync(`${dir}/VERDICT.md`, "utf8")
const blocks = [...text.matchAll(/```json[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)]
if (blocks.length !== 1 || !text.replace(blocks[0][0], "").trim())
  throw new Error("expected explanation and exactly one authoritative JSON block")
const claim = JSON.parse(blocks[0][1])
const values = readFileSync(`${dir}/logs/gateway.log`, "utf8").trim().split("\n")
  .map(line => Number(line.trim().split(/\s+/).at(-1))).sort((a, b) => a - b)
if (values.length !== 100 || values.some(value => !Number.isFinite(value))) throw new Error("invalid raw log")
const rank = Math.ceil(0.99 * values.length)
const truth = values[rank - 1]
if (truth !== 842) throw new Error("fixture percentile changed")
if (claim?.metric !== "latency_p99_ms" || claim.population !== "full_log" ||
    claim.value !== truth || claim.sample_size !== values.length || claim.rank !== rank ||
    claim.accepted_source !== "evidence/metrics-a.json" || claim.rejected_source !== "evidence/metrics-b.json" ||
    claim.rejected_value !== 118 || claim.rejected_sample_size !== 50 ||
    claim.rejected_claim_applies_to_full_log !== false)
  throw new Error("incorrect structured adjudication")
' "$DIR" >>"$LOG" 2>&1 || fail "verdict does not satisfy the structured evidence contract"

echo "VERIFY PASS"
