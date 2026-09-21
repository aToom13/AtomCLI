import "../preload"
import { describe, expect, test } from "bun:test"
import { ReviewPolicy } from "@/core/verification/review-policy"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionLedger } from "@/core/execution/ledger"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { HarnessState } from "@/core/session/harness-state"
import { PermissionNext } from "@/util/permission/next"
import { Agent } from "@/integrations/agent/agent"
import { LLM } from "@/core/session/llm"
import { Config } from "@/core/config/config"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

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

describe("Pipeline Fixes Integration Suite", () => {
  test("Issue 2: coordinated + elevated requires review", () => {
    const directPolicy = ReviewPolicy.requiresIndependentReview("adaptive", {
      editedFiles: ["src/utils/math.ts"],
      scope: "direct",
      risk: "elevated",
    })
    expect(directPolicy).toBe(false)

    const coordinatedPolicy = ReviewPolicy.requiresIndependentReview("adaptive", {
      editedFiles: ["src/utils/math.ts"],
      scope: "coordinated",
      risk: "elevated",
    })
    expect(coordinatedPolicy).toBe(true)
    expect(ReviewPolicy.assess({ editedFiles: ["src/utils/math.ts"], scope: "coordinated", risk: "elevated" })).toBe(
      "high",
    )
  })

  test("Issue 4: admitToolCall does not record mutating evidence before execution", () => {
    const executionID = "test-exec-evidence-4"
    const contract = ExecutionContract.fallback("test")
    ExecutionRuntime.setExecutionContract(executionID, contract)

    ExecutionRuntime.admitToolCall(executionID)
    const evidence = ExecutionRuntime.getExecutionEvidence(executionID)
    expect(evidence?.filesChanged?.length ?? 0).toBe(0)
    expect(evidence?.mutatingCalls ?? 0).toBe(0)
    expect(evidence?.toolCalls).toBe(1)
  })

  test("stops repeated model checkpoint grants at the hard extension ceiling", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "coordinated durable extension")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        const contract = ExecutionContract.fallback("test", { scope: "coordinated" })
        ExecutionRuntime.setExecutionContract(executionID, contract)
        // Step 1 before tool calls must not be blocked by checkpoint
        expect(ExecutionRuntime.isCheckpointRequired(executionID)).toBe(false)
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          successfulToolCalls: 24,
          toolCalls: 24,
          recentToolCallSignatures: ["a", "b", "c"],
        })
        await ExecutionRuntime.createPlan({
          sessionID: root.id,
          execution,
          items: [{ id: "step-1", resourceScope: "plan-item:step-1:verify budget extension" }],
        })
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(executionID)).toBe(true)

        ExecutionRuntime.admitToolCall(executionID, undefined, { signature: "d" })

        expect(ExecutionRuntime.getExecutionPolicy(executionID)?.budget).toMatchObject({
          maxSteps: 30,
          maxToolCalls: 30,
        })
        expect(ExecutionRuntime.getExecutionPolicy(executionID)?.budgetExtension).toBeUndefined()
        expect(ExecutionRuntime.getExecutionEvidence(executionID)?.toolCalls).toBe(25)
        const checkpoint = {
          decision: "continue" as const,
          objectiveAssessment: "unchanged",
          progressSummary: "progress",
          discoveries: [],
          completedWork: [],
          remainingWork: ["verify"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 50,
          nextActions: ["verify"],
        }
        for (let index = 1; index <= 6; index++) {
          expect(
            ExecutionRuntime.applyCheckpoint(executionID, `checkpoint-${index}`, {
              ...checkpoint,
              requestedCalls: 30,
            }).grantedCalls,
          ).toBe(30)
        }
        expect(ExecutionRuntime.reconcileCheckpoint(executionID, { ...checkpoint, requestedCalls: 30 })).toMatchObject({
          decision: "blocked",
          planChanged: false,
          routeChanged: false,
          blockers: expect.arrayContaining(["Execution extension limit reached."]),
        })
        expect(
          ExecutionRuntime.applyCheckpoint(executionID, "checkpoint-7", { ...checkpoint, requestedCalls: 30 }),
        ).toMatchObject({ grantedCalls: undefined, extensionLimitReached: true })
      },
    })
  })

  test("watchdog decisions stop repeated calls, targets, errors, and no-progress slices", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const checkpoint = {
          decision: "continue" as const,
          requestedCalls: 10,
          objectiveAssessment: "unchanged",
          progressSummary: "work attempted",
          discoveries: [],
          completedWork: [],
          remainingWork: ["finish"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 10,
          nextActions: ["continue"],
        }
        const cases = [
          {
            evidence: {
              recentSemanticActionResults: ["verify:same", "read:other", "verify:same", "grep:other", "verify:same"],
            },
            reason: "The same semantic action was repeated without new evidence.",
          },
          {
            evidence: { recentToolCallSignatures: ["same", "same", "same"] },
            reason: "The same tool call was repeated without new evidence.",
          },
          {
            evidence: { recentToolTargets: ["read:a", "read:a", "read:a"] },
            reason: "The same tool target was revisited without new evidence.",
          },
          {
            evidence: { recentErrorFingerprints: ["error", "error", "error"] },
            reason: "The same tool error repeated without recovery.",
          },
        ]
        for (const item of cases) {
          const session = await Session.create({})
          const userID = await addUserMessage(session.id, "watchdog case")
          const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
          ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("watchdog"))
          ExecutionRuntime.recordRuntimeEvidence(execution.executionID, item.evidence)

          expect(ExecutionRuntime.reconcileCheckpoint(execution.executionID, checkpoint)).toMatchObject({
            decision: "blocked",
            blockers: expect.arrayContaining([item.reason]),
          })
          ExecutionRuntime.cancelExecution(execution)
        }

        const session = await Session.create({})
        const userID = await addUserMessage(session.id, "no progress watchdog")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("watchdog"))
        for (let index = 0; index < ExecutionCheckpoint.MAX_NO_PROGRESS_SLICES; index++) {
          const reconciled = ExecutionRuntime.reconcileCheckpoint(execution.executionID, checkpoint)
          ExecutionRuntime.applyCheckpoint(execution.executionID, `no-progress-${index}`, reconciled)
        }
        expect(ExecutionRuntime.reconcileCheckpoint(execution.executionID, checkpoint)).toMatchObject({
          decision: "blocked",
          blockers: expect.arrayContaining([
            "No verifiable progress was recorded across consecutive execution slices.",
          ]),
        })
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("semantic watchdog resets after applied mutation and accepts changed results", () => {
    const executionID = "test-semantic-watchdog-reset"
    ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("watchdog"))
    ExecutionRuntime.recordRuntimeEvidence(executionID, {
      recentSemanticActionResults: ["verify:pass", "verify:pass"],
    })
    ExecutionRuntime.recordRuntimeEvidence(executionID, { mutatingCalls: 1, filesChanged: ["src/index.ts"] })
    ExecutionRuntime.recordRuntimeEvidence(executionID, {
      recentSemanticActionResults: ["verify:pass", "verify:new-output", "verify:pass"],
    })

    expect(ExecutionRuntime.finalizationConstraints(executionID)).not.toContain(
      "The same semantic action was repeated without new evidence.",
    )
  })

  test("requires a checkpoint before coordinated work without a durable plan", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "coordinated without durable plan")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        const contract = ExecutionContract.fallback("test", { scope: "coordinated" })
        ExecutionRuntime.setExecutionContract(executionID, contract)
        // Step 1 before tool calls must not be blocked by checkpoint
        expect(ExecutionRuntime.isCheckpointRequired(executionID)).toBe(false)
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          successfulToolCalls: 24,
          toolCalls: 24,
          recentToolCallSignatures: ["a", "b", "c"],
        })
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(executionID)).toBe(false)

        expect(ExecutionRuntime.isCheckpointRequired(executionID)).toBe(true)
      },
    })
  })

  test("Issue 6: execution policy state persists and recovers via ledger", async () => {
    await using dir = await tmpdir()
    const ledgerFile = path.join(dir.path, "ledger.sqlite")
    const store = ExecutionLedger.open(ledgerFile)

    const executionID = "exec-persist-6"
    store.start({
      id: executionID,
      projectID: "proj-1",
      rootSessionID: "sess-1",
      fence: 1,
      policy: {},
    })

    const contract: ExecutionContract.Info = {
      intent: "change",
      scope: "focused",
      risk: "critical",
      confidence: 0.9,
      deliverables: ["fix critical auth bug"],
      expectedSurfaces: ["workspace"],
      assumptions: [],
      uncertainty: "low",
      needsDiscovery: false,
      needsMutation: true,
      needsExternalAction: false,
      likelyCrossBoundary: false,
      rationale: "auth fix",
    }
    const policy = ExecutionPolicy.resolvePolicy(contract)

    store.savePolicyState({
      executionID,
      contract,
      policy,
      evidence: { mutatingCalls: 2, filesChanged: ["src/auth.ts"] },
      promotionReasons: ["auth mutation"],
      classifierFallback: false,
      extensionCount: 0,
    })

    const restored = store.getPolicyState(executionID)
    expect(restored).toBeDefined()
    expect(restored?.contract.risk).toBe("critical")
    expect(restored?.policy.scope).toBe("focused")
    expect(restored?.evidence.mutatingCalls).toBe(2)
    expect(restored?.promotionReasons).toEqual(["auth mutation"])

    store.close()
  })

  test("Issue 7: reviewer agent denies mutating browser actions", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const agent = await Agent.get("reviewer")
        const rules = agent.permission

        const clickAllowed = PermissionNext.evaluate("browser", "click:button", rules).action
        const typeAllowed = PermissionNext.evaluate("browser", "type:input", rules).action
        const snapshotAllowed = PermissionNext.evaluate("browser", "snapshot:view", rules).action
        const readAllowed = PermissionNext.evaluate("browser", "read:content", rules).action
        const navigateAllowed = PermissionNext.evaluate("browser", "navigate:https://example.com", rules).action

        expect(clickAllowed).toBe("deny")
        expect(typeAllowed).toBe("deny")
        expect(snapshotAllowed).toBe("allow")
        expect(readAllowed).toBe("allow")
        expect(navigateAllowed).toBe("allow")
      },
    })
  })

  test("Issue 8: admitStep enforces policy maxSteps hard limit", async () => {
    await using project = await tmpdir({ config: {} })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const userID = await addUserMessage(session.id, "direct bounded work")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.fallback("direct-step-limit", { scope: "direct" }),
        )

        await ExecutionRuntime.admitStep({ sessionID: session.id, stepID: "step-1", execution })
        await ExecutionRuntime.admitStep({ sessionID: session.id, stepID: "step-2", execution })
        await expect(
          ExecutionRuntime.admitStep({ sessionID: session.id, stepID: "step-3", execution }),
        ).rejects.toMatchObject({ reason: "step_limit" })
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("Issue 10: repairToolCall does not route to invalid when invalid tool is not advertised", async () => {
    const toolsWithoutInvalid = {
      read: {} as any,
      grep: {} as any,
    }

    const failed = {
      toolCall: { toolName: "nonexistent_tool", args: {} },
      error: new Error("Tool not found"),
    }

    const repaired = LLM.resolveToolCallName(failed.toolCall.toolName, toolsWithoutInvalid)
    expect(repaired).toBeUndefined()
  })

  test("Issue 11: taskflow plan from older execution does not block new execution", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const sessionID = "sess-taskflow-11"
        HarnessState.startPlan(sessionID, [{ id: "step1", name: "Step 1" }], {
          executionID: "exec-old-11",
          revision: 1,
          items: {},
        })

        expect(HarnessState.hasActivePlan(sessionID, "exec-old-11")).toBe(true)
        expect(HarnessState.hasActivePlan(sessionID, "exec-new-11")).toBe(false)
        HarnessState.clearPlan(sessionID)
      },
    })
  })
})
