import "../preload"
import { expect, spyOn, test } from "bun:test"
import { AgentEval } from "@/core/eval/harness"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { SessionPrompt } from "@/core/session/prompt"
import { MessageV2 } from "@/core/session/message-v2"
import { HarnessState } from "@/core/session/harness-state"
import { SessionProcessor } from "@/core/session/processor"
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
import { SubAgent } from "@/integrations/tool/subagent"
import { ReviewV2 } from "@/core/verification/review-v2"
import { ReviewPolicy } from "@/core/verification/review-policy"
import { evaluateReviewDecision } from "@/integrations/tool/review-gate"
import { Config } from "@/core/config/config"
import { Bus } from "@/core/bus"
import { PermissionNext } from "@/util/permission/next"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test.each(["coder", "reviewer"])(
  "real %s child prompt returns parallel results without a nested root gate",
  async (agentName) => {
    await using project = await tmpdir({ git: true, config: { experimental: { execution_classification: false } } })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await Bun.write(
          `${project.path}/arithmetic.test.ts`,
          'import { test, expect } from "bun:test"\ntest("arithmetic", () => expect(2 + 2).toBe(4))\n',
        )
        const root = await Session.create({})
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: root.id,
          invocationID: Identifier.ascending("message"),
        })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.parseSafe({
            intent: "change",
            scope: "coordinated",
            risk: "low",
            confidence: 1,
            needsMutation: true,
          }),
        )
        const provider = (await Provider.getProvider("atomcli"))!
        const model = Object.values(provider.models).find(
          (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
        )!
        const agent = (await Agent.get(agentName))!
        let claim: Awaited<ReturnType<typeof ExecutionRuntime.claimReview>> | undefined
        if (agentName === "reviewer") {
          const checkpoint = {
            ...ExecutionCheckpoint.conservativeContinue("Complete root"),
            decision: "finish" as const,
            requestedCalls: undefined,
            finalResponse: "Done",
          }
          ExecutionRuntime.applyCheckpoint(execution.executionID, "root-finish", checkpoint)
          const candidate = await ExecutionRuntime.stageCompletion({
            sessionID: root.id,
            execution,
            messageID: Identifier.ascending("message"),
            finish: "stop",
            parts: [],
            editedFiles: [],
            requiresReview: true,
          })
          claim = await ExecutionRuntime.claimReview({
            sessionID: root.id,
            execution,
            digest: candidate.digest,
            revision: candidate.revision,
          })
        }
        const before = ExecutionRuntime.allowance(execution.executionID)
        let started = 0
        let release!: () => void
        const bothStarted = new Promise<void>((resolve) => {
          release = resolve
        })
        const evaluations = spyOn(AgentEval, "executionPolicy").mockReturnValue({
          allowAuxiliarySummaries: false,
        } as never)
        const processor = spyOn(SessionProcessor, "create").mockImplementation(
          (input) =>
            ({
              message: input.assistantMessage,
              partFromToolCall: () => undefined,
              async process(stream, options) {
                expect(options.captureCheckpointReasoning).toBe(false)
                expect(options.deferText).toBe(false)
                expect(stream.tools.bash).toBeDefined()
                started++
                if (started === 2) release()
                await bothStarted
                if (agentName === "reviewer") {
                  const verified = await stream.tools.bash.execute(
                    { command: "bun test ./arithmetic.test.ts", description: "Check" },
                    { toolCallId: "verify", abortSignal: stream.abort, messages: [] },
                  )
                  expect(verified.output).toContain("1 pass")
                  expect(verified.metadata.exit).toBe(0)
                }
                const text =
                  agentName === "reviewer"
                    ? '<structured_output>{"verdict":"passed","summary":"Checked","findings":[]}</structured_output>'
                    : "Child result"
                await Session.updatePart({
                  id: Identifier.ascending("part"),
                  sessionID: input.assistantMessage.sessionID,
                  messageID: input.assistantMessage.id,
                  type: "text",
                  text,
                })
                input.assistantMessage.finish = "stop"
                input.assistantMessage.time.completed = Date.now()
                await Session.updateMessage(input.assistantMessage)
                return { status: "continue", terminalFinish: "stop" }
              },
            }) as never,
        )
        try {
          const results = await Promise.all(
            Array.from({ length: 2 }, (_, index) =>
              SubAgent.spawn({
                parentSessionID: root.id,
                agent,
                model: { providerID: model.providerID, modelID: model.id },
                permissions: SubAgent.buildFromAgent(agent),
                description: `Child ${index}`,
                parts: [{ type: "text", text: "Verify arithmetic independently" }],
                ...(claim
                  ? {
                      outputSchema: ReviewV2.OutputSchema,
                      onSession: async ({ sessionId }: { sessionId: string }) => {
                        await ExecutionRuntime.authorizeReviewSession({
                          sessionID: root.id,
                          execution,
                          reviewerSessionID: sessionId,
                          reviewID: claim!.id,
                        })
                      },
                    }
                  : {}),
              }),
            ),
          )
          expect(results).toHaveLength(2)
          expect(started).toBe(2)
          expect(ExecutionRuntime.snapshot(root.id).activeInvocations).toHaveLength(1)
          expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).toBe("active")
          if (claim) {
            expect(results.map((result) => result.structuredOutput)).toEqual(
              Array(2).fill({ verdict: "passed", summary: "Checked", findings: [] }),
            )
            expect(ExecutionRuntime.allowance(execution.executionID)).toEqual(before)
            expect(ExecutionRuntime.checkpoints(execution.executionID)).toHaveLength(1)
            expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.noProgressSlices ?? 0).toBe(0)
          } else expect(results.map((result) => result.output)).toEqual(["Child result", "Child result"])
        } finally {
          processor.mockRestore()
          evaluations.mockRestore()
        }
      },
    })
  },
  20_000,
)

