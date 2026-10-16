import "../preload"
import { expect, spyOn, test } from "bun:test"
import { AgentEval } from "@/core/eval/harness"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { SessionProcessor } from "@/core/session/processor"
import { LLM } from "@/core/session/llm"
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
import { SubAgent } from "@/integrations/tool/subagent"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("coder checkpoint finish publishes once and leaves the root execution active", async () => {
  await using project = await tmpdir({ git: true, config: { experimental: { execution_classification: false } } })
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
          scope: "coordinated",
          risk: "low",
          confidence: 1,
          needsMutation: true,
        }),
      )
      ExecutionRuntime.requestCheckpoint(execution.executionID)
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const agent = (await Agent.get("coder"))!
      let calls = 0
      const evaluation = spyOn(AgentEval, "executionPolicy").mockReturnValue({
        allowAuxiliarySummaries: false,
      } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(_stream, options) {
              if (++calls > 1) throw new Error("Child repeated its finished checkpoint")
              expect(options.deferText).toBe(true)
              expect(options.captureCheckpointReasoning).toBe(true)
              await Session.updateMessage({ ...input.assistantMessage, finish: undefined })
              return {
                status: "continue",
                terminalFinish: "stop",
                deferredTextParts: [
                  {
                    id: Identifier.ascending("part"),
                    sessionID: input.assistantMessage.sessionID,
                    messageID: input.assistantMessage.id,
                    type: "text",
                    text: JSON.stringify({
                      ...ExecutionCheckpoint.conservativeContinue(),
                      decision: "finish",
                      requestedCalls: undefined,
                      completedWork: ["Implemented and checked the module"],
                      failures: [],
                      remainingWork: [],
                      blockers: [],
                      finalResponse: "Module implemented; verification passed.",
                    }),
                  },
                ],
              }
            },
          }) as never,
      )
      try {
        const result = await SubAgent.spawn({
          parentSessionID: root.id,
          agent,
          model: { providerID: model.providerID, modelID: model.id },
          permissions: SubAgent.buildFromAgent(agent),
          description: "Finish checkpoint",
          parts: [{ type: "text", text: "Implement the module" }],
        })
        expect(result.output).toBe("Module implemented; verification passed.")
        expect(calls).toBe(1)
        expect(ExecutionRuntime.checkpoints(execution.executionID)).toHaveLength(1)
        expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).toBe("active")
        expect(ExecutionRuntime.snapshot(root.id).activeInvocations).toHaveLength(1)
        const messages = await Session.messages({ sessionID: result.sessionId })
        await AgentEval.recordSession(result.sessionId, messages)
        const final = messages.findLast((message) => message.info.role === "assistant")!
        expect(final.info).toMatchObject({ finish: "stop" })
        expect(final.parts.filter((part) => part.type === "text")).toHaveLength(1)
      } finally {
        processor.mockRestore()
        evaluation.mockRestore()
      }
    },
  })
}, 20_000)

