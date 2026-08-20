import { describe, expect, test } from "bun:test"
import { ToolReliability } from "@/core/routing/tool-reliability"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("ToolReliability", () => {
  test("keeps concurrent first observations and redacts transient errors", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Promise.all([
          ToolReliability.record({
            providerID: "p",
            modelID: "m",
            tool: "bash",
            ok: false,
            latencyMs: 10,
            error: "token=secret-value\nstack",
          }),
          ToolReliability.record({ providerID: "p", modelID: "m", tool: "read", ok: true, latencyMs: 20 }),
        ])
        expect(Object.keys(ToolReliability.snapshot())).toHaveLength(2)
        expect(ToolReliability.get("p", "m", "bash")?.lastError).toBe("token=[redacted]")
        await ToolReliability.record({
          providerID: "p",
          modelID: "m",
          tool: "auth",
          ok: false,
          latencyMs: 10,
          error: "Authorization: Bearer sk-secret-value",
        })
        expect(ToolReliability.get("p", "m", "auth")?.lastError).toBe("Authorization=[redacted]")
        await ToolReliability.record({ providerID: "p", modelID: "m", tool: "bash", ok: true, latencyMs: 10 })
        expect(ToolReliability.get("p", "m", "bash")?.lastError).toBeUndefined()
      },
    })
  })

  test("uses observed success rate and latency only after enough samples", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ToolReliability.record({ providerID: "good", modelID: "m", tool: "read", ok: true, latencyMs: 100 })
        expect(ToolReliability.modelBonus("good", "m", ["read"])).toBe(0)
        await ToolReliability.record({ providerID: "good", modelID: "m", tool: "read", ok: true, latencyMs: 100 })

        await ToolReliability.record({ providerID: "bad", modelID: "m", tool: "read", ok: false, latencyMs: 8_000 })
        await ToolReliability.record({ providerID: "bad", modelID: "m", tool: "read", ok: false, latencyMs: 8_000 })

        expect(ToolReliability.modelBonus("good", "m", ["read"])).toBeGreaterThan(0)
        expect(ToolReliability.modelBonus("bad", "m", ["read"])).toBeLessThan(0)
        expect(ToolReliability.modelBonus("good", "m", ["unknown"])).toBe(0)
      },
    })
  })
})
