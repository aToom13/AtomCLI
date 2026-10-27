import "../preload"
import { expect, spyOn, test } from "bun:test"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { WorkflowStore } from "@/core/orchestration/workflow-store"
import { WorkflowStateStore, type WorkflowState } from "@/integrations/tool/orchestrate/state"
import { durableTaskResult, findWorkflow } from "@/integrations/tool/orchestrate/lifecycle"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("conservative scheduler states retain distinct ledger state and recovery reason", () => {
  for (const status of ["submitted", "verifying", "blocked", "running"] as const) {
    const result = durableTaskResult({ status, evidence: ["Provider unavailable"] } as any)
    expect(result.status).toBe("unknown")
    expect(result.ledgerState.status).toBe(status)
    expect(result.ledgerState.reason).toBeTruthy()
  }
})

test("reload repairs stale workflow success from ledger evidence, then follows acceptance", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const workflow: WorkflowState = {
        id: "projection-test",
        tasks: [{ id: "worker", prompt: "Inspect", agent: "explore", category: "analysis", dependsOn: [] }],
        results: { worker: { status: "completed", output: "Worker says done" } },
        status: "completed",
        createdAt: Date.now(),
        sessionMapKeys: [],
        activeExecution: { executionID: "execution", blockerID: "blocker" },
      }
      await WorkflowStore.save(workflow)
      const durable = {
        id: "workflow:projection-test:worker",
        status: "submitted",
        evidence: ["Submitted output"],
        executionID: "execution",
      } as any
      const tasks = spyOn(ExecutionRuntime, "tasks").mockImplementation(() => [durable])
      try {
        const loaded = await findWorkflow(workflow.id)
        expect(loaded?.results.worker.status).toBe("unknown")
        expect(loaded?.status).toBe("resumable")
        expect((await WorkflowStore.load<WorkflowState>(workflow.id))?.results.worker.status).toBe("unknown")
        durable.status = "accepted"
        expect((await findWorkflow(workflow.id))?.status).toBe("completed")
        durable.status = "needs_revision"
        expect((await findWorkflow(workflow.id))?.results.worker).toEqual({
          status: "pending",
          ledgerState: { status: "needs_revision", reason: "Submitted output" },
        })
        durable.status = "failed"
        expect((await findWorkflow(workflow.id))?.results.worker.status).toBe("failed")
      } finally {
        tasks.mockRestore()
        WorkflowStateStore.delete(workflow.id)
      }
    },
  })
})
