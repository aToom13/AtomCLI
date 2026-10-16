import "../preload"
import { describe, expect, test, spyOn } from "bun:test"
import { SessionReplay } from "@/core/session/replay"
import { WorkflowStore } from "@/core/orchestration/workflow-store"
import { CompactionTransaction } from "@/core/session/compaction-transaction"
import { Instance } from "@/services/project/instance"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { Storage } from "@/core/storage/storage"
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

  test("workflow lookup distinguishes missing state from corrupted storage", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect(await WorkflowStore.load("wf_missing_state")).toBeUndefined()
        const read = spyOn(Storage, "read").mockRejectedValue(new SyntaxError("corrupt workflow JSON"))
        try {
          await expect(WorkflowStore.load("wf_corrupt_state")).rejects.toThrow("corrupt workflow JSON")
        } finally {
          read.mockRestore()
        }
      },
    })
  })

  test("workflow removal does not hide storage failures", async () => {
    const remove = spyOn(Storage, "remove").mockRejectedValue(new Error("disk unavailable"))
    try {
      await expect(WorkflowStore.remove("wf-remove-error")).rejects.toThrow("disk unavailable")
    } finally {
      remove.mockRestore()
    }
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

  test("recovery deletes the orphan summary message of a crashed compaction", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const parentID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentID,
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
          time: { created: Date.now() },
        })
        // Simulate a crash after the summary message was written but before
        // the transaction was committed.
        const summaryMessageID = Identifier.ascending("message")
        const transaction = await CompactionTransaction.start(session.id, 100, 0, {
          parentID,
          summaryMessageID,
        })
        await Session.updateMessage({
          id: summaryMessageID,
          sessionID: session.id,
          role: "assistant",
          parentID,
          agent: "compaction",
          summary: true,
          path: { cwd: project.path, root: project.path },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "fixture",
          providerID: "test",
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: summaryMessageID,
          sessionID: session.id,
          type: "text",
          text: "orphan summary from a crashed compaction",
        })
        expect(await Storage.read(["message", session.id, summaryMessageID])).toBeDefined()
        expect((await Storage.list(["part", summaryMessageID])).length).toBe(1)

        expect(await CompactionTransaction.recover(session.id)).toBe(1)

        expect(await Storage.read(["message", session.id, summaryMessageID]).catch(() => undefined)).toBeUndefined()
        expect((await Storage.list(["part", summaryMessageID])).length).toBe(0)
        // The parent user message must survive the cleanup.
        expect(await Storage.read(["message", session.id, parentID])).toBeDefined()
        const recovered = CompactionTransaction.Info.parse(
          await Storage.read(["compaction_transaction", session.id, transaction.id]),
        )
        expect(recovered.status).toBe("recovered")
        expect(await CompactionTransaction.isCommittedSummary(session.id, summaryMessageID)).toBe(false)
      },
    })
  })

  test("treats a summary with no linked transaction record as uncommitted (fail-closed)", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect(await CompactionTransaction.isCommittedSummary("session-no-txn", "msg_missing")).toBe(false)
      },
    })
  })

  test("does not treat an unfinished linked summary as committed", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const running = await CompactionTransaction.start("session-compact-link", 100, 0, {
          parentID: "user-compact",
          summaryMessageID: "assistant-summary",
        })
        expect(await CompactionTransaction.isCommittedSummary("session-compact-link", "assistant-summary")).toBe(false)
        await CompactionTransaction.finish(running, 20, true)
        expect(await CompactionTransaction.isCommittedSummary("session-compact-link", "assistant-summary")).toBe(true)
      },
    })
  })
})
