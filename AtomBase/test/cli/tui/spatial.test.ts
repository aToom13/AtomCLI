import { describe, expect, test } from "bun:test"
import { SpatialGeometry } from "@tui/context/spatial"

describe("SpatialGeometry", () => {
  test("prefers absolute screen coordinates for nested hitboxes", () => {
    expect(SpatialGeometry.bounds({ x: 2, y: 3, screenX: 22, screenY: 13, width: 8, height: 2 })).toEqual({
      x: 22,
      y: 13,
      width: 8,
      height: 2,
    })
  })

  test("uses half-open cell bounds so adjacent controls do not overlap", () => {
    const bounds = { x: 10, y: 5, width: 4, height: 2 }
    expect(SpatialGeometry.contains(bounds, { x: 10, y: 5 })).toBe(true)
    expect(SpatialGeometry.contains(bounds, { x: 13, y: 6 })).toBe(true)
    expect(SpatialGeometry.contains(bounds, { x: 14, y: 6 })).toBe(false)
  })
})
