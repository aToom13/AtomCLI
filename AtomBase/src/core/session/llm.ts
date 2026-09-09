import os from "os"
import { Installation } from "@/services/installation"
import { Provider } from "@/integrations/provider/provider"
import { Log } from "@/util/util/log"
import { type ModelMessage, type StreamTextResult, type Tool, type ToolSet } from "ai"
import { clone } from "remeda"
import { ProviderTransform } from "@/integrations/provider/transform"
import { Config } from "@/core/config/config"
import { Instance } from "@/services/project/instance"
import { getExtractReasoningMiddleware, getStreamText, getWrapLanguageModel } from "@/util/util/ai-compat"
import type { Agent } from "@/integrations/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/integrations/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/interfaces/flag/flag"
import { PermissionNext } from "@/util/permission/next"
import { Auth } from "@/services/auth"
import { SessionReplay } from "./replay"
import { ExecutionRuntime } from "@/core/execution/runtime"

export namespace LLM {
  const log = Log.create({ service: "llm" })

  export const OUTPUT_TOKEN_MAX = Flag.ATOMCLI_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    execution?: ExecutionRuntime.Context
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown> & {
    __executionAttempt?: ExecutionRuntime.Attempt
    __verificationParams?: unknown
  }

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg] = await Promise.all([Provider.getLanguage(input.model), Config.get()])

    const system = SystemPrompt.header(input.model.providerID)
    system.push(
      [
        // Always include PromptManager system prompt (core + provider + agent prompts)
        ...SystemPrompt.provider(input.model, input.agent.name),
        // Append agent-specific prompt as additional context (if any)
        ...(input.agent.prompt ? [input.agent.prompt] : []),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    const original = clone(system)
    await Plugin.trigger("experimental.chat.system.transform", { sessionID: input.sessionID }, { system })
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const provider = await Provider.getProvider(input.model.providerID)
    if (!provider) throw new Error(`Provider not found: ${input.model.providerID}`)
    const { params, isCodex } = await LLM.prepareRouteParams({ ...input, provider })

    const maxOutputTokens = isCodex
      ? undefined
      : ProviderTransform.maxOutputTokens(
          input.model.api.npm,
          params.options,
          input.model.limit.output,
          OUTPUT_TOKEN_MAX,
        )

    const tools = input.model.capabilities.toolcall !== false ? await resolveTools(input) : {}
    if (!input.model.capabilities.toolcall) {
      l.info("model does not support tool calls, skipping tools", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })
    }
    const routePolicy = Provider.routePolicy(input.model)
    if (routePolicy.requireVerification) {
      const capabilities: Array<"text" | "tool"> = Object.keys(tools).length ? ["text", "tool"] : ["text"]
      await verifyDispatch(input, params, capabilities)
    }

    const extractReasoningMiddleware = await getExtractReasoningMiddleware()
    const streamText = await getStreamText()
    const wrapLanguageModel = await getWrapLanguageModel()

    const finalMessages = [
      ...(isCodex
        ? [{ role: "user", content: system.join("\n\n") } as ModelMessage]
        : system.map((x): ModelMessage => ({ role: "system", content: x }))),
      ...input.messages,
    ]
    const toolDefinitions = Object.entries(tools).map(([id, definition]) => ({
      id,
      description: definition.description,
      schema: "inputSchema" in definition ? definition.inputSchema : undefined,
    }))
    const envelope = await SessionReplay.record({
      sessionID: input.sessionID,
      system,
      messages: finalMessages,
      tools: toolDefinitions,
      route: { providerID: input.model.providerID, modelID: input.model.id, agent: input.agent.name },
      pluginTransforms: ["experimental.chat.system.transform", "chat.params"],
      injectedContext: input.user.system ? [input.user.system] : [],
    })
    if (process.env.ATOMCLI_TEST === "true") {
      const replayed = await SessionReplay.renderModelInput(input.sessionID, envelope.requestID)
      if (JSON.stringify(replayed.messages) !== JSON.stringify(finalMessages)) {
        throw new Error(`Request replay invariant failed for ${envelope.requestID}`)
      }
    }

    const startTime = Date.now()
    const estimatedOutputTokens = maxOutputTokens ?? Math.min(input.model.limit.output, OUTPUT_TOKEN_MAX)
    const executionAttempt = await ExecutionRuntime.admitModelCall({
      sessionID: input.sessionID,
      purpose: `agent:${input.agent.name}`,
      execution: input.execution,
      estimateMicrousd: ExecutionRuntime.estimateMicrousd(
        input.model,
        JSON.stringify(finalMessages),
        estimatedOutputTokens,
      ),
    })
    const abortSignal = executionAttempt ? AbortSignal.any([input.abort, executionAttempt.signal]) : input.abort
    let result: StreamTextResult<ToolSet, unknown>
    try {
      result = streamText({
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && tools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, params.options),
        activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
        tools,
        maxOutputTokens,
        abortSignal,
        headers: {
          ...(isCodex
            ? {
                originator: "atomcli",
                "User-Agent": `atomcli/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
                session_id: input.sessionID,
              }
            : undefined),
          ...(input.model.providerID.startsWith("atomcli") || input.model.providerID === "opencode"
            ? {
                "x-atomcli-project": Instance.project.id,
                "x-atomcli-session": input.sessionID,
                "x-atomcli-request": input.user.id,
                "x-atomcli-client": Flag.ATOMCLI_CLIENT,
              }
            : undefined),
          ...input.model.headers,
        },
        maxRetries: input.retries ?? 0,
        messages: finalMessages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model)
                }
                return args.params
              },
            },
            // Skip extractReasoningMiddleware for Ollama.
            //
            // Ollama's @ai-sdk/openai-compatible natively converts delta.reasoning →
            // reasoning-start/delta/end events. The middleware's wrapStream intercepts
            // text-start and delays it until text-end arrives (flush). But Ollama sends
            // text-delta events during the stream body — BEFORE the flush. processor.ts's
            // text-delta handler checks `if (currentText)` which is undefined because
            // text-start was delayed → ALL text is silently dropped.
            //
            // For Ollama, the SDK natively handles reasoning, so no middleware needed.
            // For other providers (Claude, GPT, etc.), keep the middleware for <think> tag support.
            ...(input.model.api.npm === "@atomcli/ollama"
              ? []
              : [extractReasoningMiddleware({ tagName: "think", startWithReasoning: false })]),
          ],
        }),
        experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
      })
    } catch (error) {
      executionAttempt?.uncertain()
      const { ModelVerification } = await import("@/integrations/provider/verification")
      await ModelVerification.observe(
        input.model,
        provider,
        Object.keys(tools).length ? ["text", "tool"] : ["text"],
        error,
        { variant: input.user.variant, effectiveParams: params },
      )
      throw error
    }

    if (result && result.text) {
      result.text.then(
        () => {
          const latency = Date.now() - startTime
          import("@/integrations/tool/model-router")
            .then(({ recordCallResult }) => {
              recordCallResult(input.model.id, true, latency, input.model.providerID)
            })
            .catch(() => {})
        },
        () => {
          import("@/integrations/tool/model-router")
            .then(({ recordCallResult }) => {
              recordCallResult(input.model.id, false, undefined, input.model.providerID)
            })
            .catch(() => {})
        },
      )
    }

    return Object.assign(result, { __executionAttempt: executionAttempt, __verificationParams: params })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }
}

export namespace LLM {
  export async function verifyDispatch(
    input: Pick<StreamInput, "model" | "sessionID" | "abort" | "execution">,
    params: Awaited<ReturnType<typeof prepareRouteParams>>["params"],
    capabilities: Array<"text" | "tool">,
  ) {
    const policy = Provider.routePolicy(input.model)
    if (!policy.requireVerification) return
    const config = await Config.get()
    const paidProbes =
      policy.mode === "explicit" ||
      (policy.mode === "auto" &&
        config.experimental?.auto_router?.allow_paid_models === true &&
        config.experimental?.auto_router?.allow_paid_probes === true)
    const { ModelFallback } = await import("@/integrations/provider/fallback")
    const deadline = Date.now() + 30_000
    for (const capability of capabilities) {
      const context = { effectiveParams: params }
      if (await Provider.isRouteEligible(input.model, policy, capability, context)) continue
      // Tools are resolved after alias selection. Verify missing capability or
      // changed plugin parameters here, without relaxing any route restriction.
      if (
        (!Provider.isExplicitlyFree(input.model) && !paidProbes) ||
        !(await Provider.isRouteEligible(input.model, { ...policy, requireVerification: false }, capability, context))
      )
        throw new Error("The selected route is not eligible for dispatch verification")
      const remaining = deadline - Date.now()
      if (remaining > 0) {
        await ModelFallback.probeModels([`${input.model.providerID}/${input.model.id}`], {
          capability,
          effectiveParams: params,
          variant: policy.variant,
          sessionID: input.sessionID,
          signal: input.abort,
          execution: input.execution,
          timeoutMs: Math.min(15_000, remaining),
          totalTimeoutMs: remaining,
        })
      }
      if (!(await Provider.isRouteEligible(input.model, policy, capability, context))) {
        throw new Error("The selected route could not be verified for its effective dispatch parameters")
      }
    }
  }

  export async function prepareRouteParams(input: {
    model: Provider.Model
    sessionID: string
    agent: Agent.Info
    user: MessageV2.User
    provider: Provider.Info
    small?: boolean
  }) {
    const auth = await Auth.get(input.model.providerID)
    const isCodex = input.provider.id === "openai" && auth?.type === "oauth"
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options(input.model, input.sessionID, input.provider.options)
    const options: Record<string, any> = ProviderTransform.applyVariant(
      input.model,
      input.user.variant,
      base,
      input.model.options,
      input.agent.options,
      input.small,
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
      options.store = false
    }
    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider: Provider.getProvider(input.model.providerID),
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )
    if (input.model.providerID.startsWith("atomcli") || input.model.providerID === "opencode")
      params.options.store = false
    return { params, isCodex }
  }
}
