import "../preload"
import { describe, expect, spyOn, test } from "bun:test"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { handleCheckpoint } from "@/core/session/prompt/checkpoint"
import { PromptContext } from "@/core/session/prompt/context"

describe("checkpoint handoff format (PIPE-02)", () => {
  test("drops an invalid checkpoint turn before retrying", async () => {
    const removed = spyOn(Session, "removeMessage").mockImplementation((async () => "msg_checkpoint") as never)
    const updated = spyOn(Session, "updateMessage").mockImplementation((async (message: unknown) => message) as never)
    try {
      const result = await handleCheckpoint({
        result: { status: "continue", terminalFinish: "stop" } as never,
        sessionID: "ses_checkpoint",
        lastUser: {} as never,
        executionContext: { executionID: "exec_checkpoint" } as never,
        processor: { message: { id: "msg_checkpoint", finish: "stop" } } as never,
        eventCheckpoint: false,
        RouteRuntime: { recordCheckpointFailure: () => 1 } as never,
        parseCheckpointJsonCandidates: (() => []) as never,
        checkpointFinalParts: (() => []) as never,
      })
      expect(result.action).toBe("continue")
      expect(removed).toHaveBeenCalledWith({ sessionID: "ses_checkpoint", messageID: "msg_checkpoint" })
      expect(updated).not.toHaveBeenCalled()
    } finally {
      removed.mockRestore()
      updated.mockRestore()
    }
  })

  test("shows ordinary provider reasoning but keeps checkpoint JSON private", async () => {
    const updated = spyOn(Session, "updatePart").mockImplementation((async (part: unknown) => part) as never)
    const checkpoint = JSON.stringify({ decision: "continue", requestedCalls: 10 })
    try {
      const result = await handleCheckpoint({
        result: {
          status: "continue",
          checkpointReasoningCandidates: ["Checking game controls", checkpoint],
          checkpointReasoningParts: [
            { id: "reasoning-1", type: "reasoning", text: "Checking game controls" },
            { id: "reasoning-2", type: "reasoning", text: checkpoint },
          ],
        } as never,
        sessionID: "ses_checkpoint",
        lastUser: { id: "msg_user" } as never,
        executionContext: { executionID: "exec_checkpoint" } as never,
        processor: { message: { id: "msg_checkpoint", providerID: "test", modelID: "model" } } as never,
        eventCheckpoint: false,
        RouteRuntime: {
          allowance: () => 10,
          checkpointReason: () => "requested",
          reconcileCheckpoint: (_id: string, value: unknown) => value,
          applyCheckpoint: () => ({ sequence: 1, grantedCalls: 10 }),
          getExecutionEvidence: () => ({}),
        } as never,
        parseCheckpointJsonCandidates: ((text: string) => {
          try {
            return [JSON.parse(text)]
          } catch {
            return []
          }
        }) as never,
        checkpointFinalParts: (() => []) as never,
      })
      expect(result.action).toBe("continue")
      expect(updated.mock.calls.some(([part]) => (part as { text?: string }).text === "Checking game controls")).toBe(
        true,
      )
      expect(updated.mock.calls.some(([part]) => (part as { text?: string }).text === checkpoint)).toBe(false)
    } finally {
      updated.mockRestore()
    }
  })

  test("carries the durable decision fields and bounded counters only", () => {
    const handoff = SessionPrompt._internals.checkpointHandoff({
      sequence: 3,
      payload: {
        checkpoint: {
          decision: "continue",
          objectiveAssessment: "objective intact",
          progressSummary: "halfway",
          completedWork: ["implemented parser"],
          remainingWork: ["wire the renderer"],
          failures: [],
          blockers: ["env missing"],
          routeAssessment: "route is appropriate",
          nextActions: ["wire the renderer"],
        },
        evidence: {
          toolCalls: 21,
          successfulToolCalls: 18,
          failureCount: 1,
          filesRead: ["src/a.ts", "src/b.ts"],
          filesChanged: ["src/a.ts"],
          recentToolCallSignatures: ["read:src/a.ts"],
          recentSemanticActionResults: ["verify:ok"],
          recentToolTargets: ["read:src/a.ts:"],
        },
        telemetry: { executionID: "exec_cp", reason: "requested" },
        mutationRevision: 9,
        planRevision: 2,
        routeRevision: 4,
      },
    })

    const parsed = JSON.parse(handoff)
    expect(parsed).toMatchObject({
      sequence: 3,
      decision: "continue",
      progressSummary: "halfway",
      completedWork: ["implemented parser"],
      remainingWork: ["wire the renderer"],
      blockers: ["env missing"],
      nextActions: ["wire the renderer"],
      counters: {
        toolCalls: 21,
        successfulToolCalls: 18,
        failureCount: 1,
        filesRead: 2,
        filesChanged: 1,
      },
      mutationRevision: 9,
      planRevision: 2,
      routeRevision: 4,
    })
    // Raw evidence arrays duplicate the since-checkpoint delta and the
    // checkpoint parts already present in the session history.
    expect(handoff).not.toContain("recentToolCallSignatures")
    expect(handoff).not.toContain("recentSemanticActionResults")
    expect(handoff).not.toContain("recentToolTargets")
    expect(handoff).not.toContain("telemetry")
  })

  test("bounds oversized handoffs", () => {
    const handoff = SessionPrompt._internals.checkpointHandoff({
      sequence: 1,
      payload: {
        checkpoint: {
          decision: "continue",
          completedWork: Array.from({ length: 2_000 }, (_, index) => `item-${index}-${"x".repeat(50)}`),
        },
      },
    })
    expect(handoff.length).toBe(12_000)
  })
})

