#!/usr/bin/env bash
# Materializes a three-module feature with duplicated pricing logic.
set -euo pipefail

WS="${ATOMCLI_EVAL_WORKSPACE:?ATOMCLI_EVAL_WORKSPACE must be set}"

DIR="$WS/eval-fixtures/multi-file-refactor"
rm -rf "$DIR"
mkdir -p "$DIR"

cat > "$DIR/catalog.ts" <<'EOF'
export interface Product {
  id: string
  name: string
  price: number
}

export const PRODUCTS: Product[] = [
  { id: "keyboard", name: "Mechanical Keyboard", price: 150 },
  { id: "monitor", name: "Office Monitor", price: 240 },
  { id: "laptop", name: "Developer Laptop", price: 1200 },
]

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id)
}

// Pricing-tier rule, copy A (also duplicated in checkout.ts and reporting.ts).
export function tierFor(unitPrice: number): number {
  if (unitPrice >= 500) return 0.1
  if (unitPrice >= 200) return 0.05
  return 0
}
EOF

cat > "$DIR/checkout.ts" <<'EOF'
import { findProduct } from "./catalog"

export interface CartLine {
  productId: string
  quantity: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function lineTotal(unitPrice: number, quantity: number): number {
  // Pricing-tier rule, copy B (see also catalog.ts and reporting.ts).
  let rate = 0
  if (unitPrice >= 500) rate = 0.1
  else if (unitPrice >= 200) rate = 0.05
  let total = unitPrice * (1 - rate) * quantity
  if (quantity >= 10) total *= 0.95
  return round2(total)
}

export function cartTotal(lines: CartLine[]): number {
  return round2(
    lines.reduce((sum, line) => {
      const product = findProduct(line.productId)
      if (!product) throw new Error(`unknown product: ${line.productId}`)
      return sum + lineTotal(product.price, line.quantity)
    }, 0),
  )
}
EOF

cat > "$DIR/reporting.ts" <<'EOF'
import { PRODUCTS } from "./catalog"

export function revenueByProduct(): Array<{ id: string; revenue: number }> {
  // Pricing-tier rule, copy C (see also catalog.ts and checkout.ts).
  return PRODUCTS.map((product) => {
    let rate = 0
    if (product.price >= 500) rate = 0.1
    else if (product.price >= 200) rate = 0.05
    return { id: product.id, revenue: Math.round(product.price * (1 - rate) * 100) / 100 }
  })
}

export function totalRevenue(): number {
  return Math.round(revenueByProduct().reduce((sum, item) => sum + item.revenue, 0) * 100) / 100
}
EOF

cat > "$DIR/README.md" <<'EOF'
# Inventory pricing

## Discount contract (must not change)

- Tier discount by unit price: `>= 500` -> 10% off, `>= 200` -> 5% off, otherwise none.
- Bulk bonus: orders of 10+ units get an additional 5% off the line total.
- Monetary results are rounded half-up to 2 decimals (`Math.round(x * 100) / 100`).

## Known issue

The tier-discount formula is copy-pasted across `catalog.ts`, `checkout.ts`,
and `reporting.ts`. When the tiers change, someone always forgets one copy.
EOF

cat > "$DIR/catalog.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test"
import { findProduct, tierFor } from "./catalog"

describe("catalog", () => {
  test("tier thresholds", () => {
    expect(tierFor(150)).toBe(0)
    expect(tierFor(200)).toBe(0.05)
    expect(tierFor(499)).toBe(0.05)
    expect(tierFor(500)).toBe(0.1)
    expect(tierFor(1200)).toBe(0.1)
  })

  test("finds products by id", () => {
    expect(findProduct("monitor")?.price).toBe(240)
    expect(findProduct("nope")).toBeUndefined()
  })
})
EOF

cat > "$DIR/checkout.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test"
import { cartTotal, lineTotal } from "./checkout"

describe("checkout", () => {
  test("line totals apply tier discounts", () => {
    expect(lineTotal(150, 1)).toBe(150)
    expect(lineTotal(240, 2)).toBe(456)
    expect(lineTotal(1200, 1)).toBe(1080)
  })

  test("bulk bonus applies at ten units", () => {
    expect(lineTotal(150, 10)).toBe(1425)
    expect(lineTotal(150, 9)).toBe(1350)
  })

  test("cart total sums lines", () => {
    expect(cartTotal([
      { productId: "keyboard", quantity: 2 },
      { productId: "monitor", quantity: 1 },
    ])).toBe(528)
  })

  test("unknown products are rejected", () => {
    expect(() => cartTotal([{ productId: "ghost", quantity: 1 }])).toThrow("unknown product")
  })
})
EOF

cat > "$DIR/reporting.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test"
import { revenueByProduct, totalRevenue } from "./reporting"

describe("reporting", () => {
  test("per-product revenue applies tiers", () => {
    expect(revenueByProduct()).toEqual([
      { id: "keyboard", revenue: 150 },
      { id: "monitor", revenue: 228 },
      { id: "laptop", revenue: 1080 },
    ])
  })

  test("total revenue", () => {
    expect(totalRevenue()).toBe(1458)
  })
})
EOF

echo "fixture ready at $DIR"
