import { describe, expect, test } from "bun:test"
import { HarnessState } from "@/core/session/harness-state"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "./fixture/fixture"

describe("HarnessState - OrchestratorLock", () => {
  test("lockOrchestrator sets active workflow ID and unlockOrchestrator clears it", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-lock-test-1"

        // Initial state should be undefined
        expect(HarnessState.getActiveWorkflowId(sessionID)).toBeUndefined()

        // Lock orchestrator
        HarnessState.lockOrchestrator(sessionID, "workflow-999")
        expect(HarnessState.getActiveWorkflowId(sessionID)).toBe("workflow-999")

        // Unlock orchestrator
        HarnessState.unlockOrchestrator(sessionID)
        expect(HarnessState.getActiveWorkflowId(sessionID)).toBeUndefined()
      },
    })
  })

  test("maintains session isolation and handles lock overwriting", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionA = "session-lock-A"
        const sessionB = "session-lock-B"

        HarnessState.lockOrchestrator(sessionA, "wf-A1")
        HarnessState.lockOrchestrator(sessionB, "wf-B1")

        expect(HarnessState.getActiveWorkflowId(sessionA)).toBe("wf-A1")
        expect(HarnessState.getActiveWorkflowId(sessionB)).toBe("wf-B1")

        // Overwrite lock on sessionA
        HarnessState.lockOrchestrator(sessionA, "wf-A2")
        expect(HarnessState.getActiveWorkflowId(sessionA)).toBe("wf-A2")
        expect(HarnessState.getActiveWorkflowId(sessionB)).toBe("wf-B1")

        // Unlock sessionA
        HarnessState.unlockOrchestrator(sessionA)
        expect(HarnessState.getActiveWorkflowId(sessionA)).toBeUndefined()
        expect(HarnessState.getActiveWorkflowId(sessionB)).toBe("wf-B1")

        // Cleanup sessionB
        HarnessState.unlockOrchestrator(sessionB)
      },
    })
  })

  test("clears lock on HarnessState.reset", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-lock-reset"
        HarnessState.lockOrchestrator(sessionID, "wf-reset-1")
        expect(HarnessState.getActiveWorkflowId(sessionID)).toBe("wf-reset-1")

        HarnessState.reset(sessionID)
        expect(HarnessState.getActiveWorkflowId(sessionID)).toBeUndefined()
      },
    })
  })
})

describe("HarnessState - QASessionRegistry", () => {
  test("setQASession allows getQASession to retrieve correct QA session ID", async () => {
    const orchSessionID = "orch-qa-test-1"
    const taskId = "task-1"
    const qaSessionId = "qa-sess-100"

    expect(HarnessState.getQASession(orchSessionID, taskId)).toBeUndefined()

    HarnessState.setQASession(orchSessionID, taskId, qaSessionId)
    expect(HarnessState.getQASession(orchSessionID, taskId)).toBe(qaSessionId)

    // Cleanup
    HarnessState.clearQASession(orchSessionID, taskId)
  })

  test("clearQASession removes specified task record and leaves other task records intact", async () => {
    const orchID = "orch-qa-test-2"
    HarnessState.setQASession(orchID, "task-A", "qa-A")
    HarnessState.setQASession(orchID, "task-B", "qa-B")

    expect(HarnessState.getQASession(orchID, "task-A")).toBe("qa-A")
    expect(HarnessState.getQASession(orchID, "task-B")).toBe("qa-B")

    HarnessState.clearQASession(orchID, "task-A")
    expect(HarnessState.getQASession(orchID, "task-A")).toBeUndefined()
    expect(HarnessState.getQASession(orchID, "task-B")).toBe("qa-B")

    // Cleanup
    HarnessState.clearQASession(orchID, "task-B")
  })

  test("clearAllQASessions clears all records for specified orchestrator session without affecting other orchestrator sessions", async () => {
    const orchID1 = "orch-qa-multi-1"
    const orchID2 = "orch-qa-multi-2"

    HarnessState.setQASession(orchID1, "t-1", "qa-1-1")
    HarnessState.setQASession(orchID1, "t-2", "qa-1-2")
    HarnessState.setQASession(orchID1, "t-3", "qa-1-3")
    HarnessState.setQASession(orchID2, "t-1", "qa-2-1")

    HarnessState.clearAllQASessions(orchID1)

    expect(HarnessState.getQASession(orchID1, "t-1")).toBeUndefined()
    expect(HarnessState.getQASession(orchID1, "t-2")).toBeUndefined()
    expect(HarnessState.getQASession(orchID1, "t-3")).toBeUndefined()

    // Assert second orchestrator session was left untouched
    expect(HarnessState.getQASession(orchID2, "t-1")).toBe("qa-2-1")

    // Cleanup
    HarnessState.clearAllQASessions(orchID2)
  })
})
