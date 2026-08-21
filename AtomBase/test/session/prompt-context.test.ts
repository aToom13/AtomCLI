import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Config } from "@/core/config/config"
import { tmpdir } from "../fixture/fixture"

describe("session prompt turn context", () => {
  test("puts the max-step instruction in system context without ending on an assistant turn", () => {
    const messages = [{ role: "user" as const, content: "Continue the task" }]
    const result = SessionPrompt._internals.prepareTurnContext(["base"], messages, true)

    expect(result.system).toHaveLength(2)
    expect(result.system[1]).toContain("MAXIMUM STEPS REACHED")
    expect(result.messages).toEqual(messages)
    expect(result.messages.at(-1)?.role).toBe("user")
  })

  test("does not alter normal turn context", () => {
    const system = ["base"]
    const messages = [{ role: "assistant" as const, content: "history" }]
    const result = SessionPrompt._internals.prepareTurnContext(system, messages, false)

    expect(result.system).toBe(system)
    expect(result.messages).toBe(messages)
  })

  test("omits tool schemas only for exact casual turns", () => {
    const decide = (prompt: string) =>
      SessionPrompt._internals.shouldLoadTools({
        prompt,
        explicitTools: false,
        bypassAgentCheck: false,
        hasPriorToolActivity: false,
      })

    expect(decide("Selam")).toBe(false)
    expect(decide("Naber?")).toBe(false)
    expect(decide("HI")).toBe(false)
    expect(decide("Add an endpoint")).toBe(true)
    expect(decide("Yeni bir endpoint ekle")).toBe(true)
    expect(decide("Find why the app is slow")).toBe(true)
    expect(decide("Devam et")).toBe(true)
  })

  test("preserves tools for explicit agents, tool overrides, and continuing tool sessions", () => {
    const decide = (overrides: Partial<Parameters<typeof SessionPrompt._internals.shouldLoadTools>[0]>) =>
      SessionPrompt._internals.shouldLoadTools({
        prompt: "Selam",
        explicitTools: false,
        bypassAgentCheck: false,
        hasPriorToolActivity: false,
        ...overrides,
      })

    expect(decide({ explicitTools: true })).toBe(true)
    expect(decide({ bypassAgentCheck: true })).toBe(true)
    expect(decide({ prompt: "Continue", hasPriorToolActivity: true })).toBe(true)
  })

  test("recovers from a model removed since the session was created", async () => {
    await Config.clearCache()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: "atomcli", modelID: "removed-free-model" },
          time: { created: Date.now() },
        })

        const selected = await SessionPrompt._internals.lastModel(session.id)
        expect(selected).not.toEqual({ providerID: "atomcli", modelID: "removed-free-model" })
      },
    })
  })
})
