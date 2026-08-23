#!/usr/bin/env bash
# Hidden verifier for multi-file-refactor. The agent never sees this file.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/multi-file-refactor/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

DIR="$WS/eval-fixtures/multi-file-refactor"
[ -d "$DIR" ] || fail "fixture directory missing"

# 1) All pinned public behavior must still pass.
bun test "$DIR" >>"$LOG" 2>&1 || fail "existing tests no longer pass"

# 2) A shared pricing module must exist and behave per contract.
PRICING="$DIR/pricing.ts"
[ -f "$PRICING" ] || fail "pricing.ts was not created"

PROBE_TARGET="$PRICING" bun -e '
const mod = await import(process.env.PROBE_TARGET)
if (typeof mod.applyTierDiscount !== "function") process.exit(3)
const table = [
  [0, 0], [150, 150], [199.99, 199.99], [200, 190],
  [499, 474.05], [500, 450], [1200, 1080],
]
for (const [input, expected] of table) {
  const got = mod.applyTierDiscount(input)
  if (Math.abs(got - expected) > 1e-9) {
    console.error(`applyTierDiscount(${input}) = ${got}, expected ${expected}`)
    process.exit(4)
  }
}
console.log("probe-ok")
' >>"$LOG" 2>&1 || fail "applyTierDiscount missing or wrong (see verify.log)"

# 3) Every former duplication site must now route through the shared module.
for file in catalog.ts checkout.ts reporting.ts; do
  grep -qE 'from "\./pricing"|from '\''\./pricing'\''|applyTierDiscount' "$DIR/$file" \
    || fail "$file does not use the shared pricing module"
done

# 4) Hidden API-compatibility probes with independently computed golden values.
FIXTURE="$DIR" bun -e '
const checkout = await import(process.env.FIXTURE + "/checkout.ts")
const reporting = await import(process.env.FIXTURE + "/reporting.ts")
const catalog = await import(process.env.FIXTURE + "/catalog.ts")
const eq = (a, b) => Math.abs(a - b) < 1e-9
if (!eq(checkout.lineTotal(240, 2), 456)) process.exit(11)
if (!eq(checkout.lineTotal(1200, 12), 12312)) process.exit(12)
if (!eq(checkout.lineTotal(150, 9), 1350)) process.exit(13)
if (!eq(checkout.cartTotal([{ productId: "laptop", quantity: 1 }, { productId: "keyboard", quantity: 10 }]), 1080 + 1425)) process.exit(14)
try { checkout.cartTotal([{ productId: "ghost", quantity: 1 }]); process.exit(15) } catch {}
const revenue = reporting.revenueByProduct()
if (!eq(revenue.find((r) => r.id === "monitor").revenue, 228)) process.exit(16)
if (!eq(reporting.totalRevenue(), 1458)) process.exit(17)
if (catalog.tierFor(500) !== 0.1) process.exit(18)
if (catalog.tierFor(199) !== 0) process.exit(19)
console.log("api-ok")
' >>"$LOG" 2>&1 || fail "public API compatibility broken (see verify.log)"

echo "VERIFY PASS"