test("review deadline cancels a stuck peer, retains the completed peer result", async () => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      const agent = (await Agent.get("reviewer"))!
      const cancelled: string[] = []
      SubAgent.register({
        id: "review-deadline-fixture",
        capabilities: { ...SubAgent.capabilities(), cancellation: true },
        async spawn(config) {
          await config.onSession?.({ sessionId: config.description, isNewSession: true })
          if (config.description === "fast") return { sessionId: "fast", isNewSession: true, output: "PASS", parts: [] }
          return new Promise(() => {})
        },
        cancel(sessionID) {
          cancelled.push(sessionID)
        },
      })
      const setTimer = globalThis.setTimeout
      const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback, milliseconds, ...args) =>
        setTimer(
          callback,
          milliseconds === ReviewPolicy.REVIEW_TIMEOUT_MS ? 30 : milliseconds,
          ...args,
        )) as typeof setTimeout)
      try {
        const results = await Promise.allSettled(
          ["fast", "stuck"].map((description) =>
            SubAgent.spawn({
              parentSessionID: root.id,
              agent,
              model: { providerID: "test", modelID: "fixture" },
              parts: [],
              permissions: [],
              description,
              runtime: "review-deadline-fixture",
            }),
          ),
        )
        expect(results[0]).toMatchObject({ status: "fulfilled", value: { output: "PASS" } })
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({ message: "Independent reviewer timed out" }),
        })
        expect(cancelled).toEqual(["stuck"])
        expect(SubAgent.status("stuck").status).toBe("cancelled")
      } finally {
        timer.mockRestore()
      }
    },
  })
})

