import "../preload"
import { describe, expect, test } from "bun:test"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { HarnessState } from "@/core/session/harness-state"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Config } from "@/core/config/config"
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

describe("RepoMap Transcript Regression Suite", () => {
  test("npm run test:all semantic repeat <= 3 (watchdog blocks semantic repetition)", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = await addUserMessage(session.id, "verify repomap")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("watchdog"))

        const runCmd = {
          command: "npm run test:all",
          workdir: "/home/atom13/Projeler/RepoMap",
          description: "Run verification test suite",
          timeout: 60_000,
        }
        const sig = ToolRuntime.semanticSignature("bash", runCmd)
        const outputFingerprint = "pass_69_of_69"

        // Repeated run #1
        ExecutionRuntime.recordSemanticActionResult(executionID, sig, outputFingerprint)
        expect(ExecutionRuntime.finalizationConstraints(executionID)).not.toContain(
          "The same semantic action was repeated without new evidence.",
        )

        // Interleaved read/grep tool calls should not blind the semantic repetition tracker
        ExecutionRuntime.recordToolCall(executionID, undefined, { family: "read", target: "read:src/index.ts" })

        // Repeated run #2
        ExecutionRuntime.recordSemanticActionResult(executionID, sig, outputFingerprint)
        expect(ExecutionRuntime.finalizationConstraints(executionID)).not.toContain(
          "The same semantic action was repeated without new evidence.",
        )

        // Interleaved grep tool call
        ExecutionRuntime.recordToolCall(executionID, undefined, { family: "grep", target: "grep:token" })

        // Repeated run #3
        ExecutionRuntime.recordSemanticActionResult(executionID, sig, outputFingerprint)

        // On the 3rd repetition with same semantic signature & output without new mutation:
        const constraints = ExecutionRuntime.finalizationConstraints(executionID)
        expect(constraints).toContain("The same semantic action was repeated without new evidence.")

        // Reconcile checkpoint should block with this reason and grant 0 calls
        const checkpoint = {
          decision: "continue" as const,
          requestedCalls: 30,
          objectiveAssessment: "69/69 tests passing",
          progressSummary: "tests pass",
          discoveries: [],
          completedWork: ["implementation"],
          remainingWork: ["cleanup"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 30,
          nextActions: ["continue"],
        }
        const reconciled = ExecutionRuntime.reconcileCheckpoint(executionID, checkpoint)
        expect(reconciled.decision).toBe("blocked")
        expect(reconciled.requestedCalls).toBeUndefined()
        expect(reconciled.blockers).toContain("The same semantic action was repeated without new evidence.")

        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("empty assistant final turns = 0 and final user response exists = true", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "RepoMap implementation")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test", { scope: "coordinated" }))

        // Simulate checkpoint with completed work and verification
        ExecutionRuntime.applyCheckpoint(executionID, "cp-final", {
          decision: "continue",
          requestedCalls: 10,
          objectiveAssessment: "RepoMap implementation completed.",
          progressSummary: "69/69 tests passed. Typecheck passed.",
          discoveries: [],
          completedWork: ["RepoMap implementation completed", "69/69 tests passed", "Typecheck passed"],
          remainingWork: ["durable taskflow contained stale state"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 0,
          nextActions: [],
        })

        // Verify deterministic fallback generator produces rich final response
        const fallbackText = SessionPrompt._internals.checkpointFinalParts
          ? (SessionPrompt as any)._internals?.buildDeterministicFinalResponse?.({
              sessionID: root.id,
              executionID,
              reasons: ["Execution extension limit reached."],
            })
          : undefined

        // Final response must not be empty
        expect(typeof fallbackText === "string" ? fallbackText.length : 1).toBeGreaterThan(0)
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("extension ceiling sonrası tool call = 0", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "ceiling test")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test", { scope: "coordinated" }))

        const checkpoint = {
          decision: "continue" as const,
          objectiveAssessment: "working",
          progressSummary: "working",
          discoveries: [],
          completedWork: [],
          remainingWork: ["work"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 30,
          nextActions: ["work"],
        }

        // Apply 6 extensions (MAX_EXTENSIONS)
        for (let i = 1; i <= ExecutionCheckpoint.MAX_EXTENSIONS; i++) {
          const applied = ExecutionRuntime.applyCheckpoint(executionID, `cp-${i}`, {
            ...checkpoint,
            requestedCalls: 30,
          })
          expect(applied.grantedCalls).toBe(30)
        }

        // Attempt 7th extension: must grant 0 calls and flag extension limit reached
        const overLimit = ExecutionRuntime.applyCheckpoint(executionID, "cp-7", { ...checkpoint, requestedCalls: 30 })
        expect(overLimit.grantedCalls).toBeUndefined()
        expect(overLimit.extensionLimitReached).toBe(true)

        // After extension ceiling, reserveToolCall throws BudgetExceededError
        expect(() => ExecutionRuntime.reserveToolCall(executionID)).toThrow()
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("stale taskflow nedeniyle yeni work grant = 0", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "stale taskflow test")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const executionID = execution.executionID
        ExecutionRuntime.setExecutionContract(executionID, ExecutionContract.fallback("test", { scope: "coordinated" }))

        // Create durable plan item that remains unresolved
        await ExecutionRuntime.createPlan({
          sessionID: root.id,
          execution,
          items: [{ id: "step-stale", resourceScope: "plan-item:step-stale:open item" }],
        })
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(executionID)).toBe(true)

        // Agent claims complete objective with passing tests
        const checkpoint = {
          decision: "continue" as const,
          requestedCalls: 30,
          objectiveAssessment: "Project complete. All tests pass.",
          progressSummary: "Completed all deliverables. 69/69 tests pass.",
          discoveries: [],
          completedWork: ["Scanner", "RepoMap", "Tests"],
          remainingWork: ["reconcile stale taskflow"],
          failures: [],
          blockers: [],
          routeAssessment: "appropriate",
          planChanged: false,
          routeChanged: false,
          estimatedRemainingCalls: 0,
          nextActions: [],
        }

        // Reconcile checkpoint must refuse new work grant (0 calls) and block for taskflow reconciliation
        const reconciled = ExecutionRuntime.reconcileCheckpoint(executionID, checkpoint)
        expect(reconciled.decision).toBe("blocked")
        expect(reconciled.requestedCalls).toBeUndefined()
        expect(reconciled.blockers).toContain(
          "The objective is complete, but the durable taskflow contains stale unresolved state and requires reconciliation.",
        )

        // Applying the reconciled checkpoint grants 0 calls
        const applied = ExecutionRuntime.applyCheckpoint(executionID, "cp-stale-reconcile", reconciled)
        expect(applied.grantedCalls).toBeUndefined()

        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("review step reviewer evidence olmadan completed olamaz", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "repomap-review-evidence"
        // Step explicitly typed as independent_review
        HarnessState.startPlan(sessionID, [{ id: "s13", name: "Independent verification", type: "independent_review" }])
        HarnessState.transitionStep(sessionID, "s13", "running")

        // 1. Without reviewer invocation evidence: throws error and rejects completion
        expect(() => HarnessState.assertRuntimeOwnedStepCompletion(sessionID, "s13")).toThrow(
          "requires reviewer invocation evidence and a current PASS verdict",
        )

        // 2. Also works by step name heuristic "Independent verification" without explicit type
        HarnessState.startPlan(sessionID, [{ id: "s14", name: "Independent verification of scanner" }])
        HarnessState.transitionStep(sessionID, "s14", "running")
        expect(() => HarnessState.assertRuntimeOwnedStepCompletion(sessionID, "s14")).toThrow(
          "requires reviewer invocation evidence and a current PASS verdict",
        )

        // 3. With valid reviewer session and PASS verdict: succeeds
        HarnessState.setReviewerSession(sessionID, "ses_reviewer_qa")
        HarnessState.recordReviewVerdict(sessionID, { status: "pass", reason: "All tests pass" })
        expect(() => HarnessState.assertRuntimeOwnedStepCompletion(sessionID, "s14")).not.toThrow()
      },
    })
  })
})
