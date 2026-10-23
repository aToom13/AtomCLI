import "../preload"
import { expect, test } from "bun:test"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { tmpdir } from "../fixture/fixture"
import { PromptFinalization } from "@/core/session/prompt/finalization"
import { HarnessState } from "@/core/session/harness-state"

test.each([false, true])(
  "unfinished work and malformed protocol cannot complete; acceptance=%s",
  async (newEvidence) => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        review: { enabled: false, policy: "off", reviewer_count: 1, max_attempts: 1, high_risk_patterns: [] },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })) as MessageV2.User
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.fallback("unfinished game", {
            expectedSurfaces: ["workspace", "browser"],
            needsExternalAction: true,
            acceptance: newEvidence ? ["Verify requested gameplay"] : undefined,
          }),
        )
        ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
          toolCalls: 2,
          browserNavigations: 1,
          browserVerificationCalls: 1,
        })
        ExecutionRuntime.applyCheckpoint(
          execution.executionID,
          Identifier.ascending("message"),
          ExecutionCheckpoint.Result.parse({
            decision: "continue",
            requestedCalls: 10,
            objectiveAssessment: "Launch only; gameplay remains unverified.",
            progressSummary: "App launched",
            discoveries: [],
            completedWork: ["Launch"],
            remainingWork: ["Verify gameplay"],
            failures: [],
            blockers: [],
            routeAssessment: "Continue verification",
            routeDecision: "keep",
            selfCritique: "Smoke is insufficient",
            failedApproaches: [],
            whatToChanges: [],
            planChanged: false,
            routeChanged: false,
            estimatedRemainingCalls: 1,
            nextActions: ["Verify gameplay"],
          }),
          ExecutionRuntime.getExecutionEvidence(execution.executionID),
        )
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          agent: user.agent,
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: user.model.modelID,
          providerID: user.model.providerID,
          time: { created: Date.now() },
        })
        HarnessState.pushExecutionLog(session.id, {
          command: "bun test test/group",
          workdir: tmp.path,
          output: "a grouped test failed",
          exitCode: 1,
        })
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID,
          finish: "stop",
          execution,
          editedFiles: [],
          requiresReview: false,
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID,
              sessionID: session.id,
              type: "text",
              text: '<system_dispatch>\ndisabled ChatGPT internal tools\n</system_privacy>\n<system_dispatch>\n{"type":"tool_use","id":"toolu_01Fv9KoPjGkC4jR1R8TzY1Vm","name":"bash","input":{"command":"cd /home/atom13/Projeler/AtomCLI && echo \\"=== PRIVATE KEY HEADERS ===\\" && grep -cE -- \\"-----BEGIN [A-Z ]*PRIVATE KEY-----\\" /tmp/atomcli-accept/candidates.txt; echo \\"=== ASSIGNED SECRETS (non-placeholder) ===\\" && grep -nEi -- \\"(password|passwd|api[_-]?key|secret|access[_-]?token|auth[_-]?token)[\\\\\\"\' ]*[:=][\\\\\\"\' ]*[A-Za-z0-9_+/=-]{16,}\\" /tmp/atomcli-accept/candidates.txt | grep -viE \\"(placeholder|example|dummy|change[_-]?me|your[_-]|xxx|test[_-]?only|redacted|\\\\$\\\\{|process\\\\.env|<[a-z]|\\\\*\\\\*\\\\*)\\" | head -20; echo \\"ASSIGNED_SCAN_DONE\\"","description":"Re-run private-key and assigned-secret scans"}}</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n</｜DSML｜ calls>',
            },
          ],
        })
        const outcome = await SessionPrompt._internals.resolveCompletion({
          sessionID: session.id,
          lastUser: user,
          execution,
          candidate,
          abort: new AbortController().signal,
        })
        expect(outcome).toBe("retry")
        {
          expect(ExecutionRuntime.execution(execution.executionID)?.outcome).not.toBe("completed")
          const retry = (await Session.messages({ sessionID: session.id }))
            .flatMap((item) => item.parts)
            .find((part) => part.type === "text" && part.text.includes("checkpoint still requires work"))
          expect(retry).toBeDefined()
          expect((retry as MessageV2.TextPart).text).toContain("rerun the failed verification commands")
          expect((retry as MessageV2.TextPart).text).toContain("Passing individual files does not clear")
          expect((retry as MessageV2.TextPart).text).toContain("bun test test/group")
        }
      },
    })
  },
)