test.each([0, 1, 3])("root completes %i edited files without reviewers or checkpoints", async (fileCount) => {
  await using project = await tmpdir({ git: true, config: { experimental: { execution_classification: false } } })
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      let turns = 0
      const evaluations = spyOn(AgentEval, "executionPolicy").mockReturnValue({
        allowAuxiliarySummaries: false,
      } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream) {
              turns++
              if (fileCount) {
                const execution = ExecutionRuntime.list({ sessionID: root.id }).items[0]
                ExecutionRuntime.setExecutionContract(
                  execution.id,
                  ExecutionContract.parseSafe({
                    intent: "change",
                    scope: "coordinated",
                    risk: "critical",
                    confidence: 1,
                    needsMutation: true,
                  }),
                )
                for (let index = 0; index < fileCount; index++) {
                  const filename = `value-${index}.ts`
                  await Bun.write(`${project.path}/${filename}`, "export const answer = 4\n")
                  HarnessState.addEditedFile(root.id, filename)
                }
                await Bun.write(
                  `${project.path}/value.test.ts`,
                  'import { test, expect } from "bun:test"\nimport { answer } from "./value-0"\ntest("value", () => expect(answer).toBe(4))\n',
                )
                const checked = await stream.tools.bash.execute(
                  { command: "bun test ./value.test.ts", description: "Verify changes" },
                  { toolCallId: "verify", abortSignal: stream.abort, messages: [] },
                )
                expect(checked.metadata.exit).toBe(0)
              }
              await Session.updatePart({
                id: Identifier.ascending("part"),
                sessionID: root.id,
                messageID: input.assistantMessage.id,
                type: "text",
                text: "4",
              })
              input.assistantMessage.finish = "stop"
              input.assistantMessage.time.completed = Date.now()
              await Session.updateMessage(input.assistantMessage)
              return { status: "continue", terminalFinish: "stop" }
            },
          }) as never,
      )
      try {
        const result = await SessionPrompt.prompt({
          sessionID: root.id,
          agent: "agent",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [
            {
              type: "text",
              text: fileCount ? "Implement and test the answer in the TypeScript files" : "What is 2 + 2?",
            },
          ],
        })
        expect(result.parts.some((part) => part.type === "text" && part.text === "4")).toBe(true)
        expect(turns).toBe(1)
        expect(await Session.children(root.id)).toHaveLength(0)
        const snapshot = ExecutionRuntime.snapshot(root.id)
        expect(snapshot.activeInvocations).toHaveLength(0)
        const execution = ExecutionRuntime.list({ sessionID: root.id }).items[0]
        expect(execution).toMatchObject({ lifecycle: "terminal", outcome: "completed" })
        expect(ExecutionRuntime.completion(execution.id)).toMatchObject({
          state: "committed",
          projection: "projected",
          requiresReview: false,
          reviewRequirement: "not_required",
        })
        expect(HarnessState.getReviewVerdict(root.id)).toBeUndefined()
        expect(ExecutionRuntime.checkpoints(execution.id)).toHaveLength(0)
      } finally {
        processor.mockRestore()
        evaluations.mockRestore()
      }
    },
  })
})

