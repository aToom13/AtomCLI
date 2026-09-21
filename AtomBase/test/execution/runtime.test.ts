import path from "path"
import { describe, expect, test } from "bun:test"
import "../preload"
import { Bus } from "@/core/bus"
import { Config } from "@/core/config/config"
import { ExecutionLedger } from "@/core/execution/ledger"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { Global } from "@/core/global"
import { Identifier } from "@/core/id/id"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Session } from "@/core/session"
import { Instance } from "@/services/project/instance"
import type { Provider } from "@/integrations/provider/provider"
import { tmpdir } from "../fixture/fixture"

async function addUserMessage(sessionID: string, text: string) {
  const messageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: messageID,
    sessionID,
    role: "user",
    agent: "build",
    model: { providerID: "test", modelID: "fixture" },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID,
    sessionID,
    type: "text",
    text,
  })
  return messageID
}

describe("ExecutionRuntime", () => {
  test("classifies budget, cancellation and provider failures without exposing raw errors", () => {
    expect(ExecutionRuntime.classifyTerminalFailure(new ExecutionRuntime.BudgetExceededError("cost_limit"))).toEqual({
      outcome: "budget_exhausted",
      reasonCode: "cost_limit",
      reasonMessage: "The execution reached its configured cost limit.",
      retryable: false,
    })
    expect(ExecutionRuntime.classifyTerminalFailure(new Error("private token=secret"), true)).toMatchObject({
      outcome: "cancelled",
      reasonCode: "user_cancelled",
    })
    const provider = ExecutionRuntime.classifyTerminalFailure(new Error("private token=secret"))
    expect(provider).toMatchObject({ outcome: "failed", reasonCode: "provider_unavailable" })
    expect(provider.reasonMessage).not.toContain("secret")
    expect(
      ExecutionRuntime.classifyTerminalFailure(
        new ExecutionRuntime.BudgetExceededError("recovery_required", "exec-1", "tool:bash:op-1 must be reconciled"),
      ),
    ).toEqual({
      outcome: "failed",
      reasonCode: "recovery_required",
      reasonMessage: "tool:bash:op-1 must be reconciled",
      retryable: true,
    })
    expect(
      ExecutionRuntime.classifyTerminalFailure(new ExecutionRuntime.BudgetExceededError("recovery_required", "exec-1")),
    ).toEqual({
      outcome: "failed",
      reasonCode: "recovery_required",
      reasonMessage: "The session has unknown mutating work that must be reconciled.",
      retryable: true,
    })
    const recoveryError = new ExecutionRuntime.BudgetExceededError(
      "recovery_required",
      "exec-1",
      "tool:bash:op-1 must be reconciled",
    )
    expect(recoveryError.message).toBe("Execution recovery required: tool:bash:op-1 must be reconciled")
    const defaultRecoveryError = new ExecutionRuntime.BudgetExceededError("recovery_required", "exec-1")
    expect(defaultRecoveryError.message).toBe("Execution recovery required: previous mutating work must be reconciled")
  })

  test("does not treat catalog zero-fill as verified free pricing", () => {
    const model = {
      cost: { input: 0, output: 0 },
      options: { _catalogCostKnown: false },
    } as unknown as Provider.Model
    expect(ExecutionRuntime.estimateMicrousd(model, "hello", 100)).toBeUndefined()
  })

  test("does not create an execution policy while recording unclassified tool activity", () => {
    const executionID = `unclassified-${Date.now()}`

    ExecutionRuntime.admitToolCall(executionID, { filesRead: ["README.md"] })
    ExecutionRuntime.recordRuntimeEvidence(executionID, {
      filesRead: ["README.md"],
      successfulToolCalls: 1,
    })

    expect(ExecutionRuntime.getExecutionContract(executionID)).toBeUndefined()
    expect(ExecutionRuntime.getExecutionPolicy(executionID)).toBeUndefined()
  })

  test("shares the root call budget with child sessions", async () => {
    await using tmp = await tmpdir({
      config: { execution_budget: { max_calls: 1, unknown_price: "block" } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })
        await addUserMessage(root.id, "root task")

        const first = await ExecutionRuntime.admitModelCall({
          sessionID: root.id,
          purpose: "main",
          estimateMicrousd: 0,
        })
        first?.settle(0)
        await expect(
          ExecutionRuntime.admitModelCall({ sessionID: child.id, purpose: "child", estimateMicrousd: 0 }),
        ).rejects.toMatchObject({ name: "ExecutionBudgetExceededError", reason: "call_limit" })
      },
    })
  })

  test("starts a fresh execution for a new explicit root user turn", async () => {
    await using tmp = await tmpdir({
      config: { execution_budget: { max_calls: 1, unknown_price: "block" } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        await addUserMessage(root.id, "first task")
        const first = await ExecutionRuntime.admitModelCall({
          sessionID: root.id,
          purpose: "main",
          estimateMicrousd: 0,
        })
        first?.settle(0)

        await addUserMessage(root.id, "second task")
        const second = await ExecutionRuntime.admitModelCall({
          sessionID: root.id,
          purpose: "main",
          estimateMicrousd: 0,
        })
        expect(second?.executionID).not.toBe(first?.executionID)
        second?.settle(0)
      },
    })
  })

  test("continues the session execution when a fresh root turn answers waiting input", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const firstUser = await addUserMessage(root.id, "implement the durable task")
        const first = await ExecutionRuntime.resolveInvocation({
          sessionID: root.id,
          invocationID: firstUser,
          kind: "root",
        })
        const policy = ExecutionRuntime.setExecutionContract(
          first.executionID,
          ExecutionContract.fallback("waiting-input-test"),
        )
        ExecutionRuntime.recordObjective(first.executionID, firstUser, "Implement the durable task")
        await ExecutionRuntime.createPlan({
          sessionID: root.id,
          execution: first,
          items: [{ id: "implement", resourceScope: "plan-item:implement" }],
        })
        await ExecutionRuntime.waitForInput({
          sessionID: root.id,
          execution: first,
          reason: "credentials required",
        })

        const secondUser = await addUserMessage(root.id, "use these credentials")
        const continued = await ExecutionRuntime.resolveInvocation({
          sessionID: root.id,
          invocationID: secondUser,
          kind: "root",
        })

        expect(continued.executionID).toBe(first.executionID)
        expect(continued.invocationID).toBe(secondUser)
        expect(ExecutionRuntime.view(first.executionID)).toMatchObject({ lifecycle: "active", phase: "model" })
        expect(ExecutionRuntime.objective(first.executionID)).toMatchObject({
          message_id: firstUser,
          objective: "Implement the durable task",
        })
        expect(ExecutionRuntime.getExecutionPolicy(first.executionID)).toEqual(policy)
        expect(ExecutionRuntime.taskflowPlan(first.executionID, root.id)).toEqual([
          expect.objectContaining({ producerID: "1:implement", state: "pending" }),
        ])
        expect(ExecutionRuntime.snapshot(root.id).activeInvocations).toEqual([
          expect.objectContaining({ id: secondUser, executionID: first.executionID, state: "running" }),
        ])
        expect(ExecutionRuntime.view(`${root.id}:${secondUser}`)).toBeUndefined()
      },
    })
  })

  test("keeps an in-flight child invocation on its original execution when the root receives a new turn", async () => {
    await using tmp = await tmpdir({ config: { execution_budget: { max_calls: 3, unknown_price: "block" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })
        const firstUser = await addUserMessage(root.id, "first root task")
        const first = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: firstUser })
        await ExecutionRuntime.inheritSession(root.id, child.id)
        const childUser = await addUserMessage(child.id, "child work")
        const childInvocation = await ExecutionRuntime.resolveInvocation({
          sessionID: child.id,
          invocationID: childUser,
        })

        const secondUser = await addUserMessage(root.id, "queued second root task")
        const second = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: secondUser })

        expect(childInvocation.executionID).toBe(first.executionID)
        expect(second.executionID).not.toBe(first.executionID)
        const attempt = await ExecutionRuntime.admitModelCall({
          sessionID: child.id,
          purpose: "child-after-root-update",
          estimateMicrousd: 0,
          execution: childInvocation,
        })
        expect(attempt?.executionID).toBe(first.executionID)
        attempt?.settle(0)
      },
    })
  })

  test("atomically replaces an active invocation when a reviewer session is reused", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const reviewer = await Session.create({ parentID: root.id })
        const rootUser = await addUserMessage(root.id, "review this change")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: rootUser })
        await ExecutionRuntime.inheritSession(root.id, reviewer.id)
        const firstUser = await addUserMessage(reviewer.id, "first review")
        const first = await ExecutionRuntime.resolveInvocation({
          sessionID: reviewer.id,
          invocationID: firstUser,
          kind: "reviewer",
        })
        const secondUser = await addUserMessage(reviewer.id, "retry review")

        const second = await ExecutionRuntime.resolveInvocation({
          sessionID: reviewer.id,
          invocationID: secondUser,
          kind: "reviewer",
        })

        expect(second.executionID).toBe(execution.executionID)
        expect(ExecutionRuntime.snapshot(root.id).activeInvocations).toContainEqual(
          expect.objectContaining({ id: secondUser, sessionID: reviewer.id, kind: "reviewer", state: "running" }),
        )
        expect(ExecutionRuntime.snapshot(root.id).activeInvocations).not.toContainEqual(
          expect.objectContaining({ id: first.invocationID }),
        )
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("blocks unknown prices when a monetary limit is configured", async () => {
    await using tmp = await tmpdir({
      config: { execution_budget: { max_cost_usd: 1, unknown_price: "block" } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        await addUserMessage(root.id, "priced task")
        await expect(ExecutionRuntime.admitModelCall({ sessionID: root.id, purpose: "main" })).rejects.toMatchObject({
          name: "ExecutionBudgetExceededError",
          reason: "unknown_price",
        })
      },
    })
  })

  test("reports unpriced calls explicitly in the public execution view", async () => {
    await using tmp = await tmpdir({ config: { execution_budget: { max_calls: 2, unknown_price: "allow" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "unpriced task")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const attempt = await ExecutionRuntime.admitModelCall({
          sessionID: root.id,
          purpose: "main",
          execution,
        })
        const view = ExecutionRuntime.view(execution.executionID)
        expect(view).toMatchObject({
          id: execution.executionID,
          rootSessionID: root.id,
          rootInvocationID: userID,
          userMessageID: userID,
          sessionGeneration: 1,
          turnSequence: 1,
          budget: {
            execution: { calls: { used: 1, limit: 2 }, unpricedCalls: 1 },
            rootSession: { unpricedCalls: 1 },
            project: { unpricedCalls: 1 },
          },
        })
        attempt?.settle(0)
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("shares the step budget and keeps duplicate claims idempotent", async () => {
    await using tmp = await tmpdir({
      config: { execution_budget: { max_steps: 1, unknown_price: "block" } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })
        await addUserMessage(root.id, "bounded task")
        await ExecutionRuntime.admitStep({ sessionID: root.id, stepID: "root-step" })
        await ExecutionRuntime.admitStep({ sessionID: root.id, stepID: "root-step" })
        await expect(ExecutionRuntime.admitStep({ sessionID: child.id, stepID: "child-step" })).rejects.toMatchObject({
          name: "ExecutionBudgetExceededError",
          reason: "step_limit",
        })
      },
    })
  })

  test("round-trips and commits a private completion candidate", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "finish this task")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          messageID: "message-private",
          finish: "stop",
          parts: [
            {
              id: "part-private",
              messageID: "message-private",
              sessionID: root.id,
              type: "text",
              text: "private candidate",
            },
          ],
          editedFiles: ["src/index.ts"],
          requiresReview: true,
          execution,
        })
        expect(staged).toMatchObject({ state: "staged", editedFiles: ["src/index.ts"] })
        expect(ExecutionRuntime.completion(execution.executionID)).toMatchObject({
          state: "staged",
          parts: [{ text: "private candidate" }],
        })
        await expect(
          ExecutionRuntime.commitCompletion({ sessionID: root.id, execution, digest: staged.digest }),
        ).rejects.toMatchObject({ reason: "review_required" })
        const review = await ExecutionRuntime.claimReview({
          sessionID: root.id,
          execution,
          digest: staged.digest,
          revision: staged.revision,
        })
        await ExecutionRuntime.recordReview({
          sessionID: root.id,
          execution,
          reviewID: review.id,
          state: "passed",
        })
        const committed = await ExecutionRuntime.commitCompletion({
          sessionID: root.id,
          execution,
          digest: staged.digest,
        })
        expect(committed.state).toBe("committed")
      },
    })
  })

  test("projects only the safe delivery payload when review terminates the execution as blocked", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "review this sensitive task")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          messageID: "message-runtime-blocked",
          finish: "stop",
          parts: [
            {
              id: "part-runtime-private",
              messageID: "message-runtime-blocked",
              sessionID: root.id,
              type: "text",
              text: "private answer that did not pass review",
            },
          ],
          editedFiles: ["src/security.ts"],
          requiresReview: true,
          execution,
        })
        const claim = await ExecutionRuntime.claimReview({
          sessionID: root.id,
          execution,
          digest: staged.digest,
          revision: staged.revision,
        })
        await ExecutionRuntime.recordReview({
          sessionID: root.id,
          execution,
          reviewID: claim.id,
          state: "inconclusive",
        })
        const blocked = await ExecutionRuntime.finalizeBlocked({
          sessionID: root.id,
          execution,
          digest: staged.digest,
          parts: [
            {
              id: "part-runtime-private",
              messageID: "message-runtime-blocked",
              sessionID: root.id,
              type: "text",
              text: "Completion blocked because independent review was unavailable.",
              synthetic: true,
            },
          ],
          reasonCode: "review_unavailable",
          reasonMessage: "Independent review was unavailable.",
        })

        expect(blocked).toMatchObject({
          state: "committed",
          outcome: "blocked",
          finish: "error",
          requiresReview: true,
          parts: [{ text: "Completion blocked because independent review was unavailable." }],
        })
        expect(ExecutionRuntime.execution(execution.executionID)).toMatchObject({
          lifecycle: "terminal",
          phase: "idle",
          outcome: "blocked",
          reason: { code: "review_unavailable" },
        })
        await expect(
          ExecutionRuntime.commitCompletion({ sessionID: root.id, execution, digest: staged.digest }),
        ).rejects.toMatchObject({ reason: "not_active" })
      },
    })
  })

  test("binds a synthetic continuation to the existing execution across resolution", async () => {
    await using tmp = await tmpdir({ config: { execution_budget: { max_calls: 1, unknown_price: "block" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "implement the task")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const first = await ExecutionRuntime.admitModelCall({
          sessionID: root.id,
          purpose: "main",
          estimateMicrousd: 0,
          execution,
        })
        first?.settle(0)

        const retryID = await addUserMessage(root.id, "synthetic review retry")
        await ExecutionRuntime.bindContinuation({ sessionID: root.id, invocationID: retryID, execution })
        const recovered = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: retryID })
        expect(recovered.executionID).toBe(execution.executionID)
        expect(ExecutionRuntime.snapshot(root.id).activeInvocations).toEqual([
          expect.objectContaining({ id: retryID, executionID: execution.executionID, state: "running" }),
        ])
        await expect(
          ExecutionRuntime.admitModelCall({
            sessionID: root.id,
            purpose: "retry",
            estimateMicrousd: 0,
            execution: recovered,
          }),
        ).rejects.toMatchObject({ reason: "call_limit", executionID: execution.executionID })
      },
    })
  })

  test("aborts the execution lease signal when persistent cancellation wins", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "cancel this task")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const release = ExecutionRuntime.holdLease(execution)
        const signal = ExecutionRuntime.leaseSignal(execution)

        expect(signal.aborted).toBe(false)
        expect(ExecutionRuntime.cancelSession(root.id)).toBe(true)
        expect(signal.aborted).toBe(true)
        expect(signal.reason).toMatchObject({ name: "ExecutionBudgetExceededError", reason: "not_active" })
        release()
      },
    })
  })

  test("an exact cancellation cannot cancel a newer invocation in the same session", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const firstUserID = await addUserMessage(root.id, "first task")
        const first = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: firstUserID })
        const secondUserID = await addUserMessage(root.id, "second task")
        const second = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: secondUserID })

        expect(second.executionID).not.toBe(first.executionID)
        expect(ExecutionRuntime.cancelExecution(first)).toBe(true)
        await expect(ExecutionRuntime.assertActive({ sessionID: root.id, execution: second })).resolves.toBeUndefined()
      },
    })
  })

  test("cancelling a child invocation leaves its root and sibling invocation active", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const childA = await Session.create({ parentID: root.id })
        const childB = await Session.create({ parentID: root.id })
        const rootUser = await addUserMessage(root.id, "root task")
        const rootExecution = await ExecutionRuntime.resolveInvocation({
          sessionID: root.id,
          invocationID: rootUser,
          kind: "root",
        })
        await ExecutionRuntime.inheritSession(root.id, childA.id)
        await ExecutionRuntime.inheritSession(root.id, childB.id)
        const childAUser = await addUserMessage(childA.id, "child A")
        const childBUser = await addUserMessage(childB.id, "child B")
        const childAExecution = await ExecutionRuntime.resolveInvocation({
          sessionID: childA.id,
          invocationID: childAUser,
          kind: "child",
        })
        const childBExecution = await ExecutionRuntime.resolveInvocation({
          sessionID: childB.id,
          invocationID: childBUser,
          kind: "child",
        })

        expect(ExecutionRuntime.cancelInvocation(childAExecution)).toBe(true)
        await expect(
          ExecutionRuntime.assertActive({ sessionID: childA.id, execution: childAExecution }),
        ).rejects.toMatchObject({ reason: "not_active" })
        await expect(
          ExecutionRuntime.assertActive({ sessionID: childB.id, execution: childBExecution }),
        ).resolves.toBeUndefined()
        await expect(
          ExecutionRuntime.assertActive({ sessionID: root.id, execution: rootExecution }),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("aborts a held execution signal at the absolute deadline", async () => {
    await using tmp = await tmpdir({
      config: { execution_budget: { max_duration_ms: 30, unknown_price: "block" } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "deadline task")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const release = ExecutionRuntime.holdLease(execution)
        const signal = ExecutionRuntime.leaseSignal(execution)
        expect(signal.aborted).toBe(false)
        await Bun.sleep(60)
        expect(signal.aborted).toBe(true)
        expect(signal.reason).toMatchObject({ reason: "deadline", executionID: execution.executionID })
        release()
      },
    })
  })

  test("finds an unprojected committed completion after a newer root turn starts", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const firstUserID = await addUserMessage(root.id, "first task")
        const first = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: firstUserID })
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          messageID: "message-first-completion",
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: false,
          execution: first,
        })
        await ExecutionRuntime.commitCompletion({ sessionID: root.id, execution: first, digest: staged.digest })

        const secondUserID = await addUserMessage(root.id, "second task")
        const second = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: secondUserID })

        expect(second.executionID).not.toBe(first.executionID)
        expect(ExecutionRuntime.pendingCompletions(root.id)).toEqual([
          expect.objectContaining({ executionID: first.executionID, digest: staged.digest }),
        ])
        const claim = ExecutionRuntime.claimCompletion(root.id, first.executionID)
        expect(claim).toBeDefined()
        expect(ExecutionRuntime.ackCompletion(claim!)).toEqual({
          projected: true,
          idempotent: false,
        })
        expect(ExecutionRuntime.pendingCompletions(root.id)).toEqual([])
      },
    })
  })

  test("persists a failed terminal outcome and its projection event", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "fail this request")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const assistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: assistantID,
          parentID: userID,
          sessionID: root.id,
          role: "assistant",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "fixture",
          providerID: "test",
          time: { created: Date.now() },
          error: { name: "UnknownError", data: { message: "local failure" } },
        })
        const completion = ExecutionRuntime.finalizeOutcome({
          sessionID: root.id,
          messageID: assistantID,
          execution,
          failure: ExecutionRuntime.classifyTerminalFailure(new Error("provider secret detail")),
        })
        expect(completion).toMatchObject({ outcome: "failed", projection: "pending", finish: "error" })
        expect(ExecutionRuntime.execution(execution.executionID)).toMatchObject({
          lifecycle: "terminal",
          outcome: "failed",
          reason: { code: "provider_unavailable", retryable: true },
        })
        expect(ExecutionRuntime.events(root.id).items.at(-1)).toEqual(
          expect.objectContaining({ executionID: execution.executionID, type: "execution.updated" }),
        )
      },
    })
  })

  test("aborts the shared signal when another owner takes over an expired lease", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "lose this lease")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const release = ExecutionRuntime.holdLease(execution)
        const signal = ExecutionRuntime.leaseSignal(execution)
        const competing = ExecutionLedger.open(path.join(Global.Path.data, "execution-ledger.sqlite"))

        expect(
          competing.claimOwner({
            executionID: execution.executionID,
            ownerID: "competing-owner",
            leaseMs: 30_000,
            now: Date.now() + 31_000,
          }),
        ).toMatchObject({ acquired: true, fence: execution.fence + 1 })
        expect(ExecutionRuntime.renewLease(execution)).toBe(false)
        expect(signal.aborted).toBe(true)
        expect(signal.reason).toMatchObject({ name: "ExecutionBudgetExceededError", reason: "stale_fence" })

        competing.close()
        release()
      },
    })
  })

  test("cleans up a held execution lease when its project instance is disposed", async () => {
    await using tmp = await tmpdir({ config: {} })
    let signal: AbortSignal | undefined
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "dispose this project")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        ExecutionRuntime.holdLease(execution)
        signal = ExecutionRuntime.leaseSignal(execution)
        await Instance.dispose()
      },
    })
    expect(signal?.aborted).toBe(true)
    expect(signal?.reason).toMatchObject({ name: "ExecutionBudgetExceededError", reason: "not_active" })
  })

  test("rejects oversized persisted review evidence before staging", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "large evidence")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        await expect(
          ExecutionRuntime.stageCompletion({
            sessionID: root.id,
            messageID: "message-private-large-evidence",
            finish: "stop",
            parts: [],
            editedFiles: Array.from({ length: 1_000 }, (_, index) => `${index}-${"x".repeat(600)}`),
            requiresReview: true,
            execution,
          }),
        ).rejects.toThrow("Completion review evidence exceeds")
        expect(ExecutionRuntime.completion(execution.executionID)).toBeUndefined()
      },
    })
  })

  test("registers and CAS-transitions a workflow blocker through the execution context", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "run workflow")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const blockerID = `workflow:${execution.executionID}:wf-test`
        const pending = await ExecutionRuntime.registerBlocker({
          sessionID: root.id,
          execution,
          blockerID,
          kind: "workflow",
          producerID: "wf-test",
          resourceScope: "workflow:wf-test",
        })
        expect(pending).toMatchObject({ state: "pending", version: 1, invocationID: execution.invocationID })

        const running = await ExecutionRuntime.transitionBlocker({
          sessionID: root.id,
          execution,
          blockerID,
          expectedVersion: pending.version,
          state: "running",
        })
        expect(running).toMatchObject({ state: "running", version: 2 })
        await expect(
          ExecutionRuntime.transitionBlocker({
            sessionID: root.id,
            execution,
            blockerID,
            expectedVersion: pending.version,
            state: "resolved",
            evidence: "completed",
            resolutionCode: "workflow_completed",
          }),
        ).rejects.toMatchObject({ reason: "stale_version" })

        const resolved = await ExecutionRuntime.transitionBlocker({
          sessionID: root.id,
          execution,
          blockerID,
          expectedVersion: running.version,
          state: "resolved",
          evidence: "all workflow tasks completed",
          resolutionCode: "workflow_completed",
        })
        expect(resolved).toMatchObject({ state: "resolved", version: 3 })
      },
    })
  })

  test("rejects success when a reviewed file changes after the candidate snapshot", async () => {
    await using tmp = await tmpdir({
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 2,
          max_attempts: 3,
          high_risk_patterns: [],
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "snapshot this change")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        await Bun.write(path.join(tmp.path, "tracked.txt"), "before")
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          messageID: "message-content-snapshot",
          finish: "stop",
          parts: [],
          editedFiles: ["tracked.txt"],
          requiresReview: false,
          execution,
        })
        expect(staged).toMatchObject({
          reviewRequirement: "not_required",
          reviewReasonCode: "legacy_callsite",
          planRevision: 0,
        })

        await Bun.write(path.join(tmp.path, "tracked.txt"), "after")
        await expect(
          ExecutionRuntime.commitCompletion({ sessionID: root.id, execution, digest: staged.digest }),
        ).rejects.toMatchObject({ reason: "stale_content_snapshot" })
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("rejects a completion staged under an obsolete review policy snapshot", async () => {
    await using tmp = await tmpdir({
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 2,
          max_attempts: 3,
          high_risk_patterns: [],
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "finish under the current policy")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          messageID: "message-policy-snapshot",
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: false,
          execution,
        })

        await Bun.write(
          path.join(tmp.path, "atomcli.json"),
          JSON.stringify({
            review: {
              enabled: true,
              policy: "always",
              reviewer_count: 2,
              max_attempts: 3,
              high_risk_patterns: [],
            },
          }),
        )
        await Config.clearCache()

        await expect(
          ExecutionRuntime.commitCompletion({ sessionID: root.id, execution, digest: staged.digest }),
        ).rejects.toMatchObject({ reason: "stale_policy" })
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("blocks resolveInvocation when unknown mutating work requires recovery and emits Updated events", async () => {
    await using tmp = await tmpdir({})
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const message1 = await addUserMessage(root.id, "run bash command")
        const execution1 = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: message1 })

        const registered = await ExecutionRuntime.registerWork({
          sessionID: root.id,
          execution: execution1,
          operationID: "op-bash-1",
          kind: "tool:bash",
          mutating: true,
        })
        const began = await ExecutionRuntime.beginWork({
          sessionID: root.id,
          execution: execution1,
          operationID: "op-bash-1",
          expectedVersion: registered.version,
        })

        const updatedEvents: { sessionID: string; executionID: string }[] = []
        const unsub = Bus.subscribe(ExecutionRuntime.Event.Updated, ({ properties }) => {
          updatedEvents.push(properties)
        })

        try {
          await ExecutionRuntime.finishWork({
            sessionID: root.id,
            execution: execution1,
            operationID: "op-bash-1",
            expectedVersion: began.version,
            state: "unknown",
          })

          expect(updatedEvents.length).toBeGreaterThan(0)
          expect(updatedEvents[0].sessionID).toBe(root.id)

          const message2 = await addUserMessage(root.id, "subsequent message")
          let caughtError: unknown
          try {
            await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: message2 })
          } catch (e) {
            caughtError = e
          }
          expect(caughtError).toBeInstanceOf(ExecutionRuntime.BudgetExceededError)
          expect((caughtError as ExecutionRuntime.BudgetExceededError).reason).toBe("recovery_required")
          expect((caughtError as ExecutionRuntime.BudgetExceededError).detail).toContain("op-bash-1")

          const failure = ExecutionRuntime.classifyTerminalFailure(caughtError)
          expect(failure).toMatchObject({
            outcome: "failed",
            reasonCode: "recovery_required",
            retryable: true,
          })
          expect(failure.reasonMessage).toContain("op-bash-1")

          const snap = ExecutionRuntime.snapshot(root.id)
          const execView = snap.executions.find((e) => e.id === execution1.executionID)
          const reconcileResult = ExecutionRuntime.requestReconcile({
            requestID: "reconcile-1",
            executionID: execution1.executionID,
            sessionID: root.id,
            projectID: execView!.projectID, // use the stored projectID, not raw tmp.path
            operationID: "op-bash-1",
            state: "cancelled",
            expectedVersion: execView!.version,
            expectedWorkVersion: began.version + 1, // finishWork increments work version by 1
            evidence: "User confirmed bash was cancelled",
            resolutionCode: "user_cancelled",
          })
          expect(reconcileResult.reconciled).toBe(true)
          expect(updatedEvents.length).toBeGreaterThan(1)
        } finally {
          unsub()
        }
      },
    })
  })
})
