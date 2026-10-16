import "../preload"
import { expect, test } from "bun:test"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { BashTool } from "@/integrations/tool/bash"
import { tmpdir } from "../fixture/fixture"
import { SessionPrompt } from "@/core/session/prompt"

test("authorized reviewer executes bash after root finish without consuming root slice or invalidating PASS", async () => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      const execution = await ExecutionRuntime.resolveInvocation({
        sessionID: root.id,
        invocationID: Identifier.ascending("message"),
      })
      ExecutionRuntime.setExecutionContract(
        execution.executionID,
        ExecutionContract.parseSafe({
          intent: "change",
          scope: "focused",
          risk: "low",
          confidence: 1,
          needsMutation: true,
        }),
      )
      ExecutionRuntime.applyCheckpoint(execution.executionID, "root-finish", {
        ...ExecutionRuntime.reconcileCheckpoint(
          execution.executionID,
          {
            decision: "finish",
            finalResponse: "Done",
            objectiveAssessment: "Done",
            progressSummary: "Done",
            discoveries: [],
            completedWork: [],
            remainingWork: [],
            failures: [],
            blockers: [],
            routeAssessment: "Done",
            routeDecision: "keep",
            selfCritique: "Done",
            failedApproaches: [],
            whatToChanges: [],
            planChanged: false,
            routeChanged: false,
            estimatedRemainingCalls: 0,
            nextActions: [],
          },
          root.id,
        ),
      })
      const candidate = await ExecutionRuntime.stageCompletion({
        sessionID: root.id,
        execution,
        messageID: Identifier.ascending("message"),
        finish: "stop",
        parts: [],
        editedFiles: [],
        requiresReview: true,
      })
      const claim = await ExecutionRuntime.claimReview({
        sessionID: root.id,
        execution,
        digest: candidate.digest,
        revision: candidate.revision,
      })
      const reviewer = await Session.create({ parentID: root.id })
      await ExecutionRuntime.authorizeReviewSession({
        sessionID: root.id,
        execution,
        reviewerSessionID: reviewer.id,
        reviewID: claim.id,
      })
      await ExecutionRuntime.inheritSession(root.id, reviewer.id)
      const reviewExecution = await ExecutionRuntime.resolveInvocation({
        sessionID: reviewer.id,
        invocationID: Identifier.ascending("message"),
        kind: "reviewer",
      })
      const before = {
        allowance: ExecutionRuntime.allowance(execution.executionID),
        evidence: ExecutionRuntime.getExecutionEvidence(execution.executionID),
        revision: ExecutionRuntime.mutationRevision(execution.executionID),
      }
      const bash = await BashTool.init()
      await Bun.write(
        `${project.path}/arithmetic.test.ts`,
        'import { test, expect } from "bun:test"\ntest("arithmetic", () => expect(2 + 2).toBe(4))\n',
      )
      const result = await ToolRuntime.execute({
        tool: "bash",
        args: { command: "bun test ./arithmetic.test.ts", description: "Verify arithmetic" },
        context: {
          sessionID: reviewer.id,
          messageID: Identifier.ascending("message"),
          callID: "verification",
          agent: "reviewer",
          abort: new AbortController().signal,
          extra: { execution: reviewExecution },
          async metadata() {},
          async ask() {},
        },
        execute: bash.execute,
      })
      expect(result.output).toContain("1 pass")
      expect(result.metadata.exit).toBe(0)
      expect(ExecutionRuntime.allowance(execution.executionID)).toEqual(before.allowance)
      expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toEqual(before.evidence)
      expect(ExecutionRuntime.mutationRevision(execution.executionID)).toBe(before.revision)
      expect(ExecutionRuntime.view(execution.executionID)?.phase).toBe("finalizing")
      ExecutionRuntime.finishInvocation(reviewExecution, "completed")
      await ExecutionRuntime.recordReview({ sessionID: root.id, execution, reviewID: claim.id, state: "passed" })
      await ExecutionRuntime.recordReview({ sessionID: root.id, execution, reviewID: claim.id, state: "passed" })
      await expect(
        ExecutionRuntime.recordReview({ sessionID: root.id, execution, reviewID: claim.id, state: "rejected" }),
      ).rejects.toMatchObject({ reason: "review_decided" })
      const completion = await ExecutionRuntime.commitCompletion({
        sessionID: root.id,
        execution,
        digest: candidate.digest,
      })
      expect(completion.state).toBe("committed")
      expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).toBe("terminal")
    },
  })
})