test.each([
  "single",
  "passed",
  "rejected",
  "inconclusive",
  "timeout",
  "cancelled",
  "failed_test",
  "mutation",
  "step_limit",
  "retry-approved",
  "retry-rejected",
  "retry-exhausted",
] as const)(
  "required completion review terminates: %s",
  async (verdict) => {
    const recovery = verdict.startsWith("retry-")
    await using project = await tmpdir({
      git: true,
      config: Config.Info.parse({
        experimental: { execution_classification: false },
        review: {
          auto: true,
          enabled: true,
          policy: "always",
          ...(verdict === "single" || recovery ? {} : { reviewer_count: 2 }),
          max_attempts: recovery ? 3 : 1,
          high_risk_patterns: [],
        },
      }),
    })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const root = await Session.create({})
        const provider = (await Provider.getProvider("atomcli"))!
        const model = Object.values(provider.models).find(
          (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
        )!
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: root.id,
          role: "user",
          agent: "agent",
          model: { providerID: model.providerID, modelID: model.id },
          time: { created: Date.now() },
        })) as MessageV2.User
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: user.id })
        await Bun.write(`${project.path}/math.ts`, "export const answer = 4\n")
        await Bun.write(
          `${project.path}/arithmetic.test.ts`,
          'import { test, expect } from "bun:test"\nimport { answer } from "./math"\ntest("arithmetic", () => expect(answer).toBe(4))\n',
        )
        HarnessState.addEditedFile(root.id, "math.ts")
        const decision = (await evaluateReviewDecision(root.id, execution.executionID)).decision
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: root.id,
          role: "assistant",
          agent: "agent",
          path: { cwd: project.path, root: project.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        })
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: root.id,
          execution,
          messageID,
          finish: "stop",
          parts: [],
          editedFiles: ["math.ts"],
          requiresReview: true,
          reviewDecision: decision,
        })
        const before = ExecutionRuntime.allowance(execution.executionID)
        const children: string[] = []
        const turns = new Map<string, number>()
        const evaluations = spyOn(AgentEval, "executionPolicy").mockReturnValue({
          allowAuxiliarySummaries: false,
        } as never)
        const modelLookup = spyOn(Provider, "getModel").mockResolvedValue(model)
        const recordedReviews = spyOn(ExecutionRuntime, "recordReview")
        const originalSpawn = SubAgent.spawn
        let dispatches = 0
        const spawn = spyOn(SubAgent, "spawn").mockImplementation(async (options) => {
          if (recovery && (++dispatches <= 3 || verdict === "retry-exhausted")) throw new Error("provider unavailable")
          return originalSpawn(options)
        })
        let permissionRequests = 0
        const unsubscribe = Bus.subscribe(PermissionNext.Event.Asked, async (event) => {
          if (event.properties.permission !== "review.retry") return
          permissionRequests++
          expect(recordedReviews).not.toHaveBeenCalled()
          expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).not.toBe("terminal")
          await PermissionNext.reply({
            requestID: event.properties.id,
            reply: verdict === "retry-rejected" ? "reject" : "once",
          })
        })
        const setTimer = globalThis.setTimeout
        const reviewerTimeouts: Array<() => void> = []
        let passingReviewFinished = false
        const fireReviewerTimeouts = () => {
          if (verdict === "timeout" && children.length === 2 && passingReviewFinished)
            void SubAgent.wait(children[0], { timeoutMs: 10_000 }).then(() =>
              setTimer(() => reviewerTimeouts.forEach((expire) => expire()), 0),
            )
        }
        const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback, milliseconds, ...args) => {
          if (verdict === "timeout" && milliseconds === ReviewPolicy.REVIEW_TIMEOUT_MS)
            reviewerTimeouts.push(() => callback(...args))
          return setTimer(callback, milliseconds, ...args)
        }) as typeof setTimeout)
        const processor = spyOn(SessionProcessor, "create").mockImplementation(
          (input) =>
            ({
              message: input.assistantMessage,
              partFromToolCall: () => undefined,
              async process(stream, options) {
                const childID = input.assistantMessage.sessionID
                if (!children.includes(childID)) children.push(childID)
                const index = children.indexOf(childID) + 1
                turns.set(childID, (turns.get(childID) ?? 0) + 1)
                expect(options.captureCheckpointReasoning).toBe(false)
                if (verdict === "timeout" && index === 2) {
                  fireReviewerTimeouts()
                  return new Promise(() => {})
                }
                if (verdict === "cancelled" && index === 2) {
                  throw new DOMException("Reviewer cancelled", "AbortError")
                }
                if (verdict === "step_limit") {
                  input.assistantMessage.finish = "tool-calls"
                  input.assistantMessage.time.completed = Date.now()
                  await Session.updateMessage(input.assistantMessage)
                  return { status: "continue", terminalFinish: "tool-calls" }
                }
                const verified = await stream.tools.bash.execute(
                  {
                    command:
                      verdict === "mutation"
                        ? "bun test ./arithmetic.test.ts && printf '%s\\n' 'export const answer = 2 + 2' > math.ts"
                        : "bun test ./arithmetic.test.ts",
                    description: "Verify arithmetic",
                  },
                  { toolCallId: "verify", abortSignal: stream.abort, messages: [] },
                )
                expect(verified.metadata.exit).toBe(0)
                if (verdict === "failed_test")
                  HarnessState.pushExecutionLog(childID, {
                    command: "bun test ./broken.test.ts",
                    output: "1 fail",
                    exitCode: 1,
                  })
                const output = {
                  verdict: ["single", "timeout", "cancelled", "mutation", "retry-approved"].includes(verdict)
                    ? "passed"
                    : verdict === "failed_test"
                      ? "inconclusive"
                      : verdict,
                  summary: "Independent check",
                  findings:
                    verdict === "rejected"
                      ? [
                          {
                            file: "math.ts",
                            startLine: 1,
                            endLine: 1,
                            severity: "P1",
                            confidence: 1,
                            title: "Answer must be computed",
                            evidence: "export const answer = 4",
                            recommendation: "Compute the answer",
                          },
                        ]
                      : [],
                }
                await Session.updatePart({
                  id: Identifier.ascending("part"),
                  sessionID: input.assistantMessage.sessionID,
                  messageID: input.assistantMessage.id,
                  type: "text",
                  text: `<structured_output>${JSON.stringify(output)}</structured_output>`,
                })
                input.assistantMessage.finish = "stop"
                input.assistantMessage.time.completed = Date.now()
                await Session.updateMessage(input.assistantMessage)
                if (verdict === "timeout") {
                  passingReviewFinished = true
                  fireReviewerTimeouts()
                }
                return { status: "continue", terminalFinish: "stop" }
              },
            }) as never,
        )
        try {
          const result = await SessionPrompt._internals.resolveCompletion({
            sessionID: root.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
            allowRetry: recovery,
          })
          const completed = ["single", "passed", "retry-approved"].includes(verdict)
          expect(children).toHaveLength(recovery ? (completed ? 1 : 0) : verdict === "single" ? 1 : 2)
          if (recovery) {
            expect(permissionRequests).toBe(1)
            expect(dispatches).toBe(verdict === "retry-approved" ? 4 : verdict === "retry-exhausted" ? 6 : 3)
          }
          expect(result).toBe(completed ? "committed" : "blocked")
          expect(HarnessState.getEditedFiles(root.id)).toEqual(completed ? [] : ["math.ts"])
          expect(HarnessState.getReviewerSession(root.id)).toBeUndefined()
          expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
            lifecycle: "terminal",
            outcome: completed ? "completed" : "blocked",
          })
          expect(ExecutionRuntime.completion(execution.executionID)).toMatchObject({
            state: "committed",
            projection: "projected",
          })
          if (["inconclusive", "timeout", "cancelled", "step_limit"].includes(verdict)) {
            expect(recordedReviews).toHaveBeenCalledWith(expect.objectContaining({ state: "inconclusive" }))
            const messages = await Session.messages({ sessionID: root.id, excludePatches: true })
            expect(
              messages
                .flatMap((message) => message.parts)
                .some((part) => part.type === "text" && part.text.includes("Independent review could not run:")),
            ).toBe(true)
          }
          expect(ExecutionRuntime.allowance(execution.executionID)).toEqual(before)
          expect(ExecutionRuntime.checkpoints(execution.executionID)).toHaveLength(0)
          expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.noProgressSlices ?? 0).toBe(0)
          if (verdict === "timeout") {
            expect(SubAgent.status(children[0]).status).toBe("completed")
            expect(SubAgent.status(children[1]).status).toBe("cancelled")
          }
          if (verdict === "step_limit") {
            const reviewer = (await Agent.get("reviewer"))!
            expect([...turns.values()]).toEqual(
              Array(2).fill(Math.min(reviewer.steps ?? Infinity, ReviewPolicy.MAX_REVIEW_STEPS)),
            )
          }
          ExecutionRuntime.finishInvocation(execution, "completed")
          expect(ExecutionRuntime.snapshot(root.id).activeInvocations).toHaveLength(0)
        } finally {
          processor.mockRestore()
          modelLookup.mockRestore()
          recordedReviews.mockRestore()
          evaluations.mockRestore()
          timer.mockRestore()
          spawn.mockRestore()
          unsubscribe()
        }
      },
    })
  },
  20_000,
)
