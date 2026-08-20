import { describe, test, expect } from "bun:test"
import { SessionPolicy } from "@/core/session/policy"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("SessionPolicy", () => {
  test("decideAgent selects correct agent by task keywords", async () => {
    expect(await SessionPolicy.decideAgent("Explore codebase structure")).toBe("explore")
    expect(await SessionPolicy.decideAgent("Review pull request changes")).toBe("reviewer")
    expect(await SessionPolicy.decideAgent("Write unit tests for auth")).toBe("checker")
    expect(await SessionPolicy.decideAgent("Update README docs")).toBe("documenter")
    expect(await SessionPolicy.decideAgent("Analyze financial report")).toBe("analyst")
    expect(await SessionPolicy.decideAgent("Implement new feature")).toBe("coder")
  })

  test("decideTools returns correct allowlist for restricted agents and undefined for primary", () => {
    expect(SessionPolicy.decideTools("explore")).toBeDefined()
    expect(SessionPolicy.decideTools("explore")).toContain("read")
    expect(SessionPolicy.decideTools("explore")).not.toContain("write")

    expect(SessionPolicy.decideTools("coder")).toBeUndefined()
    expect(SessionPolicy.decideTools("agent")).toBeUndefined()
  })

  test("shouldAutoStartChain triggers when step > 2 and no chain call", () => {
    expect(SessionPolicy.shouldAutoStartChain(1, false)).toBe(false)
    expect(SessionPolicy.shouldAutoStartChain(3, false)).toBe(true)
    expect(SessionPolicy.shouldAutoStartChain(3, true)).toBe(false)
  })

  test("decideModel returns fallback model structure", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({ directory: tmp.path, fn: async () => {
      const model = await SessionPolicy.decideModel("coder", "coding")
      expect(model.providerID).toBeDefined()
      expect(model.modelID).toBeDefined()
    } })
  })
})
