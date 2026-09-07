import z from "zod"
import { Tool } from "./tool"
import { Provider } from "@/integrations/provider/provider"
import { ModelVerification } from "@/integrations/provider/verification"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { AdaptivePolicy } from "@/core/routing/adaptive-policy"
import { Config } from "@/core/config/config"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import { LLM } from "@/core/session/llm"
import { Agent } from "@/integrations/agent/agent"
import { AgentEval } from "@/core/eval/harness"

export namespace ModelControl {
  export const Info = Tool.define("model_control", {
    description:
      "Manage this conversation's model and thinking level. Use list to discover connected model IDs (query filters names), then request to propose a switch with a reason. Use this tool, NOT grep, shell or config edits, when the user asks to change the current model. You may also recommend a better model for difficult work. A request is NOT an applied switch: the runtime waits for approval and verifies the target before the next model call. scope=model changes the conversation selection; expert is a bounded read-only episode; thinking changes reasoning effort. Never claim a pending request succeeded. Do not repeat a rejected request without new user direction.",
    parameters: z.object({
      action: z.enum(["list", "request"]),
      query: z.string().max(200).optional(),
      providerID: z.string().optional(),
      modelID: z.string().optional(),
      variant: z.string().optional(),
      scope: z.enum(["model", "expert", "thinking"]).default("model"),
      reason: z.string().max(1000).optional(),
    }),
    async execute(args, ctx): Promise<{ title: string; output: string; metadata: { proposalID?: string } }> {
      const session = await Session.get(ctx.sessionID)
      if (session.parentID) throw new Error("Only the main conversation may request a model switch")
      if (args.action === "list") {
        const query = args.query?.toLowerCase() ?? ""
        const models = Object.values(await Provider.list()).flatMap((provider) =>
          Object.values(provider.models)
            .filter((model) => `${provider.id}/${model.id} ${model.name}`.toLowerCase().includes(query))
            .map((model) => ({
              providerID: provider.id,
              modelID: model.id,
              name: model.name,
              variants: Object.keys(model.variants ?? {}),
              free: Provider.isExplicitlyFree(model),
            })),
        )
        return {
          title: "Connected models",
          output: JSON.stringify({ models: models.slice(0, 80), total: models.length }),
          metadata: {},
        }
      }
      if (!args.providerID || !args.modelID || !args.reason?.trim())
        throw new Error("request requires providerID, modelID and a reason; use list to find exact IDs")
      const execution = ctx.extra?.execution as ExecutionRuntime.Context | undefined
      if (!execution) throw new Error("Model switching requires an active execution")
      const view = ExecutionRuntime.view(execution.executionID)
      if (!view) throw new Error("Execution is no longer active")
      const settings = AdaptivePolicy.withDefaults((await Config.get()).adaptive_routing)
      const benchmarkRouting = AgentEval.benchmarkRoutingMode(ctx.sessionID)
      if (benchmarkRouting && benchmarkRouting !== "adaptive")
        throw new Error("This benchmark uses a fixed model route")
      const benchmarkExpert = AgentEval.benchmarkContext(ctx.sessionID)?.expertModel
      if (benchmarkRouting === "adaptive" && benchmarkExpert) settings.expert_models = [benchmarkExpert]
      if (settings.mode === "off") throw new Error("Adaptive routing is off; enable ask or auto in model settings")
      if (args.scope === "thinking" && settings.thinking.mode === "off") throw new Error("Thinking proposals are off")
      const message = await MessageV2.get({ sessionID: ctx.sessionID, messageID: execution.invocationID })
      if (message.info.role !== "user") throw new Error("Model switching requires a user invocation")
      const user = { ...message.info, variant: args.variant }
      const agent = await Agent.get(ctx.agent)
      const alias = args.providerID === "atomcli" && ["atomcli-auto", "atomcli-free"].includes(args.modelID)
      const target = await Provider.getModel(
        args.providerID,
        args.modelID,
        alias
          ? {
              session,
              prompt: args.reason,
              verify: true,
              signal: ctx.abort,
              execution,
              agent,
              user,
              variant: args.variant,
            }
          : undefined,
      )
      if (args.variant && !target.variants?.[args.variant])
        throw new Error("Target does not support this thinking level")
      const active = view.route?.active ?? { ...message.info.model, variant: message.info.variant }
      if (args.scope === "expert" && (view.route?.manualModelPin ?? message.info.modelPinned))
        throw new Error("The user pinned this model; request a conversation model change for approval")
      if (args.scope === "thinking" && (view.route?.manualThinkingPin ?? message.info.thinkingPinned))
        throw new Error("The user pinned the thinking level")
      if (args.scope === "expert" && !settings.expert_models.includes(`${target.providerID}/${target.id}`))
        throw new Error(
          "Expert target is not in adaptive_routing.expert_models; request a conversation model change for approval",
        )
      const current = ctx.extra?.model as Provider.Model | undefined
      if (args.scope === "thinking" && (current?.providerID !== target.providerID || current?.id !== target.id))
        throw new Error("A thinking-only request must keep the current model")
      if (!target.capabilities.toolcall || !target.capabilities.input.text || !target.capabilities.output.text)
        throw new Error("The target must support text and tool calls")
      if (
        ExecutionRuntime.routeProposalHistory(execution.executionID).some(
          (proposal) =>
            proposal.invocationID === execution.invocationID &&
            proposal.toRoute.providerID === target.providerID &&
            proposal.toRoute.modelID === target.id &&
            proposal.toRoute.variant === args.variant &&
            ["pending", "accepted", "rejected", "expired", "applied"].includes(proposal.state),
        )
      )
        throw new Error("This route was already requested in this user turn; respect its decision and do not repeat it")
      const policy = Provider.routePolicy(ctx.extra?.model ?? target)
      if (args.scope !== "model" && policy.freeOnly && !Provider.isExplicitlyFree(target))
        throw new Error(
          "Free routing cannot automatically escalate to a paid model; request a model switch for approval",
        )
      const provider = await Provider.getProvider(target.providerID)
      if (!provider) throw new Error("Target provider is not connected")
      const params = (await LLM.prepareRouteParams({ model: target, provider, agent, user, sessionID: ctx.sessionID }))
        .params
      const paramsDigest = await ModelVerification.paramsDigest(params)
      const credentialRevision = await ModelVerification.identity(target, provider, {
        variant: args.variant,
        effectiveParams: params,
      })
      const result = await ExecutionRuntime.proposeRoute({
        id: crypto.randomUUID(),
        sessionID: ctx.sessionID,
        execution,
        executionID: execution.executionID,
        invocationID: execution.invocationID,
        stepID: ctx.messageID,
        expectedRouteRevision: view.routeRevision,
        fromRoute: active,
        toRoute: { providerID: target.providerID, modelID: target.id, variant: args.variant },
        paramsDigest,
        credentialRevision,
        scope: args.scope,
        reasonCode: args.scope === "model" ? "explicit_user_request" : "model_recommendation",
        evidenceRefs: [
          `reason:${args.reason}`,
          ...(alias ? [`requested-route:${args.providerID}/${args.modelID}`] : []),
        ],
        uncertainty: true,
        expiresAt: Date.now() + settings.proposal_ttl_ms,
        policyVersion: 1,
        autoAccept: (args.scope === "thinking" ? settings.thinking.mode : settings.mode) === "auto",
        manualModelPin: message.info.modelPinned,
        manualThinkingPin: message.info.thinkingPinned,
      })
      if (!result.proposed) throw new Error(`Model change request failed: ${result.reason}`)
      return {
        title: "Model change requested",
        output: `Route proposal ${result.proposal.id}: ${result.proposal.state}. The runtime will wait for approval and apply the verified route before continuing.`,
        metadata: { proposalID: result.proposal.id },
      }
    },
  })
}
