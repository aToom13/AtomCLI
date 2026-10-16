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
import { SessionScopeFloor } from "@/core/session/scope-floor"
import { Instance } from "@/services/project/instance"
import type { Provider } from "@/integrations/provider/provider"
import { tmpdir } from "../fixture/fixture"

test("acceptance survives continuation; reasoned revisions invalidate prior browser evidence and persist history", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const execution = await ExecutionRuntime.resolveInvocation({
        sessionID: session.id,
        invocationID: await addUserMessage(session.id, "Build a 3D browser game"),
      })
      const acceptance = ExecutionContract.acceptanceFor("Build a 3D browser game")
      ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("test", { acceptance }))
      ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
        browserNavigations: 1,
        browserVerificationCalls: 1,
      })
      ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("continue"))
      expect(ExecutionRuntime.getExecutionContract(execution.executionID)).toMatchObject({
        acceptance,
        acceptanceRevision: 1,
      })
      const revised = ExecutionContract.fallback("test", {
        acceptance: [...acceptance, "Collision prevents invalid movement"],
      })
      expect(() => ExecutionRuntime.setExecutionContract(execution.executionID, revised)).toThrow(
        "Acceptance revision requires",
      )
      ExecutionRuntime.setExecutionContract(execution.executionID, revised, {
        acceptanceChange: {
          reason: "runtime_evidence",
          detail: "Player crossed a visible wall",
          invalidatedEvidence: ["Verified 3D gameplay"],
        },
      })
      expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
        browserNavigations: 0,
        browserVerificationCalls: 0,
      })
      expect(ExecutionRuntime.getExecutionContract(execution.executionID)?.acceptanceRevision).toBe(2)
      const events = ExecutionRuntime.events(session.id).items.filter(
        (event) => event.type === "execution.updated" && event.properties?.kind === "acceptance_revision",
      )
      expect(events).toHaveLength(2)
      expect(events[1].properties).toMatchObject({
        revision: 2,
        reason: "runtime_evidence",
        invalidatedEvidence: ["Verified 3D gameplay"],
      })
    },
  })
})

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
  test("default scope cooldown permits immediate direct-to-coordinated recovery", async () => {
    await using tmp = await tmpdir({
      init: async (directory) => {
        await Bun.write(
          path.join(directory, "atomcli.json"),
          JSON.stringify({ experimental: { scope_escalation: { mode: "auto" } } }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const messageID = await addUserMessage(root.id, "Answer a question")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: messageID })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.parseSafe({
            intent: "answer",
            scope: "direct",
            risk: "low",
            confidence: 1,
            needsMutation: false,
          }),
        )
        const first = await ExecutionRuntime.escalateScope({
          sessionID: root.id,
          execution,
          scope: "focused",
          reason: "Need to inspect code",
          actorID: "test",
        })
        const second = await ExecutionRuntime.escalateScope({
          sessionID: root.id,
          execution,
          scope: "coordinated",
          reason: "Found cross-module work",
          actorID: "test",
        })
        expect(first.changed).toBe(true)
        expect(second.changed).toBe(true)
        expect(ExecutionRuntime.scopeEscalationStatus(root.id).count).toBe(2)
      },
    })
  })

  test("scope escalation cannot raise explicit call and step ceilings", async () => {
    await using tmp = await tmpdir({
      config: {
        execution_budget: { max_calls: 1, max_steps: 1, unknown_price: "block" },
        experimental: { scope_escalation: { mode: "auto", max_per_session: 2, cooldown_ms: 0 } },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const messageID = await addUserMessage(root.id, "Implement a focused change")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: messageID })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.parseSafe({
            intent: "change",
            scope: "focused",
            risk: "elevated",
            confidence: 0.8,
            needsMutation: true,
            expectedSurfaces: ["workspace"],
          }),
        )
        const result = await ExecutionRuntime.escalateScope({
          sessionID: root.id,
          execution,
          scope: "coordinated",
          reason: "Independent workstreams found",
          actorID: "test",
        })
        expect(result.grantedCalls).toBe(0)
        expect(result.grantedSteps).toBe(0)
        const first = await ExecutionRuntime.admitModelCall({
          sessionID: root.id,
          purpose: "main",
          estimateMicrousd: 0,
          execution,
        })
        first?.settle(0)
        await expect(
          ExecutionRuntime.admitModelCall({ sessionID: root.id, purpose: "main", estimateMicrousd: 0, execution }),
        ).rejects.toMatchObject({ reason: "call_limit" })
        await ExecutionRuntime.admitStep({ sessionID: root.id, stepID: "scope-step-1", execution })
        await expect(
          ExecutionRuntime.admitStep({ sessionID: root.id, stepID: "scope-step-2", execution }),
        ).rejects.toMatchObject({ reason: "step_limit" })
      },
    })
  })

  test("scope escalation updates policy, grants, durable event, and session floor", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: { scope_escalation: { mode: "auto", max_per_session: 20, cooldown_ms: 0 } },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const messageID = await addUserMessage(root.id, "Implement a focused change")
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: root.id,
          invocationID: messageID,
        })
        const contract = ExecutionContract.parseSafe({
          intent: "change",
          scope: "focused",
          risk: "elevated",
          confidence: 0.8,
          needsMutation: true,
          expectedSurfaces: ["workspace"],
        })
        const initial = ExecutionRuntime.setExecutionContract(execution.executionID, contract)
        const result = await ExecutionRuntime.escalateScope({
          sessionID: root.id,
          execution,
          scope: "coordinated",
          reason: "The change spans independent subsystems.",
          actorID: "test",
        })

        expect(result.changed).toBe(true)
        expect(result.policy.scope).toBe("coordinated")
        expect(result.grantedCalls).toBeGreaterThan(0)
        expect(result.grantedSteps).toBeGreaterThan(0)
        expect(ExecutionRuntime.getExecutionPolicy(execution.executionID)?.scope).toBe("coordinated")
        expect(SessionScopeFloor.get(root.id)).toBe("coordinated")
        const escalation = ExecutionRuntime.events(root.id).items.find(
          (event) => event.type === "execution.scope.escalated",
        )
        expect(escalation?.properties).toMatchObject({
          grantedCalls: result.grantedCalls,
          grantedSteps: result.grantedSteps,
        })
        expect(initial.scope).toBe("focused")
      },
    })
  })

  test("child invocation cannot escalate its root execution", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const messageID = await addUserMessage(root.id, "Change one file")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: messageID })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.parseSafe({ intent: "change", scope: "focused", confidence: 0.8 }),
        )
        await expect(
          ExecutionRuntime.escalateScope({
            sessionID: "child-session",
            execution,
            scope: "coordinated",
            reason: "child requested promotion",
            actorID: "child",
          }),
        ).rejects.toMatchObject({ reason: "scope_escalation_root_only" })
        expect(ExecutionRuntime.getExecutionPolicy(execution.executionID)?.scope).toBe("focused")
      },
    })
  })

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
      retryable: false,
    })
    expect(
      ExecutionRuntime.classifyTerminalFailure(new ExecutionRuntime.BudgetExceededError("recovery_required", "exec-1")),
    ).toEqual({
      outcome: "failed",
      reasonCode: "recovery_required",
      reasonMessage: "The session has unknown mutating work that must be reconciled.",
      retryable: false,
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
})
