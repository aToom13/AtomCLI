import z from "zod"
import { NamedError } from "@atomcli/util/error"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Log } from "@/util/util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
import { SessionCompaction } from "./compaction"
import { Instance } from "@/services/project/instance"
import { defer } from "@/util/util/defer"
import { MemoryLifecycle } from "../memory/services/lifecycle"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ReviewPolicy } from "@/core/verification/review-policy"
import { Flag } from "@/interfaces/flag/flag"
import { fn } from "@/util/util/fn"
import { PermissionNext } from "@/util/permission/next"
import { SessionStatus } from "./status"
import { Config } from "@/core/config/config"
import { PromptContext } from "./prompt/context"
import { SessionScopeFloor } from "./scope-floor"
import { PromptCompletion } from "./prompt/completion"
import { PromptFinalization } from "./prompt/finalization"
import { appendOutput as appendOutputChunk } from "./prompt/shell"
import { ShellCommand } from "./prompt/shell-command"
import { insertReminders as insertRemindersImpl } from "./prompt/reminders"
import {
  command as commandImpl,
  CommandInput as CommandInputSchema,
  type CommandInput as CommandInputType,
} from "./prompt/command"
import { ensureTitle } from "./prompt/title"
import { resolvePromptParts as resolvePromptPartsImpl } from "./prompt/parts"
import { createUserMessage as createUserMessageImpl } from "./prompt/user-message"
import { runPendingTask } from "./prompt/task"
import { handleCheckpoint } from "./prompt/checkpoint"
import { resolveRouteAndExpert } from "./prompt/route"
import { prepareTurnExecution } from "./prompt/turn-execution"
import { PromptActiveSessions } from "./prompt/active-sessions"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  export const insertReminders = insertRemindersImpl

  const {
    isDirectAnswer,
    prepareTurnContext,
    shouldLoadTools,
    shouldResolveTools,
    earlyProgressReminder,
    isSyntheticContinuation,
    isFinishedResponse,
    checkpointTools,
    isCheckpointContinuation,
    checkpointHandoff,
    checkpointDelta,
    accumulateCheckpointFields,
    checkpointFinalParts,
    normalizeCheckpointForOpenTaskflow,
    parseCheckpointJson,
    parseCheckpointJsonCandidates,
  } = PromptContext
  const { reviewRetryText, reviewBlockedText, buildDeterministicFinalResponse } = PromptFinalization

  // Keep this compatibility export independent from LLM module initialization:
  // prompt/reviewer lazy imports can form a valid runtime cycle, and eagerly
  // dereferencing LLM here makes that cycle fail during ESM linking.
  export const OUTPUT_TOKEN_MAX = Flag.ATOMCLI_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 16_000
  const {
    returnExpertHandoff,
    recordModelResolutionError,
    reviewFiles,
    resolveCompletion,
    reviewFromDurableClaim,
    projectCompletion,
    projectAndAckCompletion,
  } = PromptCompletion
  export const reviewEvidenceFiles = PromptCompletion.reviewEvidenceFiles

  export const _internals = {
    isDirectAnswer,
    explicitOrchestration: PromptContext.explicitOrchestration,
    prepareTurnContext,
    shouldLoadTools,
    shouldResolveTools,
    earlyProgressReminder,
    insertReminders,
    isSyntheticContinuation,
    isFinishedResponse,
    reviewRetryText,
    reviewBlockedText,
    checkpointTools,
    checkpointDelta,
    checkpointHandoff,
    checkpointFinalParts,
    buildDeterministicFinalResponse,
    normalizeCheckpointForOpenTaskflow,
    parseCheckpointJson,
    parseCheckpointJsonCandidates,
    isCheckpointContinuation,
    resolveCompletion,
    reviewFromDurableClaim,
    projectCompletion,
    projectAndAckCompletion,
    recordModelResolutionError,
    appendShellOutput: appendOutputChunk,
    lastModel,
    start,
    finish,
  }

  const state = PromptActiveSessions.state

  export function assertNotBusy(sessionID: string) {
    PromptActiveSessions.assertNotBusy(sessionID)
  }

  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    system: z.string().optional(),
    variant: z.string().optional(),
    modelPinned: z.boolean().optional(),
    thinkingPinned: z.boolean().optional(),
    resumesExecutionID: z.string().optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "AgentPartInput",
          }),
        MessageV2.SubtaskPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "SubtaskPartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export const CommandInput = CommandInputSchema
  export type CommandInput = CommandInputType
  export async function command(input: CommandInput) {
    return commandImpl(input, {
      lastModel,
      resolvePromptParts: (template) => resolvePromptPartsImpl(template, Instance.worktree),
      prompt: (value, atomicGoal) => promptMessage(PromptInput.parse(value), atomicGoal),
    })
  }

  async function promptMessage(input: PromptInput, atomicGoal?: string) {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    let messageInput = input
    const requestedText = input.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
      .map((part) => part.text)
      .join("\n")
      .trim()
      .toLocaleLowerCase()
    if (!input.resumesExecutionID && PromptContext.isContinuationPrompt(requestedText)) {
      const previous = (await Session.messages({ sessionID: input.sessionID, excludePatches: true })).findLast(
        (item) => item.info.role === "assistant" && item.info.error,
      )
      if (previous) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const priorExecution = ExecutionRuntime.list({ sessionID: input.sessionID, limit: 1 }).items[0]
        if (
          priorExecution?.outcome === "failed" &&
          priorExecution.reason?.retryable &&
          ExecutionRuntime.view(priorExecution.id)?.lifecycle === "terminal"
        ) {
          messageInput = { ...input, resumesExecutionID: priorExecution.id }
        }
      }
    }

    const message = await createUserMessage(messageInput)
    if (atomicGoal) {
      const part = message.parts.find((part) => part.type === "text" && part.synthetic)
      if (part) {
        Object.assign(part, { metadata: { ...part.metadata, nativeAtomicWork: { goal: atomicGoal } } })
        await Session.updatePart(part)
      }
    }
    const { ExecutionRuntime: AtomicRuntime } = await import("@/core/execution/runtime")
    const binding = AtomicRuntime.activeContext(input.sessionID)
    if (binding && AtomicRuntime.atomicRoot(binding.executionID)) {
      const text =
        atomicGoal ??
        input.parts.flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : [])).join("\n")
      if (text.trim())
        await AtomicRuntime.queueAtomicMessage({
          sessionID: input.sessionID,
          execution: binding,
          messageID: message.info.id,
          text,
        })
    }
    await Session.touch(input.sessionID)

    // The active loop reads this persisted user message on its next model step.
    // Waiting on that loop would reject this request when streaming ends.
    if (PromptActiveSessions.isActive(input.sessionID)) {
      return message
    }

    // this is backwards compatibility for allowing `tools` to be specified when
    // prompting
    const permissions: PermissionNext.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await Session.update(session.id, (draft) => {
        draft.permission = permissions
      })
    }

    if (input.noReply === true) {
      return message
    }

    return loop(input.sessionID)
  }

  export const prompt = fn(PromptInput, promptMessage)

  export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    return resolvePromptPartsImpl(template, Instance.worktree)
  }

  function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller
  }

  function finish(sessionID: string, owner: AbortController) {
    const s = state()
    const match = s[sessionID]
    // A cancelled loop may publish a late busy status before its cleanup runs.
    if (!match && owner.signal.aborted) {
      SessionStatus.set(sessionID, { type: "idle" })
      return
    }
    if (match?.abort !== owner) return
    for (const item of match.callbacks) item.reject()
    delete s[sessionID]
    SessionStatus.set(sessionID, { type: "idle" })
  }

  function trackExecution(
    sessionID: string,
    owner: AbortController,
    execution: import("@/core/execution/runtime").ExecutionRuntime.Context,
  ) {
    const match = state()[sessionID]
    if (match?.abort !== owner) return false
    match.execution = execution
    return true
  }

  export function cancel(sessionID: string) {
    log.info("cancel", { sessionID })
    const s = state()
    const match = s[sessionID]
    if (!match) return
    const execution = match.execution
    match.abort.abort()
    if (execution) {
      void import("@/core/execution/runtime")
        .then(({ ExecutionRuntime }) =>
          execution.rootSessionID === sessionID
            ? ExecutionRuntime.cancelExecution(execution)
            : ExecutionRuntime.cancelInvocation(execution),
        )
        .catch((error) => log.warn("failed to persist execution cancellation", { sessionID, error }))
    }
    for (const item of match.callbacks) {
      item.reject()
    }
    delete s[sessionID]
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }

  export const loop = fn(Identifier.schema("session"), async (sessionID) => {
    const owner = start(sessionID)
    if (!owner) {
      return new Promise<MessageV2.WithParts>((resolve, reject) => {
        const callbacks = state()[sessionID].callbacks
        callbacks.push({ resolve, reject })
      })
    }
    let abort: AbortSignal = owner.signal
    let releaseExecutionLease: (() => void) | undefined
    let executionContext: import("@/core/execution/runtime").ExecutionRuntime.Context | undefined
    let finishExecutionInvocation: ((state: "completed" | "failed" | "cancelled" | "unknown") => boolean) | undefined
    let invocationExitState: "completed" | "failed" | "cancelled" | "unknown" = "unknown"
    let waitingForInput = false

    using _ = defer(() => {
      if (!waitingForInput || owner.signal.aborted)
        finishExecutionInvocation?.(owner.signal.aborted ? "cancelled" : invocationExitState)
      releaseExecutionLease?.()
      finish(sessionID, owner)
    })

    let step = 0
    let activeModel: Provider.Model | undefined
    let activeVariant: string | undefined
    let fallbackActive = false
    let finalResponseOnly: { reasons: string[] } | undefined
    let finalizationAttempt = 0
    const session = await Session.get(sessionID)
    while (true) {
      const { ExecutionRuntime: RecoveryRuntime } = await import("@/core/execution/runtime")
      while (true) {
        const pendingCompletions = RecoveryRuntime.claimCompletions(sessionID)
        if (pendingCompletions.length === 0) break
        for (const completion of pendingCompletions) {
          await projectAndAckCompletion(completion)
        }
      }
      for (const continuation of RecoveryRuntime.pendingContinuations(sessionID)) {
        await Session.updateMessage(continuation.payload.message)
        await Session.updatePart(continuation.payload.part)
        RecoveryRuntime.projectContinuation(continuation.id)
      }
      if (abort.aborted) break
      SessionStatus.set(sessionID, { type: "busy" })
      log.info("loop", { step, sessionID })
      let msgs = await MessageV2.filterCompacted(MessageV2.stream({ sessionID, excludePatches: true }))

      let lastUser: MessageV2.User | undefined
      let lastAssistant: MessageV2.Assistant | undefined
      let lastFinished: MessageV2.Assistant | undefined
      let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
        if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
        if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
          lastFinished = msg.info as MessageV2.Assistant
        if (lastUser && lastFinished) break
        const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
        if (task && !lastFinished) {
          tasks.push(...task)
        }
      }

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

      const lastUserMessage = msgs.find((message) => message.info.id === lastUser.id)
      if (!executionContext) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        executionContext = await ExecutionRuntime.resolveInvocation({
          sessionID,
          invocationID: lastUser.id,
          kind: session.parentID ? (/^(reviewer|checker)$/.test(lastUser.agent) ? "reviewer" : "child") : "root",
          acceptedMessageID: lastUser.id,
          resumesExecutionID: lastUser.resumesExecutionID,
        })
        finishExecutionInvocation = (state) => ExecutionRuntime.finishInvocation(executionContext!, state)
      } else if (executionContext.invocationID !== lastUser.id) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        if (lastUserMessage && isSyntheticContinuation(lastUserMessage)) {
          executionContext = await ExecutionRuntime.bindContinuation({
            sessionID,
            invocationID: lastUser.id,
            execution: executionContext,
          })
        } else if (ExecutionRuntime.view(executionContext.executionID)?.phase === "waiting_input") {
          ExecutionRuntime.finishInvocation(executionContext, "completed")
          executionContext = await ExecutionRuntime.bindContinuation({
            sessionID,
            invocationID: lastUser.id,
            execution: executionContext,
          })
        } else {
          executionContext = await ExecutionRuntime.bindContinuation({
            sessionID,
            invocationID: lastUser.id,
            execution: executionContext,
          })
        }
        finishExecutionInvocation = (state) => ExecutionRuntime.finishInvocation(executionContext!, state)
      }
      {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        if (
          lastUserMessage &&
          !isSyntheticContinuation(lastUserMessage) &&
          !ExecutionRuntime.objective(executionContext.executionID)
        ) {
          const objective = lastUserMessage.parts
            .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
            .map((part) => part.text)
            .join("\n")
            .trim()
          if (objective) ExecutionRuntime.recordObjective(executionContext.executionID, lastUser.id, objective)
        }
        if (!trackExecution(sessionID, owner, executionContext)) {
          if (executionContext.rootSessionID === sessionID) ExecutionRuntime.cancelExecution(executionContext)
          else ExecutionRuntime.cancelInvocation(executionContext)
          break
        }
        releaseExecutionLease ??= ExecutionRuntime.holdLease(executionContext)
        abort = AbortSignal.any([owner.signal, ExecutionRuntime.leaseSignal(executionContext)])
      }
      if (!session.parentID && lastUserMessage) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const native = lastUserMessage.parts.find(
          (part) => part.type === "text" && part.synthetic && part.metadata?.nativeAtomicWork,
        )
        const goal = native?.type === "text" ? native.metadata?.nativeAtomicWork?.goal : undefined
        if (typeof goal === "string" && !ExecutionRuntime.atomicRoot(executionContext.executionID))
          await ExecutionRuntime.startAtomicWork({
            sessionID,
            execution: executionContext,
            messageID: lastUser.id,
            goal,
            agent: lastUser.agent,
          })
        const root = ExecutionRuntime.atomicRoot(executionContext.executionID)
        if (root && root.id !== `atomic_${lastUser.id}` && !isSyntheticContinuation(lastUserMessage)) {
          const text =
            typeof goal === "string"
              ? goal
              : lastUserMessage.parts
                  .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
                  .join("\n")
          if (text.trim())
            await ExecutionRuntime.queueAtomicMessage({
              sessionID,
              execution: executionContext,
              messageID: lastUser.id,
              text,
            })
        }
      }
      const { TaskFlow } = await import("@/integrations/tool/taskflow")
      const { ExecutionRuntime: AtomicFlowRuntime } = await import("@/core/execution/runtime")
      if (
        !AtomicFlowRuntime.isReviewer(executionContext) &&
        !AtomicFlowRuntime.atomicRoot(executionContext.executionID)
      )
        await TaskFlow.restore(sessionID, executionContext.executionID)
      if (!session.parentID) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const pendingCompletion = ExecutionRuntime.completion(executionContext.executionID)
        if (pendingCompletion && pendingCompletion.state !== "discarded") {
          const outcome = await resolveCompletion({
            sessionID,
            lastUser,
            execution: executionContext,
            candidate: pendingCompletion,
            abort,
          })
          if (outcome !== "retry") break
          continue
        }
      }
      {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        await ExecutionRuntime.waitForRouteDecision(executionContext.rootSessionID, executionContext, abort)
      }
      if (isFinishedResponse(lastUser, lastAssistant)) {
        log.info("exiting loop", { sessionID })
        break
      }

      step++
      if (step === 1) {
        ensureTitle({
          session,
          history: msgs,
        })
        if (executionContext) {
          const { ExecutionRuntime } = await import("@/core/execution/runtime")
          if (!ExecutionRuntime.getExecutionContract(executionContext.executionID)) {
            const userPromptText =
              msgs
                .findLast((message) => message.info.id === lastUser.id)
                ?.parts.filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
                .map((part) => part.text)
                .join("\n") ?? ""
            const cfg = await Config.get()
            const { ExecutionContract } = await import("@/core/routing/execution-contract")
            const continuation = PromptContext.continuationContract(
              userPromptText,
              executionContext.executionID,
              ExecutionRuntime.list({ sessionID, limit: 2 }).items,
              ExecutionRuntime.getExecutionContract,
            )
            if (ExecutionRuntime.atomicRoot(executionContext.executionID)) {
              ExecutionRuntime.setExecutionContract(
                executionContext.executionID,
                ExecutionContract.fallback("native_atomic_work", {
                  intent: "change",
                  scope: "coordinated",
                  needsDiscovery: true,
                  needsMutation: true,
                }),
              )
            } else if (continuation) {
              const scopeFloor = await SessionScopeFloor.merge(sessionID, continuation.scope)
              ExecutionRuntime.setExecutionContract(executionContext.executionID, {
                ...continuation,
                scope: scopeFloor,
                rationale: `Continuation of unfinished execution: ${continuation.rationale}`.slice(0, 500),
              })
            } else if (isDirectAnswer(userPromptText, lastUser.agent)) {
              const directScope = await SessionScopeFloor.merge(sessionID, "direct")
              ExecutionRuntime.setExecutionContract(
                executionContext.executionID,
                ExecutionContract.fallback("deterministic_direct_answer", {
                  intent: "answer",
                  scope: directScope,
                  risk: "low",
                  confidence: 1,
                  expectedSurfaces: ["conversation"],
                  assumptions: [],
                  uncertainty: "low",
                  needsDiscovery: false,
                  needsMutation: false,
                  needsExternalAction: false,
                  likelyCrossBoundary: false,
                }),
              )
            } else if (cfg.experimental?.execution_classification !== false) {
              const { ExecutionClassifier } = await import("@/core/routing/execution-classifier")
              let classifierModel: any = undefined
              const baseModel = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch(
                () => undefined,
              )
              if (baseModel) {
                classifierModel = await Provider.getLanguage(baseModel).catch(() => undefined)
              }
              const explicitOrchestration = PromptContext.explicitOrchestration(userPromptText)
              const scopeFloor = await SessionScopeFloor.merge(sessionID, "direct")
              const classification = await ExecutionClassifier.classify({
                sessionID,
                execution: executionContext,
                invocationID: executionContext.invocationID,
                prompt: userPromptText,
                agentMode: lastUser.agent,
                model: classifierModel,
                modelInfo: baseModel,
                signal: abort,
                explicitOrchestration,
                scopeFloor,
              })
              const explicitDelegation = PromptContext.explicitSubagentDelegation(userPromptText)
              // An explicit subagent/parallel-delegation request needs the model-facing
              // `agent` tool, which is only advertised at coordinated scope. A generic
              // orchestration mention only floors the scope to focused.
              const minimumScope = explicitDelegation
                ? "coordinated"
                : explicitOrchestration
                  ? "focused"
                  : classification.contract.scope
              const classifiedScope =
                ExecutionContract.SCOPE_RANK[minimumScope] >= ExecutionContract.SCOPE_RANK[scopeFloor]
                  ? minimumScope
                  : scopeFloor
              ExecutionRuntime.setExecutionContract(
                executionContext.executionID,
                {
                  ...classification.contract,
                  scope: classifiedScope,
                  rationale: explicitDelegation
                    ? `${classification.contract.rationale} Explicit subagent delegation requires coordinated scope so the agent tool is available.`
                    : explicitOrchestration
                      ? `${classification.contract.rationale} Explicit orchestration request requires at least focused scope.`
                      : classification.contract.rationale,
                },
                {
                  classifierFallback: classification.fallback,
                  acceptanceChange: {
                    reason: "user_input",
                    detail: `Classified user message ${lastUser.id}`,
                    invalidatedEvidence: [],
                  },
                },
              )
              await SessionScopeFloor.raise({ sessionID, scope: classifiedScope })
            } else {
              const explicitDelegation = PromptContext.explicitSubagentDelegation(userPromptText)
              const fallbackScope = explicitDelegation
                ? "coordinated"
                : PromptContext.explicitOrchestration(userPromptText)
                  ? "focused"
                  : ExecutionContract.conservativeScope(lastUser.agent)
              ExecutionRuntime.setExecutionContract(
                executionContext.executionID,
                ExecutionContract.fallback("default_runtime_policy", {
                  scope: await SessionScopeFloor.merge(sessionID, fallbackScope),
                }),
              )
            }
          }
        }
      }

      const { ExecutionRuntime: RouteRuntime } = await import("@/core/execution/runtime")
      const routeResult = await resolveRouteAndExpert({
        msgs,
        lastUser,
        executionContext,
        activeVariant,
        activeModel,
        fallbackActive,
        sessionID,
        abort,
        RouteRuntime,
        recordModelResolutionError,
        projectAndAckCompletion,
        returnExpertHandoff,
      })
      activeModel = routeResult.activeModel
      activeVariant = routeResult.activeVariant
      fallbackActive = routeResult.fallbackActive
      if (routeResult.action === "break") break
      if (routeResult.action === "continue") continue
      const activeRoute = routeResult.activeRoute
      const routingPrompt = routeResult.routingPrompt
      let model: Provider.Model
      try {
        model =
          (fallbackActive ? activeModel : undefined) ??
          (activeModel?.providerID === activeRoute.providerID && activeModel.id === activeRoute.modelID
            ? activeModel
            : undefined) ??
          (await Provider.getModel(activeRoute.providerID, activeRoute.modelID, {
            session,
            prompt: routingPrompt ?? "",
            verify: true,
            signal: abort,
            execution: executionContext,
            variant: activeVariant,
            agent: await Agent.get(lastUser.agent),
            user: lastUser,
          }))
      } catch (error) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        log.error("model resolution failed", {
          sessionID,
          providerID: lastUser.model.providerID,
          modelID: lastUser.model.modelID,
          error: error instanceof Error ? error.name : "UnknownError",
        })
        const assistant = await recordModelResolutionError({ sessionID, user: lastUser, messages: msgs, error })
        if (session.parentID) break
        const failure = ExecutionRuntime.classifyTerminalFailure(error, abort.aborted)
        const completion = ExecutionRuntime.finalizeOutcome({
          sessionID,
          messageID: assistant.id,
          execution: executionContext,
          failure,
        })
        await projectAndAckCompletion(completion)
        break
      }
      activeModel = model

      const task = tasks.pop()

      if (await runPendingTask(task, { sessionID, lastUser, model, abort, executionContext, log })) continue

      // pending compaction
      if (task?.type === "compaction") {
        const result = await SessionCompaction.process({
          messages: msgs,
          parentID: lastUser.id,
          abort,
          sessionID,
          auto: task.auto,
        })
        if (result === "stop") break
        continue
      }

      // context overflow, needs compaction
      if (
        lastFinished &&
        lastFinished.summary !== true &&
        (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
      ) {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
        continue
      }

      // normal processing
      const turnContextResult = await prepareTurnExecution({
        sessionID,
        session,
        msgs,
        lastUser,
        lastFinished,
        model,
        activeModel,
        activeVariant,
        fallbackActive,
        abort,
        step,
        executionContext,
        finalResponseOnly,
        finalizationAttempt,
        RouteRuntime,
        insertReminders,
        shouldResolveTools,
        checkpointTools,
        prepareTurnContext,
        earlyProgressReminder,
        checkpointHandoff,
        checkpointDelta,
        accumulateCheckpointFields,
        isCheckpointContinuation,
      })
      msgs = turnContextResult.msgs
      const {
        agent,
        processor,
        tools,
        currentModel,
        checkpointRequired,
        isLastStep,
        expertEpisodeID,
        turnContext,
        requiresFinalGate,
        eventCheckpoint,
        routeState,
      } = turnContextResult
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      try {
        if (
          ExecutionRuntime.isReviewer(executionContext) &&
          step > Math.min(agent.steps ?? Infinity, ReviewPolicy.MAX_REVIEW_STEPS)
        ) {
          throw new ExecutionRuntime.BudgetExceededError("step_limit", executionContext.executionID)
        }
        // Checkpoint turns report progress and must run even after task-step budget is exhausted.
        if (!finalResponseOnly && !checkpointRequired)
          await ExecutionRuntime.admitStep({
            sessionID,
            stepID: processor.message.id,
            execution: executionContext,
          })
      } catch (error) {
        if (!(error instanceof ExecutionRuntime.BudgetExceededError)) throw error
        if (error.reason === "checkpoint_required") {
          // Reserved slice is exhausted; next turn enters checkpoint mode.
          await Session.removeMessage({ sessionID, messageID: processor.message.id })
          step--
          continue
        }
        if (error.reason === "step_limit" && executionContext && !ExecutionRuntime.isReviewer(executionContext)) {
          await Session.removeMessage({ sessionID, messageID: processor.message.id })
          step--
          const extensions = ExecutionRuntime.allowance(executionContext.executionID).extensions
          if (extensions < ExecutionCheckpoint.MAX_EXTENSIONS) {
            ExecutionRuntime.requestCheckpoint(executionContext.executionID)
            continue
          }
          finalResponseOnly = { reasons: ["Execution step limit reached."] }
          continue
        }
        const failure = ExecutionRuntime.classifyTerminalFailure(error, abort.aborted)
        if (session.parentID) {
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: processor.message.id,
            sessionID,
            type: "text",
            text: failure.reasonMessage,
            synthetic: true,
            time: { start: Date.now(), end: Date.now() },
          })
          processor.message.finish = "stop"
          processor.message.error = new NamedError.Unknown({ message: failure.reasonMessage }).toObject()
          processor.message.time.completed = Date.now()
          await Session.updateMessage(processor.message)
          break
        }
        const completion = ExecutionRuntime.finalizeOutcome({
          sessionID,
          messageID: processor.message.id,
          execution: executionContext,
          failure,
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: processor.message.id,
              sessionID,
              type: "text",
              text: failure.reasonMessage,
              synthetic: true,
              time: { start: Date.now(), end: Date.now() },
            },
          ],
        })
        await projectAndAckCompletion(completion)
        break
      }
      const result = await processor.process(
        {
          user: activeVariant === lastUser.variant ? lastUser : { ...lastUser, variant: activeVariant },
          agent,
          abort,
          sessionID,
          system: turnContext.system,
          messages: turnContext.messages,
          tools,
          model: currentModel,
          execution: executionContext,
          finalizationOnly: Boolean(finalResponseOnly),
        },
        // Checkpoint JSON must stay buffered in every session type. Child sessions
        // otherwise persist text directly while parser only reads deferred parts.
        {
          deferText: requiresFinalGate || checkpointRequired || Boolean(finalResponseOnly),
          captureCheckpointReasoning: checkpointRequired,
        },
      )
      // These results are transport/control outcomes, not checkpoint JSON. They
      // must be handled before every early continuation in checkpoint mode.
      if (result.fallbackModel) {
        activeModel = result.fallbackModel
        fallbackActive = true
      }
      const latestUserID = (await Session.messages({ sessionID, excludePatches: true })).findLast(
        (message) => message.info.role === "user",
      )?.info.id
      if (latestUserID && latestUserID !== lastUser.id && !processor.message.error) {
        processor.message.finish = "tool-calls"
        await Session.updateMessage(processor.message)
        continue
      }
      if (result.status === "stop" && !finalResponseOnly) {
        if (requiresFinalGate && processor.message.error) {
          const failure = ExecutionRuntime.classifyTerminalFailure(
            result.terminalError ?? processor.message.error,
            abort.aborted,
          )
          const completion = ExecutionRuntime.finalizeOutcome({
            sessionID,
            messageID: processor.message.id,
            execution: executionContext,
            failure,
            parts: [
              {
                id: Identifier.ascending("part"),
                messageID: processor.message.id,
                sessionID,
                type: "text",
                text: await buildDeterministicFinalResponse({
                  sessionID,
                  executionID: executionContext.executionID,
                  reasons: [failure.reasonMessage],
                }),
                synthetic: true,
                time: { start: Date.now(), end: Date.now() },
              },
            ],
          })
          await projectAndAckCompletion(completion)
        }
        break
      }
      if (result.status === "compact") {
        if (checkpointRequired) RouteRuntime.requestCheckpoint(executionContext.executionID)
        await SessionCompaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
        continue
      }
      if (checkpointRequired) {
        const checkpointResult = await handleCheckpoint({
          result,
          sessionID,
          lastUser,
          executionContext,
          processor,
          eventCheckpoint,
          RouteRuntime,
          parseCheckpointJsonCandidates,
          checkpointFinalParts,
        })
        if (checkpointResult.finalResponseOnly) finalResponseOnly = checkpointResult.finalResponseOnly
        if (checkpointResult.action === "continue") continue
        if (checkpointResult.action === "break") {
          waitingForInput = checkpointResult.waitingForInput === true
          break
        }
      }
      const routeDecisionMadeThisStep = RouteRuntime.routeProposalHistory(executionContext.executionID).some(
        (proposal) => proposal.stepID === processor.message.id && proposal.state === "rejected",
      )
      if (
        routeDecisionMadeThisStep ||
        RouteRuntime.snapshot(executionContext.rootSessionID).pendingProposals.some(
          (proposal) =>
            proposal.executionID === executionContext.executionID &&
            proposal.invocationID === executionContext.invocationID,
        )
      ) {
        // Even providers reporting stop after a tool call must pass the approval boundary.
        processor.message.finish = "tool-calls"
        await Session.updateMessage(processor.message)
        continue
      }
      const hasFinalizationText =
        Boolean(finalResponseOnly) &&
        PromptFinalization.isUserFacingReport((result.deferredTextParts ?? []).map((part) => part.text).join("\n"))
      const terminalCandidate =
        !finalResponseOnly &&
        result.status === "continue" &&
        (result.terminalFinish ?? processor.message.finish) &&
        !["tool-calls", "unknown"].includes(result.terminalFinish ?? processor.message.finish!)
      if (terminalCandidate && expertEpisodeID && routeState) {
        const expertText = (result.deferredTextParts ?? []).map((part) => part.text).join("\n")
        const returned = await returnExpertHandoff({
          sessionID,
          execution: executionContext,
          lastUser,
          routeRevision: RouteRuntime.view(executionContext.executionID)!.routeRevision,
          route: routeState,
          text: expertText,
          status: expertText.trim() ? "completed" : "inconclusive",
          messageID: processor.message.id,
        })
        if (returned === "blocked") break
        activeModel = undefined
        activeVariant = routeState.base.variant
        continue
      }
      if (requiresFinalGate && terminalCandidate) {
        const editedFiles = await reviewFiles(sessionID)
        const { evaluateReviewDecision } = await import("@/integrations/tool/review-gate")
        const reviewDecision = (await evaluateReviewDecision(sessionID, executionContext.executionID)).decision
        let candidate
        try {
          candidate = await ExecutionRuntime.stageCompletion({
            sessionID,
            messageID: processor.message.id,
            finish: result.terminalFinish ?? processor.message.finish!,
            parts: result.deferredTextParts ?? [],
            editedFiles,
            requiresReview: reviewDecision.requirement === "required",
            reviewDecision,
            execution: executionContext,
          })
        } catch (error) {
          if (
            error instanceof ExecutionRuntime.BudgetExceededError &&
            ["active_work", "active_blocker", "active_task"].includes(error.reason)
          ) {
            const reasons = await PromptFinalization.durableFailureReasons(executionContext.executionID)
            if (reasons.length) {
              // Failed obligations and uncertain effects forbid success, not
              // an honest terminal report. Keep every child/task/work record.
              finalResponseOnly = { reasons }
            } else {
              processor.message.finish = undefined
              await Session.updateMessage(processor.message)
              RouteRuntime.requestCheckpoint(executionContext.executionID)
              continue
            }
          } else {
            throw error
          }
        }
        if (candidate) {
          const outcome = await resolveCompletion({
            sessionID,
            lastUser,
            execution: executionContext,
            candidate,
            abort,
            allowRetry: !isLastStep && !finalResponseOnly,
          })
          if (outcome === "retry") {
            continue
          }
          break
        }
      }
      if (finalResponseOnly) {
        const reportText = (result.deferredTextParts ?? [])
          .map((part) => part.text)
          .join("\n")
          .trim()
        const usableReport = hasFinalizationText || PromptFinalization.isUserFacingReport(reportText)
        if (!usableReport && finalizationAttempt === 0) {
          finalizationAttempt++
          await Session.removeMessage({ sessionID, messageID: processor.message.id }).catch(() => {})
          continue
        }
        const reason = `Execution stopped by runtime constraints: ${finalResponseOnly.reasons.join("; ")}`
        const fallbackText = await buildDeterministicFinalResponse({
          sessionID,
          executionID: executionContext.executionID,
          reasons: finalResponseOnly.reasons,
        })
        const failure = finalResponseOnly.reasons.every((item) => item === "Execution step limit reached.")
          ? ExecutionRuntime.classifyTerminalFailure(
              new ExecutionRuntime.BudgetExceededError("step_limit", executionContext.executionID, reason),
            )
          : {
              outcome: "blocked" as const,
              reasonCode: "resource_limit" as const,
              reasonMessage: reason,
              retryable: false,
            }
        const part: MessageV2.TextPart = {
          id: Identifier.ascending("part"),
          messageID: processor.message.id,
          sessionID,
          type: "text",
          text: usableReport
            ? `${reportText}\n\nRoot execution ${failure.outcome}: ${finalResponseOnly.reasons.join("; ")}`
            : fallbackText,
          synthetic: true,
          time: { start: Date.now(), end: Date.now() },
          metadata: { blockerKind: "procedural_harness" },
        }
        await Session.updatePart(part)
        if (session.parentID) {
          // A child shares its parent's execution budget, but its final report must not terminate that execution.
          processor.message.finish = "stop"
          processor.message.error = new NamedError.Unknown({ message: reason }).toObject()
          processor.message.time.completed = Date.now()
          await Session.updateMessage(processor.message)
          break
        }
        const completion = ExecutionRuntime.finalizeOutcome({
          sessionID,
          messageID: processor.message.id,
          execution: executionContext,
          failure: { ...failure, reasonMessage: reason },
          parts: [part],
        })
        await projectAndAckCompletion(completion)
        break
      }
      continue
    }
    SessionCompaction.prune({ sessionID })
    const completedMessages: MessageV2.WithParts[] = []
    for await (const item of MessageV2.stream({ sessionID, excludePatches: true })) completedMessages.push(item)
    // Automatic evaluation is local and cheap. The LLM retrospective is
    // deferred to session close (MemoryLifecycle.flush) so a user request
    // never silently spends a second provider request mid-turn.
    MemoryLifecycle.schedule(sessionID, completedMessages)
    for (const item of completedMessages) {
      if (item.info.role === "user") continue
      invocationExitState = item.info.error ? "failed" : "completed"
      const queued = state()[sessionID]?.callbacks ?? []
      for (const q of queued) {
        q.resolve(item)
      }
      return item
    }
    throw new Error("Impossible")
  })

  async function lastModel(sessionID: string) {
    for await (const item of MessageV2.stream({ sessionID, excludePatches: true })) {
      if (item.info.role !== "user" || !item.info.model) continue
      const available = await Provider.getModel(item.info.model.providerID, item.info.model.modelID).catch(
        () => undefined,
      )
      if (available) return item.info.model
      log.warn("session model is no longer available; selecting a current model", { model: item.info.model })
      break
    }
    return Provider.defaultModel()
  }

  async function createUserMessage(input: PromptInput) {
    return createUserMessageImpl(input, { lastModel })
  }

  export const ShellInput = ShellCommand.Input
  export type ShellInput = ShellCommand.Input
  export async function shell(input: ShellInput) {
    return ShellCommand.run(input, { start, finish, lastModel })
  }
}
