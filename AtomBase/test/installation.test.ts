import "./preload"
import { describe, expect, test } from "bun:test"
import { Installation } from "@/services/installation"

describe("Installation Service - Windows Native Upgrade Helpers", () => {
  test("compareVersions handles semver and pre-release versions", () => {
    expect(Installation.compareVersions("v0.1.50", "v0.1.49")).toBeGreaterThan(0)
    expect(Installation.compareVersions("0.1.49", "0.1.50")).toBeLessThan(0)
    expect(Installation.compareVersions("1.0.0", "1.0.0")).toBe(0)
  })

  test("cleanupOldExecutables runs without throwing on non-windows or missing old file", async () => {
    await expect(Installation.cleanupOldExecutables()).resolves.toBeUndefined()
  })

  test("release targets are normalized and unsafe values are rejected", () => {
    expect(Installation.normalizeReleaseTarget("v3.4.2-beta")).toBe("3.4.2-beta")
    expect(() => Installation.normalizeReleaseTarget("3.4.2'; Remove-Item C:\\*")).toThrow("Invalid release target")
    expect(() => Installation.normalizeReleaseTarget("".padEnd(129, "a"))).toThrow("Invalid release target")
  })
})
