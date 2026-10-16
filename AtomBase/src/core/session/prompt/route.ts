import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { Config } from "@/core/config/config"
import { Provider } from "@/integrations/provider/provider"
import { Agent } from "@/integrations/agent/agent"
import type { MessageV2 } from "@/core/session/message-v2"
import type { ExecutionRuntime } from "@/core/execution/runtime"
import type { PromptCompletion } from "./completion"

type RouteInput = {
  msgs: MessageV2.WithParts[]
  lastUser: MessageV2.User
  executionContext: ExecutionRuntime.Context
  activeVariant?: string
  activeModel?: Provider.Model
  fallbackActive: boolean
  sessionID: string
  abort: AbortSignal
  RouteRuntime: typeof ExecutionRuntime
  recordModelResolutionError: typeof PromptCompletion.recordModelResolutionError
  projectAndAckCompletion: typeof PromptCompletion.projectAndAckCompletion
  returnExpertHandoff: typeof PromptCompletion.returnExpertHandoff
}

export async function resolveRouteAndExpert(input: RouteInput) {
  const {
    msgs,
    lastUser,
    executionContext,
    activeVariant: initialVariant,
    activeModel: initialModel,
    fallbackActive: initialFallback,
    sessionID,
    abort,
    RouteRuntime,
    recordModelResolutionError,
    projectAndAckCompletion,
    returnExpertHandoff,
  } = input
  let activeVariant = initialVariant
  let activeModel = initialModel
  let fallbackActive = initialFallback
  const routingPrompt = msgs
    .findLast((message) => message.info.id === lastUser.id)
    ?.parts.filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text)
    .join("\n")
  const executionView = RouteRuntime.view(executionContext.executionID)
  let activeRoute = executionView?.route?.active ?? {
    providerID: lastUser.model.providerID,
    modelID: lastUser.model.modelID,
    variant: activeVariant ?? lastUser.variant,
  }
  const acceptedProposal = RouteRuntime.snapshot(executionContext.rootSessionID).pendingProposals.find(
    (proposal) =>
      proposal.executionID === executionContext.executionID &&
      proposal.invocationID === executionContext.invocationID &&
      proposal.state === "accepted",
  )
  if (acceptedProposal) {
    try {
      const target = await Provider.getModel(
        acceptedProposal.toRoute.providerID,
        acceptedProposal.toRoute.modelID,
      ).catch(() => undefined)
      if (target) {
        const { LLM } = await import("@/core/session/llm")
        const inheritedPolicy = Provider.routePolicy(activeModel ?? target)
        const explicitRequest = acceptedProposal.scope === "model"
        const requestedAlias = acceptedProposal.evidenceRefs
          .find((ref) => ref.startsWith("requested-route:"))
          ?.slice(16)
        const autoRouter = (await Config.get()).experimental?.auto_router
        const routePolicy: Provider.RoutePolicy = {
          requested: requestedAlias ?? `${acceptedProposal.toRoute.providerID}/${acceptedProposal.toRoute.modelID}`,
          mode: requestedAlias?.endsWith("/atomcli-free")
            ? "free"
            : requestedAlias
              ? "auto"
              : explicitRequest
                ? "explicit"
                : "auto",
          allowedProviders: requestedAlias
            ? (autoRouter?.allowed_providers ?? [target.providerID])
            : [target.providerID],
          excluded: requestedAlias
            ? (autoRouter?.excluded_models ?? [])
            : explicitRequest
              ? []
              : inheritedPolicy.excluded,
          requiredCapabilities: ["text", "tool"],
          freeOnly: requestedAlias
            ? requestedAlias.endsWith("/atomcli-free") || !autoRouter?.allow_paid_models
            : explicitRequest
              ? false
              : inheritedPolicy.freeOnly || lastUser.model.modelID === "atomcli-free",
          requireVerification: true,
          variant: acceptedProposal.toRoute.variant,
        }
        const { ModelVerification } = await import("@/integrations/provider/verification")
        const targetProvider = await Provider.getProvider(target.providerID)
        if (!targetProvider) throw new Error(`Provider not found: ${target.providerID}`)
        const targetUser = { ...lastUser, variant: acceptedProposal.toRoute.variant }
        const targetParams = (
          await LLM.prepareRouteParams({
            model: target,
            provider: targetProvider,
            agent: await Agent.get(lastUser.agent),
            user: targetUser,
            sessionID,
          })
        ).params
        const paramsDigest = await ModelVerification.paramsDigest(targetParams)
        if (paramsDigest !== acceptedProposal.paramsDigest)
          throw new Error("Model change parameters changed after approval; request approval again")
        const identity = await ModelVerification.identity(target, targetProvider, {
          variant: acceptedProposal.toRoute.variant,
          effectiveParams: targetParams,
        })
        if (identity !== acceptedProposal.credentialRevision)
          throw new Error("Model credentials changed after approval; request approval again")
        const verifiedTarget = Provider.applyRoutePolicy(target, routePolicy)
        const dispatchCapabilities = routePolicy.requiredCapabilities.filter(
          (capability): capability is "text" | "tool" => capability === "text" || capability === "tool",
        )
        await LLM.verifyDispatch(
          { model: verifiedTarget, sessionID, abort, execution: executionContext },
          targetParams,
          dispatchCapabilities,
        )
        const eligible = await Promise.all(
          routePolicy.requiredCapabilities.map((capability) =>
            Provider.isRouteEligible(target, routePolicy, capability, { effectiveParams: targetParams }),
          ),
        )
        if (eligible.every(Boolean) && paramsDigest === acceptedProposal.paramsDigest) {
          const applied = await RouteRuntime.applyRouteProposal({
            sessionID,
            execution: executionContext,
            proposalID: acceptedProposal.id,
            executionID: executionContext.executionID,
            invocationID: executionContext.invocationID,
            expectedProposalVersion: acceptedProposal.version,
            expectedRouteRevision: acceptedProposal.routeRevision,
            paramsDigest,
            expertLimits:
              acceptedProposal.scope === "expert"
                ? {
                    maxEpisodes: (await Config.get()).adaptive_routing?.max_expert_episodes ?? 2,
                    maxCalls: (await Config.get()).adaptive_routing?.max_expert_calls ?? 3,
                    maxSteps: (await Config.get()).adaptive_routing?.max_expert_steps ?? 3,
                  }
                : undefined,
          })
          if (applied.applied) {
            activeRoute = acceptedProposal.toRoute
            activeModel = verifiedTarget
            fallbackActive = false
            if (acceptedProposal.scope !== "expert") {
              if (acceptedProposal.scope === "model")
                lastUser.model = requestedAlias
                  ? { providerID: "atomcli", modelID: requestedAlias.slice("atomcli/".length) }
                  : { providerID: target.providerID, modelID: target.id }
              lastUser.variant = acceptedProposal.toRoute.variant
              if (acceptedProposal.scope === "model") lastUser.modelPinned = true
              if (acceptedProposal.scope === "thinking") lastUser.thinkingPinned = true
              await Session.updateMessage(lastUser)
            }
          } else {
            throw new Error(`Approved model change could not be applied: ${applied.reason}`)
          }
        } else throw new Error("Approved model failed dispatch verification")
      } else throw new Error("Approved model is no longer available")
    } catch (error) {
      const assistant = await recordModelResolutionError({ sessionID, user: lastUser, messages: msgs, error })
      const completion = RouteRuntime.finalizeOutcome({
        sessionID,
        messageID: assistant.id,
        execution: executionContext,
        failure: RouteRuntime.classifyTerminalFailure(error, abort.aborted),
      })
      await projectAndAckCompletion(completion)
      return { action: "break" as const, activeModel, activeVariant, fallbackActive }
    }
  }
  activeVariant = activeRoute.variant
  const routeAfterApply = RouteRuntime.view(executionContext.executionID)
  if (
    routeAfterApply?.route?.stage === "expert" &&
    routeAfterApply.route.activeEpisodeID &&
    routeAfterApply.route.expert &&
    (routeAfterApply.route.expert.calls >= routeAfterApply.route.expert.maxCalls ||
      routeAfterApply.route.expert.steps >= routeAfterApply.route.expert.maxSteps)
  ) {
    const returned = await returnExpertHandoff({
      sessionID,
      execution: executionContext,
      lastUser,
      routeRevision: routeAfterApply.routeRevision,
      route: routeAfterApply.route,
      text: "The configured expert episode call or step limit was reached before a conclusive handoff.",
      status: "inconclusive",
      messageID: Identifier.ascending("message"),
    })
    if (returned === "blocked") return { action: "break" as const, activeModel, activeVariant, fallbackActive }
    return {
      action: "continue" as const,
      activeModel: undefined,
      activeVariant: routeAfterApply.route.base.variant,
      fallbackActive,
    }
  }
  return { action: "proceed" as const, activeRoute, activeModel, activeVariant, fallbackActive, routingPrompt }
}