test.each(["timeout", "cancel", "root"])(
  "native %s stops streaming and preserves terminal state",
  async (mode) => {
    await using project = await tmpdir({ config: { experimental: { execution_classification: false } } })
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
        const agent = (await Agent.get("coder"))!
        const started = Promise.withResolvers<void>()
        const releaseSibling = Promise.withResolvers<void>()
        const stopped = new Set<string>()
        const children = new Map<string, string>()
        const invocations = new Map<string, string>()
        let streaming = 0
        const evaluation = spyOn(AgentEval, "executionPolicy").mockReturnValue({
          allowAuxiliarySummaries: false,
          maxRetries: 0,
        } as never)
        const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
          const target = children.get("target") === input.sessionID
          return {
            fullStream: (async function* () {
              if (++streaming === 2) started.resolve()
              try {
                if (target || mode === "root") {
                  await new Promise<never>((_, reject) => {
                    input.abort.throwIfAborted()
                    input.abort.addEventListener("abort", () => reject(input.abort.reason), { once: true })
                  })
                }
                await releaseSibling.promise
                input.abort.throwIfAborted()
                yield { type: "text-start", id: "sibling" }
                yield { type: "text-delta", id: "sibling", text: "Sibling completed" }
                yield { type: "text-end", id: "sibling" }
                yield {
                  type: "finish-step",
                  finishReason: "stop",
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                }
                yield { type: "finish" }
              } finally {
                stopped.add(input.sessionID)
              }
            })(),
          } as never
        })
        const spawn = (name: string) =>
          SubAgent.spawn({
            parentSessionID: root.id,
            agent,
            model: { providerID: model.providerID, modelID: model.id },
            permissions: SubAgent.buildFromAgent(agent),
            description: name,
            parts: [{ type: "text", text: "Inspect independently" }],
            ...(mode === "timeout" && name === "target" ? { executionTimeoutMs: 3000 } : {}),
            onSession: ({ sessionId }) => {
              children.set(name, sessionId)
            },
            onInvocation: (invocationID) => {
              invocations.set(name, invocationID)
            },
          })
        const target = spawn("target")
        const sibling = spawn("sibling")
        const settled = Promise.allSettled([target, sibling])
        try {
          await started.promise
          if (mode === "root") ExecutionRuntime.cancelExecution(execution)
          if (mode === "cancel") await SubAgent.cancel(children.get("target")!)
          if (mode !== "root") {
            await expect(target).rejects.toThrow(
              mode === "timeout" ? "Sub-agent execution timed out" : "Sub-agent cancelled",
            )
            expect(ExecutionRuntime.invocation(invocations.get("sibling")!)?.state).toBe("running")
            expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).toBe("active")
            releaseSibling.resolve()
          }
          const results = await settled
          expect(results[0].status).toBe("rejected")
          expect(results[1].status).toBe(mode === "root" ? "rejected" : "fulfilled")
          expect(ExecutionRuntime.invocation(invocations.get("target")!)?.state).toBe(
            mode === "timeout" ? "failed" : "cancelled",
          )
          expect(ExecutionRuntime.invocation(invocations.get("sibling")!)?.state).toBe(
            mode === "root" ? "cancelled" : "completed",
          )
          expect(SubAgent.status(children.get("target")!).status).toBe(mode === "timeout" ? "timed_out" : "cancelled")
          expect(stopped.has(children.get("target")!)).toBe(true)
          expect(stopped.has(children.get("sibling")!)).toBe(true)
          if (mode === "timeout")
            expect(ExecutionRuntime.blocker(`child:${invocations.get("target")}`)?.resolutionCode).toBe("deadline")
          expect(ExecutionRuntime.checkpoints(execution.executionID)).toHaveLength(0)
        } finally {
          releaseSibling.resolve()
          for (const sessionID of children.values()) await SubAgent.cancel(sessionID)
          await settled
          stream.mockRestore()
          evaluation.mockRestore()
        }
      },
    })
  },
  20_000,
)

test("real ledger watchdog excludes the caller and siblings, bounds unchanged finish checkpoints", async () => {
  await using project = await tmpdir({ config: { experimental: { execution_classification: false } } })
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      const execution = await ExecutionRuntime.resolveInvocation({
        sessionID: root.id,
        invocationID: Identifier.ascending("message"),
      })
      ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("watchdog"))
      const child = await Session.create({ parentID: root.id })
      const sibling = await Session.create({ parentID: root.id })
      await ExecutionRuntime.inheritSession(root.id, child.id)
      await ExecutionRuntime.inheritSession(root.id, sibling.id)
      const childExecution = await ExecutionRuntime.resolveInvocation({
        sessionID: child.id,
        invocationID: Identifier.ascending("message"),
      })
      await ExecutionRuntime.resolveInvocation({ sessionID: sibling.id, invocationID: Identifier.ascending("message") })
      const finish = ExecutionCheckpoint.Result.parse({
        ...ExecutionCheckpoint.conservativeContinue(),
        decision: "finish",
        requestedCalls: undefined,
        finalResponse: "No additional tools have run.",
      })
      for (let index = 0; index <= ExecutionCheckpoint.MAX_NO_PROGRESS_SLICES; index++) {
        const result = ExecutionRuntime.reconcileCheckpoint(
          execution.executionID,
          finish,
          child.id,
          childExecution.invocationID,
        )
        expect(result.decision).toBe(index < ExecutionCheckpoint.MAX_NO_PROGRESS_SLICES ? "finish" : "blocked")
        ExecutionRuntime.applyCheckpoint(execution.executionID, `child-checkpoint-${index}`, result, undefined, {
          invocationID: childExecution.invocationID,
          triggerMessageID: childExecution.invocationID,
        })
      }
      const checkpoints = ExecutionRuntime.checkpoints(execution.executionID)
      expect(checkpoints.at(-1)?.payload.evidence.noProgressSlices).toBe(3)
      expect(checkpoints.at(-1)?.payload.invocationID).toBe(childExecution.invocationID)
      expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).toBe("active")
    },
  })
})
