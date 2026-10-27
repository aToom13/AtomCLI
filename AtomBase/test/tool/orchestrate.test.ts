import { describe, test, expect, spyOn } from "bun:test"
import "../preload"
import { OrchestrateTool, _internals as orchestrateInternals } from "@/integrations/tool/orchestrate"
import { _internals as routerInternals } from "@/integrations/tool/model-router"
import { inferCategory } from "@/integrations/tool/model-router"
import {
  AGENT_RESULT_CONTRACT,
  AgentResultValidationError,
  checkAgentResultStatus,
  checkEditedTaskResult,
} from "@/integrations/tool/orchestrate/output"
import {
  cleanupOldWorkflows,
  findWorkflow,
  reserveWorkflowSlot,
  refreshWorkflowRecovery,
  reconcileDurableTaskProjection,
} from "@/integrations/tool/orchestrate/lifecycle"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { MAX_WORKFLOWS } from "@/integrations/tool/orchestrate/state"
import { abortWorkflow, statusWorkflow } from "@/integrations/tool/orchestrate/actions"
import { planWorkflow } from "@/integrations/tool/orchestrate/plan"
import { limitText } from "@/integrations/tool/orchestrate/dependencies"
import { Instance } from "@/services/project/instance"
import { Session } from "@/core/session"
import { HarnessState } from "@/core/session/harness-state"
import { WorkflowStore } from "@/core/orchestration/workflow-store"
import { SubAgent } from "@/integrations/tool/subagent"
import { tmpdir } from "../fixture/fixture"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { Identifier } from "@/core/id/id"
import { Storage } from "@/core/storage/storage"
import type { TaskCategory } from "@/integrations/tool/model-router"

const {
  topologicalSort,
  getReadyTasks,
  hasFailedDependency,
  preferredModel,
  canonicalReference,
  executionReference,
  dependencyIds,
  buildDependencyContext,
  requiresTaskQA,
  WorkflowStateStore,
  WorkflowExecutionStore,
  claimWorkflowExecution,
  releaseWorkflowExecution,
  markInterruptedTasksUnknown,
} = orchestrateInternals
const { scoreModel } = routerInternals

describe("orchestrate - edited task result", () => {
  test("rejects reported failure and malformed result instead of marking edited work complete", () => {
    expect(() =>
      checkEditedTaskResult(
        '<agent_result>{"status":"incomplete","failures":["SyntaxError: Unexpected token ]"]}</agent_result>',
      ),
    ).toThrow("SyntaxError")
    expect(() => checkEditedTaskResult('<agent_result>{"failures":"syntax error"}</agent_result>')).toThrow(
      "agent_result.failures",
    )
    expect(() => checkEditedTaskResult('<agent_result>{"status":"complete","failures":[]</agent_result>')).toThrow(
      "invalid agent_result JSON",
    )
    expect(() => checkEditedTaskResult("The script is not ready; syntax check failed.")).toThrow("agent_result")
    expect(() =>
      checkEditedTaskResult('<agent_result>{"status":"complete","failures":[]}</agent_result>'),
    ).not.toThrow()
  })

  test("contract sample and populated fields agree with the result validator", () => {
    const sample = AGENT_RESULT_CONTRACT.match(/<agent_result>.*<\/agent_result>/)![0]
    expect(() => checkEditedTaskResult(sample)).not.toThrow()
    const valid = {
      status: "complete",
      summary: "Verified",
      facts: [{ key: "diagnostic", value: "Optional editor warning", evidence: ["file:1"] }],
      decisions: ["Use existing dependency"],
      tests: ["bun test: 3 pass"],
      failures: [],
      confidence: 1,
    }
    expect(() => checkEditedTaskResult(`<agent_result>${JSON.stringify(valid)}</agent_result>`)).not.toThrow()
    for (const field of ["failures", "tests"]) {
      const output = `<agent_result>${JSON.stringify({ ...valid, [field]: [{ key: "diagnostic", value: "warning", evidence: ["file:1"] }] })}</agent_result>`
      expect(() => checkEditedTaskResult(output)).toThrow(AgentResultValidationError)
      expect(() => checkEditedTaskResult(output)).toThrow(`agent_result.${field}`)
    }
    expect(AGENT_RESULT_CONTRACT).toContain("arrays of strings only")
    expect(AGENT_RESULT_CONTRACT).toContain("non-blocking diagnostics")
  })
})

describe("orchestrate - read-only result status", () => {
  test("rejects an explicitly incomplete child result", () => {
    expect(() =>
      checkAgentResultStatus('<agent_result>{"status":"incomplete","failures":["test failed"]}</agent_result>'),
    ).toThrow("Agent task incomplete")
  })

  test("accepts legacy output without a result block", () => {
    expect(() => checkAgentResultStatus("analysis finished")).not.toThrow()
  })
})

