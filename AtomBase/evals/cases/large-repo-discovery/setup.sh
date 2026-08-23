#!/usr/bin/env bash
# Materializes a synthetic repository tree where exactly one file defines the
# ORION_GATE_V2 feature flag and exactly one test covers it. Near-miss names
# exist as precision decoys.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"

DIR="$WS/eval-fixtures/large-repo-discovery"
rm -rf "$DIR"
mkdir -p "$DIR/services/feature-flags" "$DIR/tests"

# 12 team directories x 10 modules of plausible-but-boring service code.
for team in billing shipping identity catalog search notify ingest export audit media growth support; do
  mkdir -p "$DIR/services/$team"
  for module in 1 2 3 4 5 6 7 8 9 10; do
    cat > "$DIR/services/$team/handler$module.ts" <<EOF
export interface Handler${module}${team}Config {
  retries: number
  region: "eu-central" | "us-east"
}

export async function handle${module}${team}(payload: unknown, config: Handler${module}${team}Config) {
  if (!payload) throw new Error("empty payload")
  return { ok: true, team: "$team", module: $module, region: config.region }
}
EOF
  done
done

# Precision decoys: similar but WRONG names.
cat > "$DIR/services/feature-flags/orion-gate.ts" <<'EOF'
// Legacy v1 rollout gate. Superseded; do not extend.
export const ORION_GATE = { enabled: false, rollout: 0 }
EOF
cat > "$DIR/services/feature-flags/orion-gate-roadmap.ts" <<'EOF'
// Future work tracker only. Nothing is implemented here yet.
export const ORION_GATE_V3_PLANNED = { proposal: "draft", quarter: "2027-Q1" }
EOF

# The actual targets.
cat > "$DIR/services/feature-flags/orion-gate-v2.ts" <<'EOF'
export const ORION_GATE_V2 = {
  enabled: true,
  rollout: 0.25,
  allowlist: ["team-ingest"],
}
EOF

cat > "$DIR/tests/orion-gate-v2.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test"
import { ORION_GATE_V2 } from "../services/feature-flags/orion-gate-v2"

describe("ORION_GATE_V2", () => {
  test("rollout stays within safe bounds", () => {
    expect(ORION_GATE_V2.rollout).toBeGreaterThan(0)
    expect(ORION_GATE_V2.rollout).toBeLessThanOrEqual(1)
  })
})
EOF

echo "fixture ready at $DIR"