test("actual malformed response is not a final report", () => {
  expect(
    PromptFinalization.isUserFacingReport(
      '<system_dispatch>\ndisabled ChatGPT internal tools\n</system_privacy>\n<system_dispatch>\n{"type":"tool_use","id":"toolu_01Fv9KoPjGkC4jR1R8TzY1Vm","name":"bash","input":{"command":"cd /home/atom13/Projeler/AtomCLI && echo \\"=== PRIVATE KEY HEADERS ===\\" && grep -cE -- \\"-----BEGIN [A-Z ]*PRIVATE KEY-----\\" /tmp/atomcli-accept/candidates.txt; echo \\"=== ASSIGNED SECRETS (non-placeholder) ===\\" && grep -nEi -- \\"(password|passwd|api[_-]?key|secret|access[_-]?token|auth[_-]?token)[\\\\\\"\' ]*[:=][\\\\\\"\' ]*[A-Za-z0-9_+/=-]{16,}\\" /tmp/atomcli-accept/candidates.txt | grep -viE \\"(placeholder|example|dummy|change[_-]?me|your[_-]|xxx|test[_-]?only|redacted|\\\\$\\\\{|process\\\\.env|<[a-z]|\\\\*\\\\*\\\\*)\\" | head -20; echo \\"ASSIGNED_SCAN_DONE\\"","description":"Re-run private-key and assigned-secret scans"}}</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n</｜DSML｜ calls>',
    ),
  ).toBe(false)
  expect(PromptFinalization.isUserFacingReport('<｜DSML｜invoke name="bash">x</｜DSML｜invoke>')).toBe(false)
})

test("fenced protocol examples and ordinary reports remain valid", () => {
  expect(PromptFinalization.isUserFacingReport('Example:\n```json\n{"type":"tool_use","name":"bash"}\n```')).toBe(true)
  expect(
    PromptFinalization.isUserFacingReport("Example:\n```xml\n<system_dispatch>example</system_dispatch>\n```"),
  ).toBe(true)
  expect(PromptFinalization.isUserFacingReport("Kontroller tamamlandı.")).toBe(true)
  expect(PromptFinalization.isUserFacingReport(" ")).toBe(false)
})

test("malformed final protocol has bounded recovery and an honest terminal report", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { review: { enabled: false, policy: "off", max_attempts: 1, reviewer_count: 1, high_risk_patterns: [] } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const user = (await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "fixture" },
        time: { created: Date.now() },
      })) as MessageV2.User
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
      ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("verify source"))
      for (let attempt = 0; attempt < ExecutionCheckpoint.MAX_INVALID_RESPONSES; attempt++) {
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "fixture",
          providerID: "test",
          time: { created: Date.now() },
        })
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID,
          finish: "stop",
          execution,
          editedFiles: [],
          requiresReview: false,
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID,
              sessionID: session.id,
              type: "text",
              text: '<system_dispatch>{"type":"tool_use","name":"bash","input":{"command":"false"}}</｜DSML｜ calls>',
            },
          ],
        })
        const result = await SessionPrompt._internals.resolveCompletion({
          sessionID: session.id,
          lastUser: user,
          execution,
          candidate,
          abort: new AbortController().signal,
        })
        expect(result).toBe(attempt < ExecutionCheckpoint.MAX_INVALID_RESPONSES - 1 ? "retry" : "blocked")
      }
      expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
        lifecycle: "terminal",
        outcome: "blocked",
        reason: { code: "verification_required" },
      })
      const report = (await Session.messages({ sessionID: session.id }))
        .filter((m) => m.info.role === "assistant")
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      expect(report).not.toContain("<system_dispatch>")
      expect(report).toContain("technical blocker")
      expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.toolCalls ?? 0).toBe(0)
    },
  })
})