describe("orchestrate - execution ownership", () => {
  test.each(["retry", "revision", "feedback"])("durable execution handles %s during child work", async (mode) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const userID = Identifier.ascending("message")
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: parent.id,
          role: "user",
          agent: "build",
          model: { providerID: "atomcli", modelID: "hy3-free" },
          time: { created: Date.now() },
        })
        await Storage.write(["message", parent.id, messageID], {
          id: messageID,
          sessionID: parent.id,
          parentID: userID,
          role: "assistant",
          agent: "build",
          modelID: "hy3-free",
          providerID: "atomcli",
          mode: "",
          time: { created: Date.now() },
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: parent.id, invocationID: userID })
        const tool = await OrchestrateTool.init()
        const ctx = {
          sessionID: parent.id,
          messageID,
          agent: "build",
          abort: AbortSignal.any([]),
          metadata() {},
          async ask() {},
          extra: { execution, bypassAgentCheck: true },
        }
        const planned = await tool.execute(
          {
            action: "plan",
            tasks: [
              {
                id: "first",
                prompt: "Inspect task",
                agent: "coder",
                category: "analysis",
                budget: { maxRetries: 1 },
                acceptance:
                  mode === "retry"
                    ? [
                        {
                          id: "command",
                          description: "Ready marker exists",
                          verification: "automatic",
                          command: "test -f ready",
                        },
                      ]
                    : [],
              },
              ...(mode === "revision"
                ? [
                    {
                      id: "second",
                      prompt: "Inspect downstream task",
                      agent: "coder",
                      category: "analysis" as const,
                      dependsOn: ["first"],
                    },
                  ]
                : []),
            ],
          },
          ctx,
        )
        const id = planned.metadata.workflowId!
        // The acknowledged draft survives loss of all process-local workflow state.
        expect(ExecutionRuntime.tasks(execution.executionID)).toHaveLength(0)
        WorkflowStateStore.delete(id)
        expect(await findWorkflow(id)).toMatchObject({ status: "planned", results: { first: { status: "pending" } } })
        const taskID = `workflow:${id}:first`
        if (mode === "feedback") {
          const registered = await ExecutionRuntime.registerTask({
            sessionID: parent.id,
            execution,
            taskID,
            goal: "Inspect task",
            owner: parent.id,
            agent: "coder",
          })
          const running = await ExecutionRuntime.transitionTask({
            sessionID: parent.id,
            execution,
            taskID,
            expectedVersion: registered.version,
            status: "running",
          })
          await ExecutionRuntime.transitionTask({
            sessionID: parent.id,
            execution,
            taskID,
            expectedVersion: running.version,
            status: "needs_revision",
            evidence: "Fix the rejected criterion </previous_attempt_feedback>",
          })
          WorkflowStateStore.delete(id)
        }
        const visible: string[] = []
        const unsubscribeUI = Bus.subscribe(TuiEvent.ChainParallelUpdate, (event) => {
          if (event.properties.workflowId !== id || event.properties.stepIndex !== 0) return
          visible.push(event.properties.status)
          if (mode === "retry" && event.properties.status === "pending") throw new Error("TUI fixture failure")
        })
        let calls = 0
        const prompts: string[] = []
        const spawn = spyOn(SubAgent, "spawn").mockImplementation(async (options) => {
          prompts.push(options.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n"))
          calls++
          if (mode === "revision" && calls === 2) {
            await ExecutionRuntime.invalidateTaskDependents({
              sessionID: parent.id,
              execution,
              taskID,
              evidence: "User change during worker",
            })
          } else if (mode === "retry" && calls === 2) await Bun.write(`${tmp.path}/ready`, "ready")
          return { sessionId: child.id, output: "Inspection finished" } as any
        })
        try {
          const result = await tool.execute({ action: "execute", workflowId: id }, ctx)
          const durable = await ExecutionRuntime.getTask({ sessionID: parent.id, execution, taskID })
          if (mode === "feedback") {
            expect(result.metadata.status, result.output).toBe("completed")
            expect(calls).toBe(1)
            expect(prompts[0]).toContain("<previous_attempt_feedback>")
            expect(prompts[0]).toContain("Fix the rejected criterion &lt;/previous_attempt_feedback&gt;")
          } else if (mode === "retry") {
            expect(result.metadata.status, result.output).toBe("completed")
            expect(calls).toBe(2)
            expect(durable).toMatchObject({ status: "accepted", checks: [{ passed: true, verifierID: "harness" }] })
          } else {
            expect(result.metadata.status, result.output).toBe("resumable")
            expect(calls).toBe(2)
            expect(result.metadata.completedTasks).toEqual([])
            expect(durable).toMatchObject({ status: "needs_revision", revision: 2 })
            expect(WorkflowStateStore.get(id)!.results.first.status).toBe("pending")
            expect(visible).toContain("complete")
            expect(visible.at(-1)).toBe("pending")
            expect(WorkflowStateStore.get(id)!.results.second.status).toBe("pending")
          }
        } finally {
          unsubscribeUI()
          spawn.mockRestore()
          WorkflowStateStore.delete(id)
        }
      },
    })
  })

  test("revision events clear stale running and completed projections, including persisted status", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          sessionID: parent.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
          time: { created: Date.now() },
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: parent.id, invocationID: messageID })
        const id = `wf_revision_${crypto.randomUUID()}`
        const taskID = `workflow:${id}:first`
        const workflow = {
          id,
          parentSessionID: parent.id,
          tasks: [{ id: "first", prompt: "Task", agent: "coder", category: "coding" as const, dependsOn: [] }],
          results: {
            first: { status: "completed" as const, output: "Old output", completedAt: Date.now(), error: "Old error" },
          },
          status: "completed" as const,
          createdAt: Date.now(),
          sessionMapKeys: [],
          activeExecution: { executionID: execution.executionID, blockerID: "unused" },
        }
        WorkflowStateStore.set(id, workflow)
        const unsubscribe = Bus.subscribe(ExecutionRuntime.Event.TaskUpdated, async (event) => {
          if (event.properties.executionID === execution.executionID)
            await reconcileDurableTaskProjection(WorkflowStateStore.get(id)!)
        })
        try {
          const registered = await ExecutionRuntime.registerTask({
            sessionID: parent.id,
            execution,
            taskID,
            goal: "Task",
            owner: parent.id,
            agent: "coder",
          })
          await ExecutionRuntime.transitionTask({
            sessionID: parent.id,
            execution,
            taskID,
            expectedVersion: registered.version,
            status: "running",
          })
          await ExecutionRuntime.invalidateTaskDependents({
            sessionID: parent.id,
            execution,
            taskID,
            evidence: "Changed task",
          })
          expect(WorkflowStateStore.get(id)).toMatchObject({
            status: "resumable",
            results: { first: { status: "pending" } },
          })
          expect(WorkflowStateStore.get(id)!.results.first).toEqual({
            status: "pending",
            ledgerState: expect.objectContaining({ status: "needs_revision" }),
          })

          const revised = await ExecutionRuntime.getTask({ sessionID: parent.id, execution, taskID })
          expect(
            await ExecutionRuntime.transitionTask({
              sessionID: parent.id,
              execution,
              taskID,
              expectedVersion: revised!.version,
              status: "running",
            }),
          ).toMatchObject({ status: "running", revision: 2 })
          WorkflowStateStore.update(id, (current) => {
            current.results.first = { status: "running" }
          })
          await ExecutionRuntime.invalidateOpenTasks({ sessionID: parent.id, execution, evidence: "Another change" })
          expect(WorkflowStateStore.get(id)!.results.first).toEqual({
            status: "pending",
            ledgerState: expect.objectContaining({ status: "needs_revision" }),
          })

          // Status also reconciles after subscription ends and after a process reload.
          unsubscribe()
          WorkflowStateStore.set(id, workflow)
          await WorkflowStore.save(workflow)
          const status = await statusWorkflow(id, parent.id)
          expect(status.metadata).toMatchObject({ status: "resumable", tasks: { first: "pending" } })
          WorkflowStateStore.delete(id)
          expect((await findWorkflow(id))?.results.first).toEqual({
            status: "pending",
            ledgerState: expect.objectContaining({ status: "needs_revision" }),
          })
        } finally {
          unsubscribe()
          WorkflowStateStore.delete(id)
        }
      },
    })
  })

  test("frees abandoned planned workflow slots without deleting durable plans", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = `wf_stale_plan_${crypto.randomUUID()}`
        const workflow = {
          id,
          parentSessionID: "ses_stale-owner",
          tasks: [],
          results: {},
          status: "planned" as const,
          createdAt: Date.now() - 2 * 60 * 60 * 1000,
          sessionMapKeys: [],
        }
        WorkflowStateStore.set(id, workflow)
        await WorkflowStore.save(workflow)
        cleanupOldWorkflows()
        expect(WorkflowStateStore.get(id)).toBeUndefined()
        expect(await WorkflowStore.load(id)).toMatchObject({ id, status: "planned" })
      },
    })
  })

  test.each(["worker", "reviewer"])("abort continues after %s cancellation fails and permits retry", async (failed) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const worker = await Session.create({ parentID: parent.id })
        const other = await Session.create({ parentID: parent.id })
        const reviewer = await Session.create({ parentID: parent.id })
        const id = `wf_abort_${crypto.randomUUID()}`
        WorkflowStateStore.set(id, {
          id,
          parentSessionID: parent.id,
          tasks: ["first", "second"].map((id) => ({
            id,
            prompt: "",
            agent: "coder",
            category: "coding",
            dependsOn: [],
          })),
          results: {
            first: { status: "running", sessionId: worker.id },
            second: { status: "running", sessionId: other.id },
          },
          status: "running",
          createdAt: Date.now(),
          sessionMapKeys: [],
        })
        HarnessState.setQASession(parent.id, "first", reviewer.id)
        const failedID = failed === "worker" ? worker.id : reviewer.id
        let reject = true
        const cancel = spyOn(SubAgent, "cancel").mockImplementation(async (target) => {
          if (reject && target === failedID) throw new Error("cancellation unavailable")
        })
        try {
          const result = await abortWorkflow({ workflowId: id, sessionId: worker.id }, parent.id)
          expect(result.metadata.error).toBe(true)
          expect(result.output).toContain(failedID)
          expect(cancel.mock.calls.map(([target]) => target).sort()).toEqual([worker.id, other.id, reviewer.id].sort())
          expect(WorkflowStateStore.get(id)).toMatchObject({
            status: "resumable",
            results: { first: { status: "unknown" }, second: { status: "failed" } },
          })
          expect(await WorkflowStore.load(id)).toMatchObject({ status: "resumable" })
          reject = false
          expect((await abortWorkflow({ workflowId: id }, parent.id)).metadata.error).toBe(false)
          expect(WorkflowStateStore.get(id)).toMatchObject({
            status: "failed",
            results: { first: { status: "failed" } },
          })
        } finally {
          cancel.mockRestore()
          HarnessState.clearQASession(parent.id, "first")
          WorkflowStateStore.delete(id)
        }
      },
    })
  })

  test("expired workflow lease becomes unknown without replaying a running task", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = `wf_expired_${crypto.randomUUID()}`
        WorkflowStateStore.set(id, {
          id,
          parentSessionID: "ses_owner",
          tasks: [{ id: "worker", prompt: "", agent: "coder", category: "coding", dependsOn: [] }],
          results: { worker: { status: "running" } },
          status: "running",
          createdAt: Date.now(),
          sessionMapKeys: [],
          activeExecution: { executionID: "exec_old", blockerID: "block_old" },
        })
        const blocker = spyOn(ExecutionRuntime, "blocker").mockReturnValue({ state: "running" } as any)
        const lease = spyOn(ExecutionRuntime, "executionLeaseActive").mockReturnValue(true)
        try {
          expect(await refreshWorkflowRecovery(WorkflowStateStore.get(id)!)).toBe(false)
          expect(WorkflowStateStore.get(id)?.results.worker.status).toBe("running")
          lease.mockReturnValue(false)
          const owner = claimWorkflowExecution(id)!
          expect(await refreshWorkflowRecovery(WorkflowStateStore.get(id)!)).toBe(false)
          releaseWorkflowExecution(id, owner)
          expect(await refreshWorkflowRecovery(WorkflowStateStore.get(id)!)).toBe(true)
          expect(WorkflowStateStore.get(id)?.results.worker.status).toBe("unknown")
          expect(WorkflowStateStore.get(id)?.status).toBe("resumable")
        } finally {
          blocker.mockRestore()
          lease.mockRestore()
          WorkflowStateStore.delete(id)
        }
      },
    })
  })

  test("workflow capacity never evicts active work", () => {
    const before = WorkflowStateStore.entries()
    for (const [id] of before) WorkflowStateStore.delete(id)
    const prefix = `wf_capacity_${crypto.randomUUID()}`
    const ids = Array.from({ length: MAX_WORKFLOWS }, (_, index) => `${prefix}_${index}`)
    try {
      for (const id of ids) {
        WorkflowStateStore.set(id, {
          id,
          tasks: [],
          results: {},
          status: "running",
          createdAt: Date.now(),
          sessionMapKeys: [],
        })
      }
      expect(reserveWorkflowSlot()).toBe(false)
      expect(ids.every((id) => WorkflowStateStore.get(id)?.status === "running")).toBe(true)
      WorkflowStateStore.update(ids[0], (workflow) => {
        workflow.status = "completed"
      })
      expect(reserveWorkflowSlot()).toBe(true)
      expect(WorkflowStateStore.get(ids[0])).toBeUndefined()
      expect(WorkflowStateStore.get(ids[1])?.status).toBe("running")
    } finally {
      for (const id of ids) WorkflowStateStore.delete(id)
      for (const [id, workflow] of before) WorkflowStateStore.set(id, workflow)
    }
  })

  test("abort rejects foreign child and checks workflow ownership before cancellation", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const owner = await Session.create({})
        const stranger = await Session.create({})
        const foreignChild = await Session.create({ parentID: owner.id })
        const cancel = spyOn(SubAgent, "cancel").mockResolvedValue(undefined)
        try {
          const result = await abortWorkflow({ sessionId: foreignChild.id }, stranger.id)
          expect(result.metadata.error).toBe(true)
          expect(result.output).toContain("is not a child")

          const workflowID = `wf_ownership_${crypto.randomUUID()}`
          WorkflowStateStore.set(workflowID, {
            id: workflowID,
            parentSessionID: owner.id,
            tasks: [],
            results: {},
            status: "planned",
            createdAt: Date.now(),
            sessionMapKeys: [],
          })
          try {
            const combined = await abortWorkflow({ sessionId: foreignChild.id, workflowId: workflowID }, stranger.id)
            expect(combined.metadata.error).toBe(true)
            expect(combined.output).toContain("does not belong")
            expect(WorkflowStateStore.get(workflowID)?.status).toBe("planned")
            expect(cancel).not.toHaveBeenCalled()
          } finally {
            WorkflowStateStore.delete(workflowID)
          }
        } finally {
          cancel.mockRestore()
        }
      },
    })
  })

  test("abort with workflowId rejects a sibling session outside that workflow", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const owner = await Session.create({})
        const workflowChild = await Session.create({ parentID: owner.id })
        const unrelatedChild = await Session.create({ parentID: owner.id })
        const workflowID = `wf_membership_${crypto.randomUUID()}`
        WorkflowStateStore.set(workflowID, {
          id: workflowID,
          parentSessionID: owner.id,
          tasks: [{ id: "task", prompt: "", agent: "coder", category: "coding", dependsOn: [] }],
          results: { task: { status: "running", sessionId: workflowChild.id } },
          status: "running",
          createdAt: Date.now(),
          sessionMapKeys: [],
        })
        const cancel = spyOn(SubAgent, "cancel").mockResolvedValue(undefined)
        try {
          const result = await abortWorkflow({ workflowId: workflowID, sessionId: unrelatedChild.id }, owner.id)
          expect(result.metadata.error).toBe(true)
          expect(result.output).toContain("not part of workflow")
          expect(cancel).not.toHaveBeenCalled()
          expect(WorkflowStateStore.get(workflowID)?.status).toBe("running")
        } finally {
          cancel.mockRestore()
          WorkflowStateStore.delete(workflowID)
        }
      },
    })
  })

  test("status renders unknown task outcomes with a visible marker", async () => {
    const workflowID = `wf_unknown_status_${crypto.randomUUID()}`
    WorkflowStateStore.set(workflowID, {
      id: workflowID,
      parentSessionID: "ses_owner",
      tasks: [{ id: "task", prompt: "", agent: "coder", category: "coding", dependsOn: [] }],
      results: { task: { status: "unknown" } },
      status: "resumable",
      createdAt: Date.now(),
      sessionMapKeys: [],
    })
    try {
      const result = await statusWorkflow(workflowID, "ses_owner")
      expect(result.output).toContain("❓ unknown")
    } finally {
      WorkflowStateStore.delete(workflowID)
    }
  })

  test("plan rejects duplicate task identifiers before creating a workflow", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const before = new Set(WorkflowStateStore.keys())
        const result = await planWorkflow(
          {
            tasks: [
              { id: "same", prompt: "first", validationMode: "strict", isolation: "auto" },
              { id: "same", prompt: "second", validationMode: "strict", isolation: "auto" },
            ],
          },
          { sessionID: session.id },
          { info() {} },
        )
        expect(result.metadata.error).toBe(true)
        expect(result.output).toContain("Duplicate task ID: same")
        expect(WorkflowStateStore.keys().filter((id) => !before.has(id))).toEqual([])
      },
    })
  })

  test("dependency output limit includes its truncation marker within the byte budget", () => {
    const limited = limitText("é".repeat(100), 128)
    expect(Buffer.byteLength(limited)).toBeLessThanOrEqual(128)
    expect(limited).toContain("output preview truncated")
  })

  test("rejects malformed in-memory workflow state before status or execute can dereference it", async () => {
    const workflowID = `wf_malformed_${crypto.randomUUID()}`
    WorkflowStateStore.set(workflowID, { id: workflowID, status: "running" } as any)
    try {
      await expect(findWorkflow(workflowID)).rejects.toThrow("Invalid workflow state")
      const status = await statusWorkflow(workflowID, "ses_owner")
      expect(status.metadata.error).toBe(true)
      expect(status.title).toBe("Invalid Workflow")
    } finally {
      WorkflowStateStore.delete(workflowID)
    }
  })

  test("ownerless stored workflows do not grant cross-session control", async () => {
    const workflowID = `wf_legacy_${crypto.randomUUID()}`
    WorkflowStateStore.set(workflowID, {
      id: workflowID,
      tasks: [],
      results: {},
      status: "planned",
      createdAt: Date.now(),
      sessionMapKeys: [],
    })
    try {
      expect((await statusWorkflow(workflowID, "ses_stranger")).metadata.error).toBe(true)
      expect((await abortWorkflow({ workflowId: workflowID }, "ses_stranger")).metadata.error).toBe(true)
      expect(WorkflowStateStore.get(workflowID)?.status).toBe("planned")
    } finally {
      WorkflowStateStore.delete(workflowID)
    }
  })

  test("only one live execution can claim a workflow", () => {
    const workflowID = "wf-single-owner"
    const first = claimWorkflowExecution(workflowID)

    expect(first).toBeDefined()
    expect(claimWorkflowExecution(workflowID)).toBeUndefined()

    releaseWorkflowExecution(workflowID, Symbol("stale-owner"))
    expect(claimWorkflowExecution(workflowID)).toBeUndefined()

    releaseWorkflowExecution(workflowID, first!)
    const replacement = claimWorkflowExecution(workflowID)
    expect(replacement).toBeDefined()
    releaseWorkflowExecution(workflowID, replacement!)
    expect(WorkflowExecutionStore.has(workflowID)).toBe(false)
  })

  test("preserves interrupted task outcomes as unknown instead of retrying them", () => {
    const workflowID = "wf-interrupted-test"
    const workflow = {
      id: workflowID,
      tasks: [
        { id: "done", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
        { id: "in-flight", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
        { id: "not-started", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
      ],
      results: {
        done: { status: "completed" as const },
        "in-flight": { status: "running" as const, startedAt: 123 },
        "not-started": { status: "pending" as const },
      },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    WorkflowStateStore.set(workflowID, workflow)
    expect(markInterruptedTasksUnknown(workflow)).toBe(true)
    const updated = WorkflowStateStore.get(workflowID)!
    expect(updated.status).toBe("resumable")
    expect(updated.results["in-flight"]).toMatchObject({
      status: "unknown",
      startedAt: 123,
    })
    expect(updated.results["not-started"].status).toBe("pending")
    expect(getReadyTasks(updated).map((task) => task.id)).toEqual(["not-started"])
    WorkflowStateStore.delete(workflowID)
  })

  test("workflow reads are snapshots and parallel updates merge into stored state", async () => {
    const workflowID = "wf-snapshot-isolation"
    WorkflowStateStore.set(workflowID, {
      id: workflowID,
      tasks: [
        { id: "a", prompt: "", agent: "coder", category: "general", dependsOn: [] },
        { id: "b", prompt: "", agent: "coder", category: "general", dependsOn: [] },
      ],
      results: { a: { status: "pending" }, b: { status: "pending" } },
      status: "planned",
      createdAt: Date.now(),
      sessionMapKeys: [],
    })

    try {
      const snapshot = WorkflowStateStore.get(workflowID)!
      snapshot.tasks[0].prompt = "outside mutation"
      snapshot.results.a.status = "completed"
      expect(WorkflowStateStore.get(workflowID)?.tasks[0].prompt).toBe("")
      expect(WorkflowStateStore.get(workflowID)?.results.a.status).toBe("pending")

      await Promise.all([
        Promise.resolve().then(() =>
          WorkflowStateStore.update(workflowID, (current) => {
            current.results.a = { ...current.results.a, status: "completed", output: "A" }
          }),
        ),
        Promise.resolve().then(() =>
          WorkflowStateStore.update(workflowID, (current) => {
            current.results.b = { ...current.results.b, status: "completed", output: "B" }
          }),
        ),
      ])

      expect(WorkflowStateStore.get(workflowID)?.results).toMatchObject({
        a: { status: "completed", output: "A" },
        b: { status: "completed", output: "B" },
      })
    } finally {
      WorkflowStateStore.delete(workflowID)
    }
  })
})

// ─── DAG Tests ───────────────────────────────────────────────

describe("orchestrate - topologicalSort", () => {
  test("sorts linear chain correctly", () => {
    const tasks = [
      { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
      { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
      { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["b"] },
    ]

    const sorted = topologicalSort(tasks)
    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"))
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"))
  })

  test("sorts diamond DAG correctly", () => {
    const tasks = [
      { id: "root", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
      { id: "left", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
      { id: "right", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
      { id: "merge", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["left", "right"] },
    ]

    const sorted = topologicalSort(tasks)
    expect(sorted.indexOf("root")).toBeLessThan(sorted.indexOf("left"))
    expect(sorted.indexOf("root")).toBeLessThan(sorted.indexOf("right"))
    expect(sorted.indexOf("left")).toBeLessThan(sorted.indexOf("merge"))
    expect(sorted.indexOf("right")).toBeLessThan(sorted.indexOf("merge"))
  })

  test("independent tasks can appear in any order", () => {
    const tasks = [
      { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
      { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
      { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
    ]

    const sorted = topologicalSort(tasks)
    expect(sorted).toHaveLength(3)
    expect(sorted).toContain("a")
    expect(sorted).toContain("b")
    expect(sorted).toContain("c")
  })

  test("detects circular dependency", () => {
    const tasks = [
      { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["b"] },
      { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
    ]

    expect(() => topologicalSort(tasks)).toThrow("Circular dependency")
  })

  test("detects self-referencing dependency", () => {
    const tasks = [{ id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] }]

    expect(() => topologicalSort(tasks)).toThrow("Circular dependency")
  })

  test("detects unknown dependency", () => {
    const tasks = [
      { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["nonexistent"] },
    ]

    expect(() => topologicalSort(tasks)).toThrow("unknown task")
  })
})

describe("orchestrate - getReadyTasks", () => {
  test("returns tasks with no dependencies", () => {
    const workflow = {
      id: "test",
      tasks: [
        { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
        { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
      ],
      results: {
        a: { status: "pending" as const },
        b: { status: "pending" as const },
      },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    const ready = getReadyTasks(workflow)
    expect(ready).toHaveLength(1)
    expect(ready[0].id).toBe("a")
  })

  test("returns dependent tasks when deps are completed", () => {
    const workflow = {
      id: "test",
      tasks: [
        { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
        { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
      ],
      results: {
        a: { status: "completed" as const },
        b: { status: "pending" as const },
      },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    const ready = getReadyTasks(workflow)
    expect(ready).toHaveLength(1)
    expect(ready[0].id).toBe("b")
  })

  test("returns multiple parallel-ready tasks", () => {
    const workflow = {
      id: "test",
      tasks: [
        { id: "root", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
        { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
        { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
      ],
      results: {
        root: { status: "completed" as const },
        b: { status: "pending" as const },
        c: { status: "pending" as const },
      },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    const ready = getReadyTasks(workflow)
    expect(ready).toHaveLength(2)
    expect(ready.map((t) => t.id).sort()).toEqual(["b", "c"])
  })

  test("does not return running tasks", () => {
    const workflow = {
      id: "test",
      tasks: [{ id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] }],
      results: {
        a: { status: "running" as const },
      },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    const ready = getReadyTasks(workflow)
    expect(ready).toHaveLength(0)
  })
})

describe("orchestrate - hasFailedDependency", () => {
  test("returns true when dependency failed", () => {
    const task = { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] }
    const workflow = {
      id: "test",
      tasks: [task],
      results: { a: { status: "failed" as const } },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    expect(hasFailedDependency(task, workflow)).toBe(true)
  })

  test("returns true when dependency was skipped", () => {
    const task = { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["b"] }
    const workflow = {
      id: "test",
      tasks: [task],
      results: { b: { status: "skipped" as const } },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    expect(hasFailedDependency(task, workflow)).toBe(true)
  })

  test("returns false when dependencies completed", () => {
    const task = { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] }
    const workflow = {
      id: "test",
      tasks: [task],
      results: { a: { status: "completed" as const } },
      status: "running" as const,
      createdAt: Date.now(),
      sessionMapKeys: [],
    }

    expect(hasFailedDependency(task, workflow)).toBe(false)
  })
})

describe("orchestrate - sub-agent model precedence", () => {
  const routed = { providerID: "router", modelID: "auto-model" }
  const configured = { providerID: "configured", modelID: "agent-model" }
  const explicit = { providerID: "explicit", modelID: "task-model" }

  test("an explicit task model wins", () => {
    expect(preferredModel(explicit, configured, routed)).toEqual(explicit)
  })

  test("an agent's configured model wins over routing", () => {
    expect(preferredModel(undefined, configured, routed)).toEqual(configured)
  })

  test("routing is used only when neither override exists", () => {
    expect(preferredModel(undefined, undefined, routed)).toEqual(routed)
  })

  test("pins a virtual AtomCLI alias to the real fallback-chain primary", () => {
    const requested = { providerID: "atomcli", modelID: "atomcli-auto" }
    const resolved = {
      options: {
        _fallbackChain: {
          primary: { providerID: "openai", modelID: "gpt-5-nano" },
        },
      },
    }

    expect(canonicalReference(requested, resolved)).toEqual({
      providerID: "openai",
      modelID: "gpt-5-nano",
    })
  })

  test("keeps a normal provider catalog key instead of its API/display id", () => {
    const requested = { providerID: "custom", modelID: "my-alias" }
    const resolved = { options: {}, id: "upstream-model-id" }

    expect(canonicalReference(requested, resolved)).toEqual(requested)
  })

  test("rejects a virtual alias without a real primary model", () => {
    expect(() => canonicalReference({ providerID: "atomcli", modelID: "atomcli-free" }, { options: {} })).toThrow(
      "did not resolve to a usable model",
    )
  })

  test("preserves a virtual AtomCLI reference after validating its current concrete model", () => {
    const requested = { providerID: "atomcli", modelID: "atomcli-free" }
    const canonical = { providerID: "openai", modelID: "gpt-5-nano" }

    expect(executionReference(requested, canonical)).toEqual(requested)
    expect(executionReference({ providerID: "custom", modelID: "alias" }, canonical)).toEqual(canonical)
  })
})

describe("orchestrate - agent collaboration context", () => {
  const tasks = [
    { id: "research", prompt: "", agent: "explore", category: "analysis" as TaskCategory, dependsOn: [] },
    { id: "design", prompt: "", agent: "plan", category: "analysis" as TaskCategory, dependsOn: ["research"] },
    { id: "build", prompt: "", agent: "coder", category: "coding" as TaskCategory, dependsOn: ["design"] },
  ]

  test("passes transitive upstream results to downstream agents", () => {
    expect(dependencyIds(tasks[2], tasks)).toEqual(["research", "design"])
    const context = buildDependencyContext(tasks[2], {
      id: "wf-context",
      tasks,
      results: {
        research: { status: "completed", output: "Found <unsafe> facts" },
        design: { status: "completed", output: "Use the selected design" },
        build: { status: "pending" },
      },
      status: "running",
      createdAt: Date.now(),
      sessionMapKeys: [],
    })

    expect(context).toContain('task="research" relation="upstream"')
    expect(context).toContain("Found &lt;unsafe&gt; facts")
    expect(context).toContain('task="design" relation="direct"')
  })

  test("passes typed dependency results as escaped JSON without parsing prose", () => {
    const context = buildDependencyContext(tasks[1], {
      id: "wf-typed-context",
      tasks,
      results: {
        research: {
          status: "completed",
          output: "Human prose that must not become the typed payload",
          structuredOutput: { decision: "use <safe> & typed", count: 2 },
        },
        design: { status: "pending" },
        build: { status: "pending" },
      },
      status: "running",
      createdAt: Date.now(),
      sessionMapKeys: [],
    })

    expect(context).toContain('<dependency_structured_result task="research" relation="direct">')
    expect(context).toContain("{&quot;decision&quot;:&quot;use &lt;safe&gt; &amp; typed&quot;,&quot;count&quot;:2}")
    expect(context).not.toContain("Human prose")
  })

  test("uses reviewer QA only for high-risk changed work", () => {
    expect(requiresTaskQA(tasks[0], 0)).toBe(false)
    expect(requiresTaskQA(tasks[0], 1, ["src/ui.ts"])).toBe(false)
    expect(requiresTaskQA(tasks[0], 1, ["src/auth/token.ts"], "standard", { auto: true })).toBe(true)
    expect(requiresTaskQA(tasks[0], 1, ["package.json"], "companion-fast")).toBe(false)
    expect(requiresTaskQA(tasks[0], 1, ["src/auth/token.ts"], "companion-fast", { auto: true })).toBe(true)
    expect(requiresTaskQA({ ...tasks[2], agent: "checker" }, 3, ["src/auth.ts"])).toBe(false)
    expect(requiresTaskQA({ ...tasks[2], agent: "reviewer" }, 3, ["src/auth.ts"])).toBe(false)
    expect(requiresTaskQA(tasks[0], 1, ["src/auth/token.ts"], "standard", { enabled: false })).toBe(false)
    expect(requiresTaskQA(tasks[0], 1, ["src/ui.ts"], "standard", { auto: true, policy: "always" })).toBe(true)
  })
})

// ─── Model Router Tests ──────────────────────────────────────

describe("model-router - scoreModel", () => {
  const baseModel = {
    id: "test-model",
    providerID: "test",
    api: { id: "test", url: "http://test", npm: "test" },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 3, cache: { read: 0.5, write: 1 } },
    limit: { context: 128000, output: 8192 },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "2025-01-01",
  }

  test("coding: scores higher with reasoning", () => {
    const withReasoning = { ...baseModel, capabilities: { ...baseModel.capabilities, reasoning: true } }
    const withoutReasoning = { ...baseModel }

    expect(scoreModel(withReasoning, "coding")).toBeGreaterThan(scoreModel(withoutReasoning, "coding"))
  })

  test("coding: requires toolcall", () => {
    const noToolcall = { ...baseModel, capabilities: { ...baseModel.capabilities, toolcall: false } }
    expect(scoreModel(noToolcall, "coding")).toBe(0)
  })

  test("documentation: higher context = higher score", () => {
    const longContext = { ...baseModel, limit: { ...baseModel.limit, context: 1000000 } }
    const shortContext = { ...baseModel, limit: { ...baseModel.limit, context: 32000 } }

    expect(scoreModel(longContext, "documentation")).toBeGreaterThan(scoreModel(shortContext, "documentation"))
  })

  test("analysis: reasoning is heavily weighted", () => {
    const withReasoning = { ...baseModel, capabilities: { ...baseModel.capabilities, reasoning: true } }
    const withoutReasoning = { ...baseModel }

    const diff = scoreModel(withReasoning, "analysis") - scoreModel(withoutReasoning, "analysis")
    expect(diff).toBeGreaterThanOrEqual(60)
  })

  test("general: balanced scoring", () => {
    const score = scoreModel(baseModel, "general")
    expect(score).toBeGreaterThan(0)
  })
})

describe("model-router - inferCategory", () => {
  test("detects coding prompts", () => {
    expect(inferCategory("Implement a new REST API endpoint")).toBe("coding")
    expect(inferCategory("Fix the bug in user service")).toBe("coding")
    expect(inferCategory("Write a function to parse JSON")).toBe("coding")
  })

  test("detects documentation prompts", () => {
    expect(inferCategory("Write a README guide for this project")).toBe("documentation")
    expect(inferCategory("Create a tutorial explaining setup")).toBe("documentation")
  })

  test("detects analysis prompts", () => {
    expect(inferCategory("Analyze the performance of this system")).toBe("analysis")
    expect(inferCategory("Review and evaluate the architecture")).toBe("analysis")
  })

  test("falls back to general", () => {
    expect(inferCategory("hello world")).toBe("general")
    expect(inferCategory("do something")).toBe("general")
  })

  test("detects Turkish coding keywords", () => {
    expect(inferCategory("Yeni bir fonksiyon yaz")).toBe("coding")
    expect(inferCategory("Bu hatayı düzelt")).toBe("coding")
  })

  test("detects Turkish doc keywords", () => {
    expect(inferCategory("Proje dokümanı hazırla")).toBe("documentation")
  })
})
