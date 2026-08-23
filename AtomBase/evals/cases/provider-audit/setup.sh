#!/usr/bin/env bash
# Materializes a mini multi-provider SDK with planted compatibility defects.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"

DIR="$WS/eval-fixtures/provider-audit"
rm -rf "$DIR"
mkdir -p "$DIR"

cat > "$DIR/README.md" <<'EOF'
# Payments SDK providers

All providers below are advertised as fully compatible with the platform
contract: HTTPS endpoint `https://api.payments.example/v2`, 5s request
timeout, streaming responses, and safe retry semantics.

| Provider | Advertised capabilities            |
| -------- | ---------------------------------- |
| alpha    | charges, refunds                   |
| beta     | charges, streaming                 |
| gamma    | charges, automatic retry           |
EOF

cat > "$DIR/alpha.ts" <<'EOF'
export interface ChargeInput {
  amountCents: number
  currency: string
}

export const alphaProvider = {
  name: "alpha",
  async charge(input: ChargeInput) {
    const response = await fetch("https://api.payments.example/v1/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(`alpha charge failed: ${response.status}`)
    return response.json()
  },
}
EOF

cat > "$DIR/beta.ts" <<'EOF'
export const betaProvider = {
  name: "beta",
  streaming: true,
  async chargeStream(input: { amountCents: number; currency: string }) {
    // Streams progress events to the caller as they happen.
    const response = await fetch("https://api.payments.example/v2/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(`beta charge failed: ${response.status}`)
    const payload = await response.json()
    return { status: payload.status, events: [{ type: "completed", at: Date.now() }] }
  },
}
EOF

cat > "$DIR/gamma.ts" <<'EOF'
export interface GammaOptions {
  maxRetries?: number
}

export const gammaProvider = {
  name: "gamma",
  async charge(input: { amountCents: number; currency: string }, options: GammaOptions = {}) {
    const maxRetries = options.maxRetries ?? 3
    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch("https://api.payments.example/v2/charges", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!response.ok) throw new Error(`gamma charge failed: ${response.status}`)
        return response.json()
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  },
}
EOF

cat > "$DIR/registry.ts" <<'EOF'
import { alphaProvider } from "./alpha"
import { betaProvider } from "./beta"
import { gammaProvider } from "./gamma"

const registry = new Map([
  [alphaProvider.name, alphaProvider],
  [betaProvider.name, betaProvider],
  [gammaProvider.name, gammaProvider],
])

export function getProvider(name: string) {
  const provider = registry.get(name)
  if (!provider) throw new Error(`unknown provider: ${name}`)
  return provider
}
EOF

echo "fixture ready at $DIR"
