#!/usr/bin/env bash
# Materializes a task whose stated input path does not exist. The real data
# lives one directory name away; the agent must recover from the failed read.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"

DIR="$WS/eval-fixtures/tool-error-recovery"
rm -rf "$DIR"
mkdir -p "$DIR/configuration"

# NOTE: deliberately NOT creating config/settings.json — the prompt asks for it.
cat > "$DIR/configuration/settings.json" <<'EOF'
{
  "retry_budget": 7,
  "backoff_ms": 250,
  "queue": "orion-tasks"
}
EOF

cat > "$DIR/worker.ts" <<'EOF'
export const WORKER_CONFIG = {
  retryBudget: Number.NaN, // TODO: fill from settings.json retry_budget
  backoffMs: 0, // TODO: fill from settings.json backoff_ms
}
EOF

cat > "$DIR/worker.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test"
import { WORKER_CONFIG } from "./worker"

describe("worker config", () => {
  test("values are wired from settings", () => {
    expect(Number.isFinite(WORKER_CONFIG.retryBudget)).toBe(true)
    expect(Number.isFinite(WORKER_CONFIG.backoffMs)).toBe(true)
  })
})
EOF

echo "fixture ready at $DIR"