test.each(["rejected", "inconclusive"] as const)(
  "durable %s review resolves to one terminal completion outcome",
  async (state) => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const root = await Session.create({})
        const lastUser = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "user",
          agent: "agent",
          model: { providerID: "test", modelID: "fixture" },
          time: { created: Date.now() },
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: lastUser.id })
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          execution,
          messageID: Identifier.ascending("message"),
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: true,
        })
        const claim = await ExecutionRuntime.claimReview({
          sessionID: root.id,
          execution,
          digest: candidate.digest,
          revision: candidate.revision,
        })
        await ExecutionRuntime.recordReview({ sessionID: root.id, execution, reviewID: claim.id, state })
        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: root.id,
            lastUser: lastUser as any,
            execution,
            candidate,
            abort: new AbortController().signal,
            allowRetry: false,
          }),
        ).toBe(state === "inconclusive" ? "committed" : "blocked")
        expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
          lifecycle: "terminal",
          outcome: state === "inconclusive" ? "completed" : "blocked",
          ...(state === "rejected" ? { reason: { code: "review_rejected" } } : {}),
        })
        await expect(
          ExecutionRuntime.recordReview({ sessionID: root.id, execution, reviewID: claim.id, state }),
        ).rejects.toMatchObject({ reason: "not_active" })
      },
    })
  },
)

test("review work allowance is invocation-owned, denies unapproved mutations and stale authority", async () => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      const execution = await ExecutionRuntime.resolveInvocation({
        sessionID: root.id,
        invocationID: Identifier.ascending("message"),
      })
      const candidate = await ExecutionRuntime.stageCompletion({
        sessionID: root.id,
        execution,
        messageID: Identifier.ascending("message"),
        finish: "stop",
        parts: [],
        editedFiles: [],
        requiresReview: true,
      })
      const claim = await ExecutionRuntime.claimReview({
        sessionID: root.id,
        execution,
        digest: candidate.digest,
        revision: candidate.revision,
      })
      const reviewer = await Session.create({ parentID: root.id })
      await ExecutionRuntime.inheritSession(root.id, reviewer.id)
      const review = await ExecutionRuntime.resolveInvocation({
        sessionID: reviewer.id,
        invocationID: Identifier.ascending("message"),
        kind: "reviewer",
      })
      const work = {
        sessionID: reviewer.id,
        execution: review,
        operationID: "verification",
        kind: "tool:bash",
        mutating: true,
      }
      await expect(ExecutionRuntime.registerWork(work)).rejects.toMatchObject({ reason: "not_active" })
      await ExecutionRuntime.authorizeReviewSession({
        sessionID: root.id,
        execution,
        reviewerSessionID: reviewer.id,
        reviewID: claim.id,
      })
      await expect(ExecutionRuntime.registerWork({ ...work, kind: "tool:write" })).rejects.toMatchObject({
        reason: "not_active",
      })
      for (let index = 0; index < 30; index++) {
        const operationID = `verification-${index}`
        const registered = await ExecutionRuntime.registerWork({ ...work, operationID })
        const began = await ExecutionRuntime.beginWork({
          sessionID: reviewer.id,
          execution: review,
          operationID,
          expectedVersion: registered.version,
        })
        await ExecutionRuntime.finishWork({
          sessionID: reviewer.id,
          execution: review,
          operationID,
          expectedVersion: began.version,
          state: "completed",
        })
      }
      expect(ExecutionRuntime.reviewerToolCalls(review)).toBe(30)
      await expect(ExecutionRuntime.registerWork({ ...work, operationID: "overflow" })).rejects.toMatchObject({
        reason: "work_limit",
      })
      expect(ExecutionRuntime.mutationRevision(execution.executionID)).toBe(candidate.revision)
      await ExecutionRuntime.recordReview({ sessionID: root.id, execution, reviewID: claim.id, state: "passed" })
      await expect(ExecutionRuntime.registerWork({ ...work, operationID: "late" })).rejects.toMatchObject({
        reason: "not_active",
      })
    },
  })
})
