import { describe, expect, test } from "bun:test"
import { SessionReplay } from "@/core/session/replay"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const base = {
  system: ["system"],
  messages: [{ role: "user", content: "hello" }],
  tools: [{ id: "read", description: "read", schema: { type: "object" } }],
  route: { providerID: "test", modelID: "model", agent: "build" },
  pluginTransforms: ["chat.params"],
  injectedContext: [] as string[],
}

describe("replay invariant covers the full request context (REPLAY-01)", () => {
  test("accepts an exact replay and reports the mismatched fields", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const recorded = await SessionReplay.record({
          sessionID: "session-replay-invariant",
          system: base.system,
          messages: base.messages,
          tools: base.tools,
          route: base.route,
          pluginTransforms: base.pluginTransforms,
          injectedContext: base.injectedContext,
        })

        await expect(
          SessionReplay.assertModelInput("session-replay-invariant", recorded.requestID, {
            system: base.system,
            messages: base.messages,
            tools: base.tools,
            route: base.route,
          }),
        ).resolves.toBeUndefined()

        const mismatches: Array<[string, Partial<SessionReplay.Envelope>]> = [
          ["system", { system: ["tampered"] }],
          ["messages", { messages: [{ role: "user", content: "tampered" }] }],
          ["tools", { tools: [{ id: "bash", description: "bash", schema: { type: "object" } }] }],
          ["route", { route: { providerID: "other", modelID: "model", agent: "build" } }],
        ]
        for (const [field, wrong] of mismatches) {
          await expect(
            SessionReplay.assertModelInput("session-replay-invariant", recorded.requestID, { ...base, ...wrong }),
          ).rejects.toThrow(`Request replay invariant failed for ${recorded.requestID}: ${field}`)
        }
      },
    })
  })
})
