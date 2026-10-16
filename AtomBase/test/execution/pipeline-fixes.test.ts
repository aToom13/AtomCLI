import "../preload"
import { describe, expect, test } from "bun:test"
import { ReviewPolicy } from "@/core/verification/review-policy"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { ExecutionRuntime } from "@/core/execution/runtime"
import * as RouteGuidanceStore from "@/core/execution/route-guidance"
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

  test("a workspace edit invalidates earlier browser verification", () => {
    const executionID = "test-browser-evidence-after-edit"
    ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test"))
    ExecutionRuntime.recordRuntimeEvidence(executionID, { browserNavigations: 1, browserVerificationCalls: 1 })
    expect(ExecutionRuntime.getExecutionEvidence(executionID)).toMatchObject({
      browserNavigations: 1,
      browserVerificationCalls: 1,
    })
    ExecutionRuntime.recordRuntimeEvidence(executionID, { mutatingCalls: 1, filesChanged: ["index.html"] })
    expect(ExecutionRuntime.getExecutionEvidence(executionID)).toMatchObject({
      browserNavigations: 0,
      browserVerificationCalls: 0,
    })
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
          routeDecision: "keep" as const,
          selfCritique: "No issues.",
          failedApproaches: [],
          whatToChanges: [],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 50,
          nextActions: ["verify"],
        }
        for (let index = 1; index <= ExecutionCheckpoint.MAX_EXTENSIONS; index++) {
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
          ExecutionRuntime.applyCheckpoint(executionID, `checkpoint-${ExecutionCheckpoint.MAX_EXTENSIONS + 1}`, {
            ...checkpoint,
            requestedCalls: 30,
          }),
        ).toMatchObject({ grantedCalls: undefined, extensionLimitReached: true })
      },
    })
  })

  test("checkpoint grants cannot override the explicit execution call limit", async () => {
    await using tmp = await tmpdir({
      config: { execution_budget: { max_calls: 2, max_steps: 20, unknown_price: "block" } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "hard limit checkpoint")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test"))

        // Fill the hard call limit that execution_budget installs.
        const first = await ExecutionRuntime.admitModelCall({
          sessionID: root.id,
          purpose: "main",
          estimateMicrousd: 0,
          execution,
        })
        expect(first).toBeDefined()
        await ExecutionRuntime.admitModelCall({ sessionID: root.id, purpose: "main", estimateMicrousd: 0, execution })
        await expect(
          ExecutionRuntime.admitModelCall({ sessionID: root.id, purpose: "main", estimateMicrousd: 0, execution }),
        ).rejects.toMatchObject({ name: "ExecutionBudgetExceededError", reason: "call_limit" })

        // The adaptive work slice can continue, but explicit user limits stay hard.
        const applied = ExecutionRuntime.applyCheckpoint(executionID, "checkpoint-hard-limit", {
          decision: "continue",
          requestedCalls: 3,
          objectiveAssessment: "unchanged",
          progressSummary: "progress",
          discoveries: [],
          completedWork: ["partial work"],
          remainingWork: ["verify"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          routeDecision: "keep" as const,
          selfCritique: "No issues.",
          failedApproaches: [],
          whatToChanges: [],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 3,
          nextActions: ["verify"],
        })
        expect(applied.grantedCalls).toBe(3)

        expect(ExecutionRuntime.view(executionID)?.budget.execution.calls.limit).toBe(2)
        await expect(
          ExecutionRuntime.admitModelCall({ sessionID: root.id, purpose: "main", estimateMicrousd: 0, execution }),
        ).rejects.toMatchObject({ name: "ExecutionBudgetExceededError", reason: "call_limit" })
      },
    })
  })

  test("checkpoint progress detection uses file sets and write revisions (CP-02)", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "evidence progress")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test"))
        const checkpoint = {
          decision: "continue" as const,
          requestedCalls: 10,
          objectiveAssessment: "unchanged",
          progressSummary: "progress",
          discoveries: [],
          completedWork: [],
          remainingWork: ["continue"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          routeDecision: "keep" as const,
          selfCritique: "No issues.",
          failedApproaches: [],
          whatToChanges: [],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 10,
          nextActions: ["continue"],
        }
        const sliceEvidence = () =>
          ExecutionRuntime.checkpoints(executionID).at(-1)?.payload.evidence as { noProgressSlices?: number }

        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          filesRead: ["src/a.ts"],
          successfulToolCalls: 1,
          recentToolCallSignatures: ["read:src/a.ts"],
        })
        ExecutionRuntime.applyCheckpoint(executionID, "cp-evidence-1", checkpoint)

        // Same-length file lists with a new path must count as progress.
        ExecutionRuntime.recordRuntimeEvidence(executionID, { filesRead: ["src/b.ts"] })
        ExecutionRuntime.applyCheckpoint(executionID, "cp-evidence-2", checkpoint)
        expect(sliceEvidence().noProgressSlices).toBe(0)

        // A second successful write to the same file is a new revision.
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          filesChanged: ["src/c.ts"],
          fileWriteCounts: { "src/c.ts": 1 },
        })
        ExecutionRuntime.applyCheckpoint(executionID, "cp-evidence-3", checkpoint)
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          fileWriteCounts: { "src/c.ts": 1 },
          recentToolCallSignatures: ["edit:src/c.ts:v2"],
        })
        ExecutionRuntime.applyCheckpoint(executionID, "cp-evidence-4", checkpoint)
        expect(sliceEvidence().noProgressSlices).toBe(0)

        // A successful call without a new path, revision, or semantic result is
        // not progress; call count alone must not keep exploration alive.
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          successfulToolCalls: 2,
          recentToolCallSignatures: ["read:src/a.ts"],
        })
        ExecutionRuntime.applyCheckpoint(executionID, "cp-evidence-5", checkpoint)
        expect(sliceEvidence().noProgressSlices).toBe(1)

        // Browser runtime checks advance verification even when a screenshot
        // or assertion returns the same textual result as an earlier call.
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          browserNavigations: 1,
          browserVerificationCalls: 1,
          recentToolCallSignatures: ["browser:navigate", "browser:screenshot"],
        })
        ExecutionRuntime.applyCheckpoint(executionID, "cp-evidence-browser", checkpoint)
        expect(sliceEvidence().noProgressSlices).toBe(0)

        // Exact repeated calls stay non-progress: the watchdog boundary holds.
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          recentToolCallSignatures: ["edit:same", "edit:same", "edit:same"],
          fileWriteCounts: { "src/same.ts": 3 },
        })
        const reconciled = ExecutionRuntime.reconcileCheckpoint(executionID, checkpoint)
        expect(reconciled.decision).toBe("blocked")
        expect(reconciled.blockers).toContain("The same tool call was repeated without new evidence.")
      },
    })
  })

  test("evicts idle execution states and reloads persisted state (PIPE-03)", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "cache ttl")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("test"))
        expect(ExecutionRuntime.getExecutionPolicy(execution.executionID)).toBeDefined()

        const pruned = ExecutionRuntime._internals.pruneExecutionStates(
          Date.now() + ExecutionRuntime._internals.EXECUTION_STATE_TTL_MS + 1,
        )
        expect(pruned).toBeGreaterThanOrEqual(1)

        // Eviction only drops memory: the persisted state reloads from the ledger.
        expect(ExecutionRuntime.getExecutionPolicy(execution.executionID)).toBeDefined()
        // A fresh access resets the idle clock, so an immediate prune keeps it.
        expect(ExecutionRuntime._internals.pruneExecutionStates()).toBe(0)
      },
    })
  })

  test("evicts idle route guidance so checkpoint hints cannot grow without bound", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const internals = ExecutionRuntime._internals
        const executionID = "exec-guidance-ttl"

        internals.seedRouteGuidance(executionID, Date.now())
        expect(ExecutionRuntime.getRouteGuidance(executionID)).toBeDefined()
        // A fresh write resets the idle clock, so an immediate prune keeps it.
        expect(internals.pruneRouteGuidance()).toBe(0)

        expect(internals.pruneRouteGuidance(Date.now() + internals.ROUTE_GUIDANCE_TTL_MS + 1)).toBeGreaterThanOrEqual(1)
        // Guidance is a soft steering hint, not durable state: evicting it only means
        // the next work slice starts without the hint.
        expect(ExecutionRuntime.getRouteGuidance(executionID)).toBeUndefined()

        // The hard cap bounds growth even when every entry is fresh.
        const now = Date.now()
        for (let index = 0; index <= internals.MAX_ROUTE_GUIDANCE; index++) {
          internals.seedRouteGuidance(`exec-guidance-cap-${index}`, now + index)
        }
        expect(internals.pruneRouteGuidance(now + internals.MAX_ROUTE_GUIDANCE + 1)).toBeGreaterThanOrEqual(1)
        // The most recently written entry survives; the oldest are dropped.
        expect(ExecutionRuntime.getRouteGuidance(`exec-guidance-cap-${internals.MAX_ROUTE_GUIDANCE}`)).toBeDefined()
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
          routeDecision: "keep" as const,
          selfCritique: "No issues.",
          failedApproaches: [],
          whatToChanges: [],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 10,
          nextActions: ["continue"],
        }
        const cases = [
          {
            evidence: {
              recentSemanticActionResults: ["verify:same", "verify:same", "verify:same"],
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

  test("coordinated work does not checkpoint solely for absent legacy taskflow", async () => {
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

        expect(ExecutionRuntime.isCheckpointRequired(executionID)).toBe(false)
      },
    })
  })

  test("does not call completed durable plans missing plans", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "coordinated completed plan")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test", { scope: "coordinated" }))

        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          successfulToolCalls: 24,
          toolCalls: 24,
          recentToolCallSignatures: ["a", "b", "c"],
        })
        const plan = await ExecutionRuntime.createPlan({
          sessionID: root.id,
          execution,
          items: [{ id: "step-1", resourceScope: "plan-item:step-1:done" }],
        })
        const running = await ExecutionRuntime.transitionBlocker({
          sessionID: root.id,
          execution,
          blockerID: plan.blockers[0].id,
          expectedVersion: plan.blockers[0].version,
          state: "running",
        })
        await ExecutionRuntime.transitionBlocker({
          sessionID: root.id,
          execution,
          blockerID: plan.blockers[0].id,
          expectedVersion: running.version,
          state: "resolved",
          evidence: "verified",
          resolutionCode: "test",
        })

        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(executionID)).toBe(false)
        expect(ExecutionRuntime.isCheckpointRequired(executionID)).toBe(false)
      },
    })
  })

  test("same target with a new write revision is not a repeated-target stall", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "repeat target with progress")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test"))
        const checkpoint = {
          decision: "continue" as const,
          requestedCalls: 10,
          objectiveAssessment: "working",
          progressSummary: "progress",
          discoveries: [],
          completedWork: [],
          remainingWork: ["continue"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          routeDecision: "keep" as const,
          selfCritique: "No issues.",
          failedApproaches: [],
          whatToChanges: [],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 10,
          nextActions: ["continue"],
        }

        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          recentToolTargets: ["edit:graph.ts"],
          fileWriteCounts: { "graph.ts": 1 },
        })
        ExecutionRuntime.applyCheckpoint(executionID, "repeat-target-1", checkpoint)
        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          recentToolTargets: ["edit:graph.ts", "edit:graph.ts", "edit:graph.ts"],
          fileWriteCounts: { "graph.ts": 1 },
        })

        expect(ExecutionRuntime.finalizationConstraints(executionID)).not.toContain(
          "The same tool target was revisited without new evidence.",
        )
        ExecutionRuntime.applyCheckpoint(executionID, "repeat-target-2", checkpoint)
        for (let index = 0; index < 3; index++) {
          ExecutionRuntime.recordToolCall(
            executionID,
            { successfulToolCalls: 1 },
            { family: "bash", signature: `inspect-${index}` },
          )
        }
        expect(ExecutionRuntime.isCheckpointRequired(executionID)).toBe(false)
        expect(ExecutionRuntime.finalizationConstraints(executionID)).not.toContain(
          "The same tool target was revisited without new evidence.",
        )
      },
    })
  })

  test("same target with distinct diagnostic results does not trigger repeated-target checkpoint", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "debug the same file with new diagnostics")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test"))

        ExecutionRuntime.recordRuntimeEvidence(executionID, {
          recentToolTargets: ["read:src/graph.ts:", "read:src/graph.ts:", "read:src/graph.ts:"],
          recentSemanticActionResults: ["read:v1", "read:v2", "read:v3"],
          successfulToolCalls: 3,
          toolCalls: 3,
        })

        expect(ExecutionRuntime.checkpointReason(executionID)).toBeUndefined()
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

  test("checkpoint route guidance records revise decisions and failed approaches", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "route guidance")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test"))

        expect(ExecutionRuntime.getRouteGuidance(executionID)).toBeUndefined()

        ExecutionRuntime.applyCheckpoint(executionID, "cp-revise-1", {
          decision: "continue",
          requestedCalls: 30,
          objectiveAssessment: "still working",
          progressSummary: "partial",
          discoveries: [],
          completedWork: [],
          remainingWork: ["try a different approach"],
          failures: ["edit kept failing"],
          blockers: [],
          routeAssessment: "current approach is stuck",
          routeDecision: "revise",
          selfCritique: "I keep retrying the same edit without reading the surrounding code first.",
          failedApproaches: ["repeated edit on the same string"],
          whatToChanges: ["read the file before editing", "use a different anchor"],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 30,
          nextActions: ["read the file"],
        })

        const afterRevise = ExecutionRuntime.getRouteGuidance(executionID)
        expect(afterRevise?.routeRevised).toBe(true)
        expect(afterRevise?.consecutiveRevisions).toBe(1)
        expect(afterRevise?.whatToChanges).toEqual(["read the file before editing", "use a different anchor"])
        expect(afterRevise?.failedApproaches).toEqual(["repeated edit on the same string"])
        RouteGuidanceStore.set(executionID, { ...RouteGuidanceStore.get(executionID)!, updatedAt: 0 })
        RouteGuidanceStore.prune()
        expect(ExecutionRuntime.getRouteGuidance(executionID)).toEqual(afterRevise)
        expect(ExecutionRuntime.getRouteGuidance(executionID)?.consecutiveRevisions).toBe(1)

        ExecutionRuntime.applyCheckpoint(executionID, "cp-keep-1", {
          decision: "continue",
          requestedCalls: 30,
          objectiveAssessment: "new approach works",
          progressSummary: "good",
          discoveries: [],
          completedWork: ["read the file"],
          remainingWork: ["apply the edit"],
          failures: [],
          blockers: [],
          routeAssessment: "keep going",
          routeDecision: "keep",
          selfCritique: "Reading first fixed the repeated failures.",
          failedApproaches: [],
          whatToChanges: [],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 30,
          nextActions: ["apply the edit"],
        })

        const afterKeep = ExecutionRuntime.getRouteGuidance(executionID)
        expect(afterKeep?.routeRevised).toBe(false)
        expect(afterKeep?.consecutiveRevisions).toBe(0)
        // Failed approaches accumulate across checkpoints even after a keep decision.
        expect(afterKeep?.failedApproaches).toEqual(["repeated edit on the same string"])

        ExecutionRuntime.applyCheckpoint(executionID, "cp-revise-2", {
          decision: "continue",
          requestedCalls: 30,
          objectiveAssessment: "stuck again",
          progressSummary: "no progress",
          discoveries: [],
          completedWork: [],
          remainingWork: ["something else"],
          failures: ["test still fails"],
          blockers: [],
          routeAssessment: "stuck",
          routeDecision: "revise",
          selfCritique: "Second failed strategy change.",
          failedApproaches: ["guessing the anchor"],
          whatToChanges: ["inspect the actual error output"],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 30,
          nextActions: ["inspect the error"],
        })

        const accumulated = ExecutionRuntime.getRouteGuidance(executionID)
        expect(accumulated?.consecutiveRevisions).toBe(1)
        expect(accumulated?.failedApproaches).toEqual(["repeated edit on the same string", "guessing the anchor"])
      },
    })
  })

  test("consecutive route revisions without progress become a stall reason", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "revision stall")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test"))

        const revise = {
          decision: "continue" as const,
          requestedCalls: 30,
          objectiveAssessment: "stuck",
          progressSummary: "no progress",
          discoveries: [],
          completedWork: [],
          remainingWork: ["keep trying"],
          failures: ["still broken"],
          blockers: [],
          routeAssessment: "needs a different approach",
          routeDecision: "revise" as const,
          selfCritique: "Strategy change attempt.",
          failedApproaches: ["one dead end"],
          whatToChanges: ["try something else"],
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 30,
          nextActions: ["try something else"],
        }

        // Three prior revisions put the counter at 3; the fourth must be treated
        // as stall evidence rather than granting another slice.
        for (let index = 1; index <= 3; index++) {
          ExecutionRuntime.applyCheckpoint(executionID, `cp-stall-${index}`, revise)
        }
        expect(ExecutionRuntime.getRouteGuidance(executionID)?.consecutiveRevisions).toBe(3)

        const reconciled = ExecutionRuntime.reconcileCheckpoint(executionID, revise)
        expect(reconciled.decision).toBe("blocked")
        expect(reconciled.blockers).toContain(
          "Multiple consecutive route revisions without progress. Strategy changes are not producing results.",
        )
      },
    })
  })
})
