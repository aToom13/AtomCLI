#!/usr/bin/env bash
# Materializes a deterministic boundary bug for the small-bug-fix case.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"
SB="${ATOMCLI_EVAL_SANDBOX:?ATOMCLI_EVAL_SANDBOX must be set}"

DIR="$WS/eval-fixtures/small-bug-fix"
rm -rf "$DIR"
mkdir -p "$DIR"

cat > "$DIR/retry.ts" <<'EOF'
export interface RetryOptions {
  /** Total tries allowed, must be >= 1. */
  attempts: number
  delayMs?: number
}

/**
 * Runs `task` up to `options.attempts` times.
 * Returns the first successful result, or throws the last error.
 */
export async function retry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt < options.attempts; attempt++) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (options.delayMs) await Bun.sleep(options.delayMs)
    }
  }
  throw lastError
}
EOF

cat > "$DIR/retry.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test"
import { retry } from "./retry"

describe("retry", () => {
  test("returns the first successful result", async () => {
    let calls = 0
    const value = await retry(async () => {
      calls++
      return `ok-${calls}`
    }, { attempts: 3 })
    expect(value).toBe("ok-1")
    expect(calls).toBe(1)
  })

  test("retries until success within budget", async () => {
    let calls = 0
    const value = await retry(async () => {
      calls++
      if (calls < 3) throw new Error("transient")
      return "recovered"
    }, { attempts: 5 })
    expect(value).toBe("recovered")
    expect(calls).toBe(3)
  })

  test("succeeds on the final allowed attempt", async () => {
    let calls = 0
    const value = await retry(async () => {
      calls++
      if (calls < 2) throw new Error("once")
      return "second"
    }, { attempts: 2 })
    expect(value).toBe("second")
    expect(calls).toBe(2)
  })

  test("throws the last error when every attempt fails", async () => {
    let calls = 0
    try {
      await retry(async () => {
        calls++
        throw new Error(`failure-${calls}`)
      }, { attempts: 3 })
      throw new Error("should not resolve")
    } catch (error) {
      expect((error as Error).message).toBe("failure-3")
    }
    expect(calls).toBe(3)
  })

  test("single-attempt failure propagates immediately", async () => {
    let calls = 0
    try {
      await retry(async () => {
        calls++
        throw new Error("only")
      }, { attempts: 1 })
      throw new Error("should not resolve")
    } catch (error) {
      expect((error as Error).message).toBe("only")
    }
    expect(calls).toBe(1)
  })
})
EOF

mkdir -p "$SB/small-bug-fix"
sha256sum "$DIR/retry.test.ts" | cut -d' ' -f1 > "$SB/small-bug-fix/retry.test.ts.sha256"
echo "fixture ready at $DIR"
