import fs from "fs/promises"
import path from "path"
import { Instance } from "@/services/project/instance"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Lock } from "@/util/util/lock"
import { TaskVerification } from "@/core/execution/task-verification"
import { BashTool } from "../bash"
import type { Tool } from "../tool"
import { WorkflowStateStore } from "./state"
import {
  checkpoint,
  findWorkflow,
  claimWorkflowExecution,
  releaseWorkflowExecution,
  resolveAcceptedTaskChildren,
} from "./lifecycle"
import { activeOwnershipRoot, normalizeOwnership } from "./ownership"
import type { RecoverySchema } from "./schema"

const MAX_RECOVERY_BYTES = 50 * 1024 * 1024

type RecoveryInput = typeof RecoverySchema._output

export namespace WorkflowRecovery {
  export async function recover(
    workflowId: string | undefined,
    recovery: RecoveryInput | undefined,
    ctx: Tool.Context,
  ) {
    if (!workflowId || !recovery) throw new Error("workflowId and recovery are required")
    const workflow = await findWorkflow(workflowId)
    if (!workflow || workflow.parentSessionID !== ctx.sessionID)
      throw new Error("Workflow is missing or belongs to another session")
    if (workflow.atomicRootID) throw new Error("Atomic Work requires its own revision/verification flow")
    const task = workflow.tasks.find((item) => item.id === recovery.taskId)
    const result = workflow.results[recovery.taskId]
    if (!task || !result || (result.status !== "failed" && !result.recovery))
      throw new Error("Only a failed task or interrupted recovery can be recovered")
    const execution = ctx.extra?.execution as ExecutionRuntime.Context | undefined
    if (
      !execution ||
      execution.rootSessionID !== ctx.sessionID ||
      workflow.activeExecution?.executionID !== execution.executionID
    )
      throw new Error("Recovery requires the active root execution fence")
    const token = claimWorkflowExecution(workflow.id)
    if (!token) throw new Error("Workflow execution is still active; await its termination")
    try {
      using _lock = await Lock.write(`execution-tasks:${execution.executionID}`)
      const taskID = `workflow:${workflow.id}:${task.id}`
      let durable = await ExecutionRuntime.getTask({ sessionID: ctx.sessionID, execution, taskID })
      if (!durable || durable.version !== recovery.expectedVersion || durable.revision !== recovery.expectedRevision)
        throw new Error("Task revision/version changed; inspect status for fresh recovery metadata")
      if (!["failed", "running", "submitted", "verifying", "needs_revision", "accepted"].includes(durable.status))
        throw new Error(`Task cannot be recovered from ${durable.status}`)
      if (durable.acceptance.some((item) => item.verification !== "automatic"))
        throw new Error("Recovery cannot replace parent/reviewer acceptance criteria; use the task verification flow")
      const commands = durable.acceptance.length
        ? durable.acceptance.map((criterion) => ({ criterionID: criterion.id, command: criterion.command! }))
        : [{ criterionID: "recovery", command: recovery.verificationCommand }]
      if (commands.some((check) => !check.command))
        throw new Error("Recovery requires an executable verification command")

      const root = await fs.realpath(activeOwnershipRoot())
      const artifacts = recovery.artifacts.map((file) => normalizeOwnership(file, root))
      const resolveArtifact = async (file: string) => {
        const real = await fs.realpath(path.join(root, file))
        if (!real.startsWith(`${root}${path.sep}`))
          throw new Error("Recovery artifact leaves the workspace through a symlink")
        const resolved = normalizeOwnership(real, root)
        if (
          task.owns?.length &&
          !task.owns.some((owned) => owned === "" || resolved === owned || resolved.startsWith(`${owned}/`))
        )
          throw new Error("Recovery artifact is outside task ownership")
        return { file, real, resolved }
      }
      if (
        task.owns?.length &&
        artifacts.some(
          (file) => !task.owns!.some((owned) => owned === "" || file === owned || file.startsWith(`${owned}/`)),
        )
      )
        throw new Error("Recovery artifact is outside task ownership")
      const resolvedArtifacts = await Promise.all(artifacts.map(resolveArtifact))
      await ctx.ask({
        permission: "read",
        patterns: [...new Set(resolvedArtifacts.flatMap(({ file, resolved }) => [file, resolved]))].map((file) =>
          path.join(root, file),
        ),
        always: ["*"],
        metadata: { description: `Recovery artifacts for ${task.id}` },
      })
      const snapshot = async () => {
        let bytes = 0
        const hash = new Bun.CryptoHasher("sha256")
        for (const [index, file] of artifacts.entries()) {
          const { real } = await resolveArtifact(file)
          if (real !== resolvedArtifacts[index].real)
            throw new Error("Recovery artifact target changed; rerun verification against current files")
          const stat = await fs.stat(real)
          if (!stat.isFile() || (bytes += stat.size) > MAX_RECOVERY_BYTES)
            throw new Error("Recovery artifacts must be files totaling at most 50 MiB")
          hash.update(JSON.stringify([file, stat.size]))
          hash.update(await fs.readFile(real))
        }
        return hash.digest("hex")
      }
      const digest = await snapshot()
      await TaskVerification.assertStaticChecks(
        resolvedArtifacts.map(({ real }) => real),
        root,
        ctx.sessionID,
      )
      const mutationRevision = ExecutionRuntime.mutationRevision(execution.executionID)
      const bash = await BashTool.init()
      const automaticChecks = []
      for (const check of commands) {
        ctx.abort.throwIfAborted()
        await ExecutionRuntime.assertActive({ sessionID: ctx.sessionID, execution })
        const verified = await bash.execute(
          { command: check.command!, workdir: root, timeout: 120_000, description: `Verify recovered task ${task.id}` },
          ctx,
        )
        if (verified.metadata.exit !== 0)
          throw new Error(`Recovery verification failed: ${check.command}\n${verified.output}`)
        automaticChecks.push({
          ...check,
          command: check.command!,
          exitCode: verified.metadata.exit,
          evidence: verified.output.slice(0, 10_000) || "No output",
        })
      }
      ctx.abort.throwIfAborted()
      await ExecutionRuntime.assertActive({ sessionID: ctx.sessionID, execution })
      if (
        digest !== (await snapshot()) ||
        mutationRevision !== ExecutionRuntime.mutationRevision(execution.executionID)
      )
        throw new Error("Artifacts changed during recovery verification; rerun checks against the current files")
      const evidence = JSON.stringify({
        workflowId,
        taskID,
        revision: durable.revision,
        artifacts,
        digest,
        automaticChecks,
      })
      if (evidence.length > 16_000) throw new Error("Recovery evidence exceeds 16000 characters")
      if (["failed", "needs_revision"].includes(durable.status))
        durable = await ExecutionRuntime.transitionTask({
          sessionID: ctx.sessionID,
          execution,
          taskID,
          expectedVersion: durable.version,
          status: "running",
          evidence,
        })
      if (durable.status === "running")
        durable = await ExecutionRuntime.transitionTask({
          sessionID: ctx.sessionID,
          execution,
          taskID,
          expectedVersion: durable.version,
          status: "submitted",
          evidence,
        })
      if (["submitted", "verifying"].includes(durable.status))
        durable = await ExecutionRuntime.recordTaskVerification({
          sessionID: ctx.sessionID,
          execution,
          taskID,
          expectedVersion: durable.version,
          checks: [],
          automaticChecks: durable.acceptance.length ? automaticChecks : [],
        })
      if (durable.status !== "accepted") throw new Error("Original task acceptance checks did not pass")
      await resolveAcceptedTaskChildren(workflow, task.id, ctx, execution)
      const tasks = ExecutionRuntime.tasks(execution.executionID)
      const completed = workflow.tasks.every(
        (item) => tasks.find((entry) => entry.id === `workflow:${workflow.id}:${item.id}`)?.status === "accepted",
      )
      if (completed) {
        const blocker = ExecutionRuntime.blocker(workflow.activeExecution!.blockerID)!
        await ExecutionRuntime.transitionBlocker({
          sessionID: ctx.sessionID,
          execution,
          blockerID: blocker.id,
          expectedVersion: blocker.version,
          state: "resolved",
          evidence,
          resolutionCode: "verified_alternative_completion",
        })
      }
      WorkflowStateStore.update(workflow.id, (state) => {
        state.results[task.id] = {
          ...state.results[task.id],
          status: "completed",
          completedAt: Date.now(),
          error: undefined,
          recovery: {
            previousError: result.recovery?.previousError ?? result.error,
            evidence,
            recoveredAt: Date.now(),
          },
        }
        state.status = completed ? "completed" : "failed"
      })
      await checkpoint(workflow.id)
      return {
        title: "Workflow task recovered",
        output: `${task.id} accepted from verified artifacts; failed invocation history retained`,
        metadata: { error: false, workflowId, taskId: task.id, status: "accepted" },
      }
    } finally {
      releaseWorkflowExecution(workflow.id, token)
    }
  }
}
