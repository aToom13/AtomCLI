import "../preload"
import { describe, expect, test } from "bun:test"
import { TaskFlowTool } from "@/integrations/tool/taskflow"
import { TaskflowReconciliation } from "@/core/execution/runtime/taskflow-reconciliation"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"

const VERIFIED = {
  decision: "finish",
  completedWork: ["Implemented and verified against current test evidence"],
  failures: [],
  finalResponse: "All requested work is complete; the latest test run passes with current evidence.",
}

describe("TaskflowReconciliation", () => {
  test("verified completion reconciles open work bookkeeping so the gate closes", async () => {
    await using tmp = await tmpdir({ git: true, config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const ctx = {
          sessionID: session.id,
          messageID,
          agent: "agent",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          extra: { execution },
        }
        const tool = await TaskFlowTool.init({})
        const eid = execution.executionID
        // On start the single work step becomes running. The model has finished
        // the real work but left the active step open (the observed loop).
        await tool.execute({ action: "start", plan: [{ id: "w1", name: "Implement", status: "running" }] }, ctx)
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(eid)).toBe(true)

        const outcome = await TaskflowReconciliation.reconcile(session.id, execution, VERIFIED)
        expect(outcome.skipped).toBe("none")
        expect(outcome.reconciled).toBe(1)
        const after = ExecutionRuntime.taskflowPlan(eid, session.id)
        expect(after.find((item) => item.resourceScope.includes("w1"))?.state).toBe("resolved")
        // The verified completion reconciled the bookkeeping step, so the gate
        // no longer blocks on the taskflow plan.
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(eid)).toBe(false)
      },
    })
  })

  test("independent-review steps are never auto-completed", async () => {
    await using tmp = await tmpdir({ git: true, config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const ctx = {
          sessionID: session.id,
          messageID,
          agent: "agent",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          extra: { execution },
        }
        const tool = await TaskFlowTool.init({})
        const eid = execution.executionID
        await tool.execute(
          {
            action: "start",
            plan: [
              { id: "w1", name: "Implement", status: "running" },
              { id: "review", name: "Independent review", type: "independent_review" },
            ],
          },
          ctx,
        )
        await tool.execute({ action: "complete", step_id: "w1", output: "Implemented" }, ctx)
        const outcome = await TaskflowReconciliation.reconcile(session.id, execution, VERIFIED)
        expect(["independent_review", "no_evidence"]).toContain(outcome.skipped)
        // The review step must remain open.
        const after = ExecutionRuntime.taskflowPlan(eid, session.id)
        expect(after.find((item) => item.producerID.endsWith(":independent_review"))?.state).not.toBe("resolved")
      },
    })
  })

  test("never-started (pending) work is not auto-completed even on verified evidence", async () => {
    await using tmp = await tmpdir({ git: true, config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const ctx = {
          sessionID: session.id,
          messageID,
          agent: "agent",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          extra: { execution },
        }
        const tool = await TaskFlowTool.init({})
        const eid = execution.executionID
        // No step is ever activated to running; only bookkeeping "pending" steps
        // exist. Verified completion evidence must NOT silently resolve work that
        // was never started (state machine: pending cannot move straight to resolved).
        await tool.execute({ action: "start", plan: [{ id: "w1", name: "Implement" }] }, ctx)
        const outcome = await TaskflowReconciliation.reconcile(session.id, execution, VERIFIED)
        expect(outcome.reconciled).toBe(0)
        expect(ExecutionRuntime.taskflowPlan(eid, session.id).find((i) => i.resourceScope.includes("w1"))?.state).toBe(
          "pending",
        )
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(eid)).toBe(true)
      },
    })
  })

  test("reported failures or missing evidence refuse reconciliation", async () => {
    await using tmp = await tmpdir({ git: true, config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const ctx = {
          sessionID: session.id,
          messageID,
          agent: "agent",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
          extra: { execution },
        }
        const tool = await TaskFlowTool.init({})
        const eid = execution.executionID
        await tool.execute({ action: "start", plan: [{ id: "w1", name: "Implement", status: "running" }] }, ctx)
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(eid)).toBe(true)

        // Failures reported -> no auto-completion.
        await TaskflowReconciliation.reconcile(session.id, execution, {
          ...VERIFIED,
          failures: ["test suite red"],
        }).then((outcome) => expect(outcome.skipped).toBe("no_evidence"))
        // No completed work reported -> no auto-completion.
        await TaskflowReconciliation.reconcile(session.id, execution, {
          ...VERIFIED,
          completedWork: [],
        }).then((outcome) => expect(outcome.skipped).toBe("no_evidence"))
        // Non-finish decision -> no auto-completion.
        await TaskflowReconciliation.reconcile(session.id, execution, {
          ...VERIFIED,
          decision: "continue",
        }).then((outcome) => expect(outcome.skipped).toBe("not_finish"))
        // Nothing was reconciled.
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(eid)).toBe(true)
      },
    })
  })
})