describe("checkpoint delta accumulation (CHECKPOINT-DELTA)", () => {
  test("invalidated claims remain in ledger history but leave future completed summaries", () => {
    const history = [
      { payload: { checkpoint: { completedWork: ["Verified 3D gameplay", "Mail works"] } } },
      { payload: { checkpoint: { invalidatedWork: [{ claim: "Verified 3D gameplay", reason: "HUD-only proof" }] } } },
    ]
    expect(PromptContext.accumulateCheckpointFields(history).completedWork).toEqual(["Mail works"])
    expect(history[0].payload.checkpoint.completedWork).toContain("Verified 3D gameplay")
  })
  const checkpoint = (completedWork: string[], failures: string[] = [], blockers: string[] = []) => ({
    payload: { checkpoint: { completedWork, failures, blockers, discoveries: [] } },
  })

  test("accumulates completed work across slices without duplication", () => {
    const accumulated = PromptContext.accumulateCheckpointFields([
      checkpoint(["slice 1: wrote shell"]),
      checkpoint(["slice 2: added runtime", "slice 1: wrote shell"]),
      checkpoint(["slice 3: verified boot"]),
    ])
    // Old history is preserved exactly once, and slices keep their ordering.
    expect(accumulated.completedWork).toEqual([
      "slice 1: wrote shell",
      "slice 2: added runtime",
      "slice 3: verified boot",
    ])
  })

  test("delta-only checkpoints still reconstruct the full history", () => {
    // Each slice reports ONLY its own new items — the harness owns the union.
    const accumulated = PromptContext.accumulateCheckpointFields([
      checkpoint(["a"]),
      checkpoint(["b"]),
      checkpoint(["c"]),
    ])
    expect(accumulated.completedWork).toEqual(["a", "b", "c"])
  })

  test("accumulates failures and blockers and tolerates malformed payloads", () => {
    const accumulated = PromptContext.accumulateCheckpointFields([
      checkpoint([], ["boom A"], ["blocked on env"]),
      { payload: undefined },
      { payload: { checkpoint: { failures: ["boom B"] } } },
      { payload: { checkpoint: { failures: "not-an-array" } } } as never,
    ])
    expect(accumulated.failures).toEqual(["boom A", "boom B"])
    expect(accumulated.blockers).toEqual(["blocked on env"])
  })

  test("an empty checkpoint list yields empty accumulators", () => {
    expect(PromptContext.accumulateCheckpointFields([])).toEqual({
      completedWork: [],
      failures: [],
      discoveries: [],
      blockers: [],
    })
  })
})
