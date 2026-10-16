import path from "path"
import { describe, expect, test } from "bun:test"
import "../preload"
import { Bus } from "@/core/bus"
import { Config } from "@/core/config/config"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { HarnessState } from "@/core/session/harness-state"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionPrompt } from "@/core/session/prompt"
import { MessageV2 } from "@/core/session/message-v2"
import { TaskVerification, runAutomaticTaskChecks } from "@/core/execution/task-verification"

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

describe("ExecutionRuntime finalization safety", () => {
  test("current static checks replace diagnostic syntax methods, explicit checks still fail", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const file = path.join(tmp.path, "app.js")
        await Bun.write(file, "const value = 1\n")
        HarnessState.pushExecutionLog(root.id, {
          command: "node --check <(printf 'const value = 1')",
          output: "ENOENT: no such file or directory, open '/proc/self/fd/pipe:[123]'",
          exitCode: 1,
        })
        await TaskVerification.assertStaticChecks([file], tmp.path, root.id)
        expect(HarnessState.failedVerificationCommands(root.id)).toEqual([])
        await Bun.write(file, "const value = (\n")
        await expect(TaskVerification.assertStaticChecks([file], tmp.path, root.id)).rejects.toThrow(
          "STATIC_VERIFICATION_FAILED",
        )
        expect(HarnessState.failedVerificationCommands(root.id)).toEqual([`static_check ${file}`])
        const explicit = await runAutomaticTaskChecks(
          [
            {
              id: "node-syntax",
              description: "Requested Node syntax check",
              verification: "automatic",
              command: "node --check app.js",
            },
          ],
          tmp.path,
        )
        expect(explicit[0].exitCode).not.toBe(0)
      },
    })
  })

  test("review-free completion cannot hide a failed test", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "Implement and test arithmetic")
        const user = (await Session.messages({ sessionID: root.id })).find((message) => message.info.id === userID)!
          .info as MessageV2.User
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          execution,
          messageID: Identifier.ascending("message"),
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: false,
        })
        HarnessState.pushExecutionLog(root.id, {
          command: "bun test arithmetic.test.ts",
          output: "1 fail",
          exitCode: 1,
        })
        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: root.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
            allowRetry: false,
          }),
        ).toBe("blocked")
        expect(ExecutionRuntime.view(execution.executionID)?.outcome).not.toBe("completed")
        expect(ExecutionRuntime.completion(execution.executionID)?.requiresReview).toBe(false)
        ExecutionRuntime.finishInvocation(execution, "completed")
        expect(ExecutionRuntime.snapshot(root.id).activeInvocations).toHaveLength(0)
      },
    })
  })

  test("coordinated elevated edits do not require review without opt-in", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const { evaluateReviewDecision } = await import("@/integrations/tool/review-gate")
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "Create a complete browser OS with two 3D games")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        ExecutionRuntime.setExecutionContract(execution.executionID, {
          ...ExecutionContract.fallback("test"),
          scope: "coordinated",
          risk: "elevated",
          expectedSurfaces: ["browser", "workspace"],
        })
        HarnessState.addEditedFile(root.id, "index.html")
        const decision = (await evaluateReviewDecision(root.id, execution.executionID)).decision
        expect(decision).toMatchObject({ requirement: "not_required", reasonCode: "automatic_review_disabled" })
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("stages and commits a review-gate decision when the config omits the review block", async () => {
    // Default-config path: with no `review` block Zod never applies the field
    // defaults, so the review gate and the execution runtime must resolve the
    // same fallback snapshot. A divergent fallback makes every root-session
    // completion fail with stale_policy.
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const { evaluateReviewDecision } = await import("@/integrations/tool/review-gate")
        const root = await Session.create({})
        const userID = await addUserMessage(root.id, "finish with the default review configuration")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        const reviewDecision = (await evaluateReviewDecision(root.id, execution.executionID)).decision
        expect(reviewDecision.requirement).toBe("not_required")

        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          messageID: "message-default-review-policy",
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: reviewDecision.requirement === "required",
          reviewDecision,
          execution,
        })

        const committed = await ExecutionRuntime.commitCompletion({
          sessionID: root.id,
          execution,
          digest: staged.digest,
        })
        expect(committed.outcome).toBe("completed")
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
            retryable: false,
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
          expect(ExecutionRuntime.view(execution1.executionID)).toMatchObject({ lifecycle: "active", unknownWork: [] })
          expect(updatedEvents.length).toBeGreaterThan(1)
        } finally {
          unsub()
        }
      },
    })
  })
})
