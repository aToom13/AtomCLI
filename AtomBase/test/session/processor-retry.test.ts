import { afterEach, describe, expect, spyOn, test } from "bun:test"
import "../preload"
import { Config } from "@/core/config/config"
import { AgentEval } from "@/core/eval/harness"
import { MessageV2 } from "@/core/session/message-v2"
import { LLM } from "@/core/session/llm"
import { Session } from "@/core/session"
import { SessionProcessor } from "@/core/session/processor"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Provider } from "@/integrations/provider/provider"
import { ModelVerification } from "@/integrations/provider/verification"
import { ModelAvailability } from "@/integrations/provider/availability"
import { ModelFallback } from "@/integrations/provider/fallback"
import { SessionRetry } from "@/core/session/retry"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const spies: Array<{ mockRestore(): void }> = []

afterEach(() => {
  for (const item of spies.splice(0)) item.mockRestore()
})

describe("session processor retry budget", () => {
  test("retries the primary once before switching to a fallback", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = {
      id: "primary",
      providerID: "test-provider",
      limit: { context: 100_000, output: 4_000 },
      cost: { input: 0, output: 0 },
    } as Provider.Model
    const fallback = { ...model, id: "fallback", providerID: "fallback-provider" }
    const assistantMessage = {
      id: "msg_fallback_retry",
      sessionID: "ses_fallback_retry",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant
    const fullStream = (async function* () {
      yield { type: "text-start", id: "text-1" }
      yield { type: "text-delta", id: "text-1", text: "OK" }
      yield { type: "text-end", id: "text-1" }
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }
      yield { type: "finish" }
    })()
    const stream = spyOn(LLM, "stream")
      .mockRejectedValueOnce(new Error("temporary rate limit"))
      .mockRejectedValueOnce(new Error("temporary rate limit"))
      .mockResolvedValueOnce({ fullStream } as any)
    spies.push(stream)
    spies.push(spyOn(Config, "get").mockResolvedValue({ experimental: { chatMaxRetries: 2 } } as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({} as any))
    spies.push(spyOn(AgentEval, "allowsModelFallback").mockReturnValue(true))
    spies.push(spyOn(SessionRetry, "sleep").mockResolvedValue(undefined))
    spies.push(
      spyOn(MessageV2, "fromError").mockResolvedValue(
        new MessageV2.APIError({ message: "temporary rate limit", statusCode: 429, isRetryable: true }).toObject(),
      ),
    )
    spies.push(spyOn(ModelFallback, "getDynamicFallbackModels").mockResolvedValue(["fallback-provider/fallback"]))
    spies.push(spyOn(Provider, "getModel").mockResolvedValue(fallback))
    spies.push(spyOn(Provider, "isRouteEligible").mockResolvedValue(true))
    spies.push(spyOn(ModelAvailability, "active").mockReturnValue(undefined))
    spies.push(spyOn(Provider, "getProvider").mockResolvedValue(undefined))
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    spies.push(spyOn(Session, "updatePart").mockImplementation((async (part: any) => part) as any))
    spies.push(spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        const result = await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "reasoning",
                    text: "thinking",
                    providerOptions: { openai: { itemId: "rs_foreign" } },
                  },
                ],
              },
            ],
            tools: {},
            model,
          },
          { enableAmendments: false },
        )

        expect(result.fallbackModel?.id).toBe("fallback")
        expect(stream).toHaveBeenCalledTimes(3)
        expect(JSON.stringify(stream.mock.calls[2][0].messages)).not.toContain("providerOptions")
      },
    })
  })

  test("does not poison model verification with a local execution-budget rejection", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = { id: "budget-model", providerID: "test-provider" } as Provider.Model
    const assistantMessage = {
      id: "msg_budget_rejection",
      sessionID: "ses_budget_rejection",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant
    const rejection = new ExecutionRuntime.BudgetExceededError("call_limit", "exec-test")
    const stream = spyOn(LLM, "stream").mockRejectedValue(rejection)
    spies.push(stream)
    spies.push(spyOn(Config, "get").mockResolvedValue({ experimental: { chatMaxRetries: 2 } } as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({} as any))
    spies.push(
      spyOn(MessageV2, "fromError").mockResolvedValue(
        new MessageV2.APIError({ message: rejection.message, statusCode: 429, isRetryable: true }).toObject(),
      ),
    )
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    spies.push(spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any))
    const observe = spyOn(ModelVerification, "observe").mockResolvedValue(undefined as any)
    spies.push(observe)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [],
            tools: {},
            model,
          },
          { enableAmendments: false },
        )
      },
    })

    expect(observe).not.toHaveBeenCalled()
    expect(stream).toHaveBeenCalledTimes(1)
  })

  test("does not call the model again after the retry budget is exhausted", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = {
      id: "retry-test-model",
      providerID: "test-provider",
    } as Provider.Model
    const assistantMessage = {
      id: "msg_retry_budget",
      sessionID: "ses_retry_budget",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant
    const retryError = new MessageV2.APIError({
      message: "temporary rate limit",
      statusCode: 429,
      isRetryable: true,
    }).toObject()

    const stream = spyOn(LLM, "stream").mockRejectedValue(new Error("fake retryable failure"))
    spies.push(stream)
    spies.push(spyOn(Config, "get").mockResolvedValue({ experimental: { chatMaxRetries: 0 } } as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({ maxRetries: undefined } as any))
    spies.push(spyOn(MessageV2, "fromError").mockResolvedValue(retryError))
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    spies.push(spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        const result = await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [],
            tools: {},
            model,
          },
          { enableAmendments: false },
        )

        expect(result.status).toBe("stop")
        expect(stream).toHaveBeenCalledTimes(1)
        expect(assistantMessage.time.completed).toBeNumber()
        expect(assistantMessage.error).toEqual(retryError)
      },
    })
  })

  test("keeps tool-producing turns non-terminal when provider reports stop", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = {
      id: "tool-stop-model",
      providerID: "test-provider",
      limit: { context: 100_000, output: 4_000 },
      cost: { input: 0, output: 0 },
    } as Provider.Model
    const assistantMessage = {
      id: "msg_tool_stop",
      sessionID: "ses_tool_stop",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant
    const fullStream = (async function* () {
      yield { type: "tool-input-start", id: "call-1", toolName: "read" }
      yield { type: "tool-call", toolCallId: "call-1", toolName: "read", input: { filePath: "src/index.ts" } }
      yield {
        type: "tool-result",
        toolCallId: "call-1",
        input: { filePath: "src/index.ts" },
        output: { title: "src/index.ts", output: "contents", metadata: {} },
      }
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }
      yield { type: "finish" }
    })()
    spies.push(spyOn(LLM, "stream").mockResolvedValue({ fullStream } as any))
    spies.push(spyOn(Config, "get").mockResolvedValue({} as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({} as any))
    spies.push(spyOn(Provider, "getProvider").mockResolvedValue(undefined))
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    const updatePart = spyOn(Session, "updatePart").mockImplementation((async (part: any) => part.part ?? part) as any)
    spies.push(updatePart)
    const updateMessage = spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any)
    spies.push(updateMessage)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        const result = await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [],
            tools: {},
            model,
          },
          { enableAmendments: false, deferText: true },
        )

        expect(result.status).toBe("continue")
        expect(assistantMessage.finish).toBe("tool-calls")
        expect(
          updatePart.mock.calls.some(
            (call) => (call[0] as any).type === "step-finish" && (call[0] as any).reason === "tool-calls",
          ),
        ).toBe(true)
        expect(updateMessage.mock.calls.some((call) => (call[0] as any).finish === "tool-calls")).toBe(true)
      },
    })
  })

  test("keeps terminal text private when the caller requests a review spool", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = {
      id: "spool-model",
      providerID: "test-provider",
      limit: { context: 100_000, output: 4_000 },
      cost: { input: 0, output: 0 },
    } as Provider.Model
    const assistantMessage = {
      id: "msg_review_spool",
      sessionID: "ses_review_spool",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant

    const fullStream = (async function* () {
      yield { type: "text-start", id: "text-1" }
      yield { type: "text-delta", id: "text-1", text: "Unreviewed completion" }
      yield { type: "text-end", id: "text-1" }
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }
      yield { type: "finish" }
    })()
    spies.push(spyOn(LLM, "stream").mockResolvedValue({ fullStream } as any))
    spies.push(spyOn(Config, "get").mockResolvedValue({} as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({} as any))
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    const updatePart = spyOn(Session, "updatePart").mockImplementation((async (part: any) => part.part ?? part) as any)
    spies.push(updatePart)
    const updateMessage = spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any)
    spies.push(updateMessage)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        const result = await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [],
            tools: {},
            model,
          },
          { enableAmendments: false, deferText: true },
        )

        expect(result.status).toBe("continue")
        expect(result.deferredTextParts?.map((part) => part.text)).toEqual(["Unreviewed completion"])
        expect(updatePart.mock.calls.every((call) => (call[0] as any).type !== "text")).toBe(true)
        expect(updateMessage.mock.calls.every((call) => (call[0] as any).finish === undefined)).toBe(true)
        expect(updateMessage.mock.calls.every((call) => (call[0] as any).time.completed === undefined)).toBe(true)
        expect(assistantMessage.finish).toBe("stop")
      },
    })
  })

  test("captures checkpoint reasoning when the provider omits reasoning-end", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = {
      id: "checkpoint-reasoning-model",
      providerID: "test-provider",
      limit: { context: 100_000, output: 4_000 },
      cost: { input: 0, output: 0 },
    } as Provider.Model
    const assistantMessage = {
      id: "msg_checkpoint_reasoning",
      sessionID: "ses_checkpoint_reasoning",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant
    const checkpoint = JSON.stringify({ decision: "continue", requestedCalls: 10 })
    const fullStream = (async function* () {
      yield { type: "reasoning-start", id: "reasoning-1" }
      yield { type: "reasoning-delta", id: "reasoning-1", text: checkpoint }
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }
      yield { type: "finish" }
    })()
    spies.push(spyOn(LLM, "stream").mockResolvedValue({ fullStream } as any))
    spies.push(spyOn(Config, "get").mockResolvedValue({} as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({} as any))
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    spies.push(spyOn(Session, "updatePart").mockImplementation((async (part: any) => part.part ?? part) as any))
    spies.push(spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        const result = await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [],
            tools: {},
            model,
          },
          { enableAmendments: false, deferText: true, captureCheckpointReasoning: true },
        )

        expect(result.checkpointReasoningCandidates).toEqual([checkpoint])
      },
    })
  })

  test("retries an ended-but-empty stream instead of stopping immediately", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = {
      id: "empty-stream-model",
      providerID: "test-provider",
      limit: { context: 100_000, output: 4_000 },
      cost: { input: 0, output: 0 },
    } as Provider.Model
    const assistantMessage = {
      id: "msg_empty_stream",
      sessionID: "ses_empty_stream",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant
    // Provider closes the stream without text, tool calls, or errors.
    const fullStream = (async function* () {
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      }
      yield { type: "finish" }
    })()
    const stream = spyOn(LLM, "stream").mockResolvedValue({ fullStream } as any)
    spies.push(stream)
    spies.push(spyOn(Config, "get").mockResolvedValue({ experimental: { chatMaxRetries: 2 } } as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowModelFallback: false } as any))
    spies.push(spyOn(SessionRetry, "sleep").mockResolvedValue(undefined))
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    spies.push(spyOn(Session, "updatePart").mockImplementation((async (part: any) => part) as any))
    spies.push(spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any))
    spies.push(spyOn(Provider, "getProvider").mockResolvedValue(undefined))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        const result = await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [],
            tools: {},
            model,
          },
          { enableAmendments: false },
        )

        // Retry transient empty streams, then stop at configured retry exhaustion.
        expect(stream).toHaveBeenCalledTimes(3)
        expect(result.status).toBe("stop")
        expect(assistantMessage.error).toBeDefined()
      },
    })
  })

  test("limits finalization-only empty output to one repair attempt", async () => {
    await using tmp = await tmpdir({ git: true })
    const model = {
      id: "empty-finalization-model",
      providerID: "test-provider",
      limit: { context: 100_000, output: 4_000 },
      cost: { input: 0, output: 0 },
    } as Provider.Model
    const assistantMessage = {
      id: "msg_empty_finalization",
      sessionID: "ses_empty_finalization",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
    } as MessageV2.Assistant
    const stream = spyOn(LLM, "stream").mockImplementation(
      async () =>
        ({
          fullStream: (async function* () {
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
            }
            yield { type: "finish" }
          })(),
        }) as any,
    )
    spies.push(stream)
    spies.push(spyOn(Config, "get").mockResolvedValue({ experimental: { chatMaxRetries: 10 } } as any))
    spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowModelFallback: false } as any))
    spies.push(spyOn(SessionRetry, "sleep").mockResolvedValue(undefined))
    spies.push(spyOn(MessageV2, "parts").mockResolvedValue([]))
    spies.push(spyOn(Session, "updatePart").mockImplementation((async (part: any) => part) as any))
    spies.push(spyOn(Session, "updateMessage").mockImplementation((async (message: any) => message) as any))
    spies.push(spyOn(Provider, "getProvider").mockResolvedValue(undefined))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const processor = SessionProcessor.create({
          assistantMessage,
          sessionID: assistantMessage.sessionID,
          model,
          abort: new AbortController().signal,
        })
        const result = await processor.process(
          {
            user: {} as MessageV2.User,
            agent: {} as any,
            abort: new AbortController().signal,
            sessionID: assistantMessage.sessionID,
            system: [],
            messages: [],
            tools: {},
            model,
            finalizationOnly: true,
          },
          { enableAmendments: false, deferText: true },
        )

        expect(stream).toHaveBeenCalledTimes(2)
        expect(result.status).toBe("stop")
      },
    })
  })
})
