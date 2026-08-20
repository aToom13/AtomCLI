import { beforeEach, describe, expect, test } from "bun:test"
import { ModelQuality } from "@/core/routing/model-quality"

describe("ModelQuality", () => {
  beforeEach(() => ModelQuality.resetForTest())

  test("uses provider/model keys so equal model IDs do not collide", () => {
    expect(ModelQuality.key("a", "shared")).toBe("a/shared")
    expect(ModelQuality.key("b", "shared")).toBe("b/shared")
  })

  test("does not bias selection before enough outcome samples exist", () => {
    expect(ModelQuality.bonus("provider", "model", "coding")).toBe(0)
  })
})
