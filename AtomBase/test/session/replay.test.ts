import { describe, expect, test } from "bun:test"
import { SessionReplay } from "@/core/session/replay"
import { WorkflowStore } from "@/core/orchestration/workflow-store"
import { CompactionTransaction } from "@/core/session/compaction-transaction"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("durable replay and checkpoints", () => {
  test("reconstructs the exact recorded model input", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const recorded = await SessionReplay.record({
          sessionID: "session-replay",
          system: ["system"],
          messages: [{ role: "user", content: "hello" }],
          tools: [{ id: "read", description: "read", schema: { type: "object" } }],
          route: { providerID: "test", modelID: "model", agent: "build" },
          pluginTransforms: ["chat.params"],
          injectedContext: [],
        })
        expect(await SessionReplay.renderModelInput("session-replay", recorded.requestID)).toEqual({
          system: ["system"],
          messages: [{ role: "user", content: "hello" }],
          tools: [{ id: "read", description: "read", schema: { type: "object" } }],
          route: { providerID: "test", modelID: "model", agent: "build" },
        })
      },
    })
  })

  test("persists workflows independently from the in-memory scheduler", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await WorkflowStore.save({ id: "wf-test", status: "running", tasks: ["a"] })
        expect(await WorkflowStore.load<{ id: string; status: string; tasks: string[] }>("wf-test")).toEqual({
          id: "wf-test",
          status: "running",
          tasks: ["a"],
        })
      },
    })
  })

  test("recovers an unfinished compaction transaction", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const transaction = await CompactionTransaction.start("session-compact", 100, 0)
        expect(await CompactionTransaction.recover("session-compact")).toBe(1)
        expect(await CompactionTransaction.recover("session-compact")).toBe(0)
        expect(transaction.status).toBe("running")
      },
    })
  })
})
