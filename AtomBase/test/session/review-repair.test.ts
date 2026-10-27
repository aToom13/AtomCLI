import "../preload"
import { expect, spyOn, test } from "bun:test"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { SessionPrompt } from "@/core/session/prompt"
import * as ReviewGate from "@/integrations/tool/review-gate"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test.each([
  { allowRetry: true, exhausted: false, outcome: "retry" },
  { allowRetry: false, exhausted: false, outcome: "blocked" },
  { allowRetry: true, exhausted: true, outcome: "blocked" },
])("missing review evidence respects repair budget: %j", async ({ allowRetry, exhausted, outcome }) => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: root.id,
        role: "user",
        agent: "agent",
        model: { providerID: "test", modelID: "fixture" },
        time: { created: Date.now() },
      })
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: user.id })
      const stage = () =>
        ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          execution,
          messageID: Identifier.ascending("message"),
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: true,
        })
      const candidate = await stage()
      const record = spyOn(ExecutionRuntime, "recordReview")
      const review = spyOn(ReviewGate, "runBlockingReview").mockResolvedValue({
        passed: false,
        error: true,
        repairable: true,
        exhausted,
        skipped: false,
        reason: "Requested criterion has no independently observed behavior evidence",
      })
      try {
        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: root.id,
            lastUser: user as any,
            execution,
            candidate,
            abort: new AbortController().signal,
            allowRetry,
          }),
        ).toBe(outcome)
        if (outcome === "blocked") {
          expect(ExecutionRuntime.view(execution.executionID)?.outcome).toBe("blocked")
          return
        }
        const claim = await (record.mock.results[0].value as ReturnType<typeof ExecutionRuntime.recordReview>)
        const repaired = await stage()
        expect(repaired.digest).not.toBe(candidate.digest)
        expect(claim.state).toBe("inconclusive")
        await expect(
          ExecutionRuntime.recordReview({
            sessionID: root.id,
            execution,
            reviewID: claim.id,
            state: "passed",
          }),
        ).rejects.toMatchObject({ reason: "review_decided" })
        const messages = await Session.messages({ sessionID: root.id })
        expect(
          messages
            .flatMap((message) => message.parts)
            .some((part) => part.type === "text" && part.synthetic && part.text.includes("independently observed")),
        ).toBe(true)
        review.mockResolvedValue({ passed: true, exhausted: false, skipped: false })
        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: root.id,
            lastUser: user as any,
            execution,
            candidate: repaired,
            abort: new AbortController().signal,
            allowRetry: false,
          }),
        ).toBe("committed")
        expect(ExecutionRuntime.view(execution.executionID)?.outcome).toBe("completed")
      } finally {
        record.mockRestore()
        review.mockRestore()
      }
    },
  })
})
