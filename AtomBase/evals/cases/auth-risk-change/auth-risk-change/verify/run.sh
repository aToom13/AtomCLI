#!/usr/bin/env bash
# Hidden verifier for auth-risk-change. The agent never sees this file.
set -uo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"
LOG="$SB/auth-risk-change/verify.log"
: > "$LOG"

fail() { echo "VERIFY FAIL: $*" | tee -a "$LOG"; exit 1; }

DIR="$WS/eval-fixtures/auth-risk-change"
AUTH="$DIR/auth.ts"
TESTS="$DIR/auth.test.ts"

[ -f "$AUTH" ] || fail "auth.ts missing"
[ -f "$TESTS" ] || fail "auth.test.ts missing"

# 1) Focused tests pass and were actually extended for expiry + tampering.
bun test "$TESTS" >>"$LOG" 2>&1 || fail "focused auth tests do not pass"
grep -qiE 'expir' "$TESTS" || fail "tests do not cover expired tokens"
grep -qiE 'tamper' "$TESTS" || fail "tests do not cover tampered tokens"

# 2) Bounded-change discipline: password hashing must remain untouched.
grep -q 'SHA256' "$AUTH" || fail "hashPassword was rewritten (change was supposed to be bounded)"

# 3) Behavioral probes against the real implementation.
GOOD_SECRET="benchmark-secret-v2"
PROBE_TARGET="$AUTH" AUTH_SECRET="$GOOD_SECRET" bun -e '
const mod = await import(process.env.PROBE_TARGET)
if (!process.env.AUTH_SECRET) process.exit(20)
if (typeof mod.issueToken !== "function" || typeof mod.verifyToken !== "function") process.exit(3)

// Valid token is accepted.
const token = mod.issueToken("user-9", 60_000)
const session = mod.verifyToken(token)
if (session.userId !== "user-9") process.exit(4)

// Expired token is rejected even with a valid signature.
try {
  mod.verifyToken(mod.issueToken("user-9", -1_000))
  process.exit(5)
} catch {}

// Tampered payload is rejected by the signature check.
const [body, sig] = token.split(".")
const forged = Buffer.from(JSON.stringify({ userId: "attacker", expiresAt: Date.now() + 60_000 })).toString("base64url")
try {
  mod.verifyToken(`${forged}.${sig}`)
  process.exit(6)
} catch {}
console.log("probe-ok")
' >>"$LOG" 2>&1 || fail "behavioral probe failed (see verify.log)"

# 4) Cross-secret forgery: a token signed under a different secret must fail.
token=$(cd "$DIR" && AUTH_SECRET="$GOOD_SECRET" bun -e '
const mod = await import(process.env.PROBE_TARGET ?? "./auth.ts")
process.stdout.write(mod.issueToken("victim", 60_000))
' 2>>"$LOG" | tail -1) || fail "could not issue a reference token"
[ -n "$token" ] || fail "reference token empty"
(cd "$DIR" && AUTH_SECRET="attacker-secret" bun -e "
const mod = await import('./auth.ts')
try { mod.verifyToken('${token}'); process.exit(7) } catch { console.log('rejected-ok') }
") >>"$LOG" 2>&1 || fail "token signed with another secret was accepted"

echo "VERIFY PASS"
