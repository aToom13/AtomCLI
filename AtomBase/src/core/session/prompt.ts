import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Log } from "@/util/util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
// Note: ai package functions are imported dynamically to avoid Bun ESM resolution issues
import type { Tool as AITool, ToolCallOptions } from "ai"
import { getTool, getJsonSchema } from "@/util/util/ai-compat"
import { SessionCompaction } from "./compaction"
import { Instance } from "@/services/project/instance"
import { Bus } from "../bus"
import { ProviderTransform } from "@/integrations/provider/transform"
import { SystemPrompt } from "./system"
import { Plugin } from "@/integrations/plugin"
import PROMPT_PLAN from "../session/prompt/runtime/plan-mode.txt"
import BUILD_SWITCH from "../session/prompt/runtime/build-switch.txt"
import MAX_STEPS from "../session/prompt/runtime/max-steps.txt"
import { defer } from "@/util/util/defer"
import { recall } from "@/integrations/tool/memory"
import { recallCoreMemories } from "@/core/memory"
import { SessionMemoryIntegration } from "../memory/integration/session"
import { MemoryLifecycle } from "../memory/services/lifecycle"
import { ToolRegistry } from "@/integrations/tool/registry"
import { MCP } from "@/integrations/mcp"
import { LSP } from "@/integrations/lsp"
import { ReadTool } from "@/integrations/tool/read"
import { FindTool } from "@/integrations/tool/find"
import { FileTime } from "@/services/file/time"
import { Flag } from "@/interfaces/flag/flag"
import { Filesystem } from "@/util/util/filesystem"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "@/interfaces/command"
import { $, fileURLToPath } from "bun"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@atomcli/util/error"
import { fn } from "@/util/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/integrations/tool/task"
import { Tool } from "@/integrations/tool/tool"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { EnvPolicy } from "@/core/env/policy"
import { PermissionNext } from "@/util/permission/next"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/util/iife"
import { Shell } from "@/interfaces/shell/shell"
import { Skill } from "@/integrations/skill"
import { escapeXmlText, HarnessState } from "./harness-state"
import { SessionExecutionProfile } from "./execution-profile"
import { AgentEval } from "@/core/eval/harness"
import { DataUrl } from "./data-url"
import { Storage } from "@/core/storage/storage"
import { Config } from "@/core/config/config"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  // Keep this compatibility export independent from LLM module initialization:
  // prompt/reviewer lazy imports can form a valid runtime cycle, and eagerly
  // dereferencing LLM here makes that cycle fail during ESM linking.
  export const OUTPUT_TOKEN_MAX = Flag.ATOMCLI_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000
  const MAX_COMPLETION_DESCENDANT_DEPTH = 32
  const MAX_COMPLETION_DESCENDANT_SESSIONS = 500
  const SHELL_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024
  const SHELL_UPDATE_INTERVAL_MS = 50
  const SHELL_TRUNCATION_MARKER = "[earlier shell output truncated]\n"

  function appendShellOutput(current: string, chunk: string, limitBytes = SHELL_OUTPUT_LIMIT_BYTES) {
    const alreadyTruncated = current.startsWith(SHELL_TRUNCATION_MARKER)
    const previous = alreadyTruncated ? current.slice(SHELL_TRUNCATION_MARKER.length) : current
    const combined = previous + chunk
    if (!alreadyTruncated && new TextEncoder().encode(combined).byteLength <= limitBytes) return combined
    const markerBytes = new TextEncoder().encode(SHELL_TRUNCATION_MARKER).byteLength
    const tailBudget = Math.max(0, limitBytes - markerBytes)
    let low = 0
    let high = combined.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (new TextEncoder().encode(combined.slice(middle)).byteLength <= tailBudget) high = middle
      else low = middle + 1
    }
    return SHELL_TRUNCATION_MARKER + combined.slice(low)
  }

  function prepareTurnContext<T>(system: string[], messages: T[], isLastStep: boolean) {
    return {
      system: isLastStep ? [...system, MAX_STEPS] : system,
      messages,
    }
  }

  function shouldLoadTools(input: {
    prompt: string
    explicitTools: boolean
    bypassAgentCheck: boolean
    hasPriorToolActivity: boolean
  }) {
    if (input.explicitTools || input.bypassAgentCheck || input.hasPriorToolActivity) return true
    const normalized = input.prompt
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
    if (!normalized) return true
    const casual = new Set([
      "selam",
      "merhaba",
      "naber",
      "nasılsın",
      "nasılsınız",
      "hello",
      "hi",
      "hey",
      "thanks",
      "thank you",
      "teşekkürler",
      "teşekkür ederim",
    ])
    return !casual.has(normalized)
  }

  function shouldResolveTools(isLastStep: boolean) {
    return !isLastStep
  }

  function isSyntheticContinuation(message: MessageV2.WithParts) {
    return (
      message.info.role === "user" &&
      message.parts.length > 0 &&
      message.parts.every((part) => "synthetic" in part && part.synthetic === true)
    )
  }

  function reviewRetryText(reason?: string) {
    return [
      "The final response was withheld because the independent review did not pass.",
      "Address the review findings, verify the current workspace revision, and then produce a new final response.",
      reason ? `Review result:\n${reason}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  async function returnExpertHandoff(input: {
    sessionID: string
    execution: import("@/core/execution/runtime").ExecutionRuntime.Context
    lastUser: MessageV2.User
    routeRevision: number
    route: {
      base: { providerID: string; modelID: string; variant?: string }
      activeEpisodeID?: string
    }
    text: string
    status: "completed" | "inconclusive"
    messageID: string
  }) {
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    const episodeID = input.route.activeEpisodeID!
    const baseModel = await Provider.getModel(input.route.base.providerID, input.route.base.modelID).catch(
      () => undefined,
    )
    const basePolicy = baseModel ? Provider.routePolicy(baseModel) : undefined
    const eligible =
      baseModel &&
      basePolicy &&
      (await Provider.isRouteEligible(baseModel, { ...basePolicy, requireVerification: true }, "text"))
    if (!eligible) {
      const part: MessageV2.TextPart = {
        id: Identifier.ascending("part"),
        messageID: input.messageID,
        sessionID: input.sessionID,
        type: "text",
        text: "The expert analysis stopped, but no verified eligible base model remains to continue the execution.",
      }
      const completion = ExecutionRuntime.finalizeOutcome({
        sessionID: input.sessionID,
        messageID: input.messageID,
        parts: [part],
        execution: input.execution,
        failure: {
          outcome: "blocked",
          reasonCode: "no_verified_model",
          reasonMessage: part.text,
          retryable: true,
        },
      })
      await projectAndAckCompletion(completion)
      return "blocked" as const
    }
    const message: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: input.lastUser.agent,
      model: { providerID: input.route.base.providerID, modelID: input.route.base.modelID },
      variant: input.route.base.variant,
    }
    const part: MessageV2.TextPart = {
      id: Identifier.ascending("part"),
      messageID: message.id,
      sessionID: input.sessionID,
      type: "text",
      text: JSON.stringify({
        kind: "expert_handoff",
        status: input.status,
        episodeID,
        evidenceBasedAnalysis: input.text.slice(0, 20_000),
        instruction: "Use this advisory evidence, verify it, and complete the root task with the base model.",
      }),
      synthetic: true,
    }
    const continuation = await ExecutionRuntime.returnFromExpert({
      sessionID: input.sessionID,
      execution: input.execution,
      episodeID,
      expectedRouteRevision: input.routeRevision,
      message,
      part,
    })
    await Session.updateMessage(continuation.message)
    await Session.updatePart(continuation.part)
    ExecutionRuntime.projectContinuation(continuation.id)
    return "returned" as const
  }

  function reviewBlockedText(reason?: string) {
    return [
      "Completion is blocked: the required independent review could not approve the current workspace revision.",
      reason || "Retry the review or ask the user how to proceed.",
    ].join("\n\n")
  }

  async function recordModelResolutionError(input: {
    sessionID: string
    user: MessageV2.User
    messages: MessageV2.WithParts[]
    error: unknown
  }) {
    const existing = input.messages.find(
      (message) =>
        message.info.role === "assistant" && message.info.parentID === input.user.id && Boolean(message.info.error),
    )
    if (existing) return existing.info as MessageV2.Assistant
    const error = await MessageV2.fromError(input.error, { providerID: input.user.model.providerID })
    const now = Date.now()
    const assistant = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      parentID: input.user.id,
      role: "assistant",
      agent: input.user.agent,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: input.user.model.modelID,
      providerID: input.user.model.providerID,
      time: { created: now },
      error,
    })) as MessageV2.Assistant
    Bus.publish(Session.Event.Error, { sessionID: input.sessionID, error })
    return assistant
  }

  class CompletionProjectionError extends Error {
    constructor(readonly reasonCode: "missing_message") {
      super("Completion message is missing")
      this.name = "CompletionProjectionError"
    }
  }

  async function projectCompletion(candidate: import("@/core/execution/runtime").ExecutionRuntime.CompletionClaim) {
    const messages = await Session.messages({ sessionID: candidate.sessionID, excludePatches: false })
    let existing = messages.find((item) => item.info.id === candidate.messageID)
    let message = existing?.info
    if (!message && candidate.parentUserID) {
      const parent = messages.find((item) => item.info.id === candidate.parentUserID)?.info
      if (parent?.role === "user") {
        message = await Session.updateMessageGuarded(
          {
            id: candidate.messageID,
            parentID: parent.id,
            sessionID: candidate.sessionID,
            role: "assistant",
            agent: parent.agent,
            path: { cwd: Instance.directory, root: Instance.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: parent.model.modelID,
            providerID: parent.model.providerID,
            time: { created: Date.now() },
          },
          candidate.sessionGeneration,
        )
        existing = { info: message, parts: [] }
      }
    }
    if (!message || message.role !== "assistant" || !existing) throw new CompletionProjectionError("missing_message")
    const existingParts = new Map(existing.parts.map((part) => [part.id, part]))
    for (const part of candidate.parts) {
      if (Bun.deepEquals(existingParts.get(part.id), part)) continue
      await Session.updatePartGuarded(part, candidate.sessionGeneration)
    }
    if (message.finish !== candidate.finish || message.time.completed === undefined) {
      await Session.updateMessageGuarded(
        {
          ...message,
          finish: candidate.finish,
          time: { ...message.time, completed: message.time.completed ?? Date.now() },
        },
        candidate.sessionGeneration,
      )
    }
  }

  async function projectAndAckCompletion(candidate: import("@/core/execution/runtime").ExecutionRuntime.Completion) {
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    const initialGuard = await Storage.sessionGuard(candidate.sessionID)
    if (!initialGuard || initialGuard.tombstone) {
      ExecutionRuntime.deleteSessions(
        [candidate.sessionID],
        initialGuard ? { [candidate.sessionID]: initialGuard.generation } : undefined,
      )
      return "abandoned" as const
    }
    const claim =
      "projectionToken" in candidate
        ? (candidate as import("@/core/execution/runtime").ExecutionRuntime.CompletionClaim)
        : ExecutionRuntime.claimCompletion(candidate.sessionID, candidate.executionID)
    if (!claim || claim.digest !== candidate.digest) {
      if (ExecutionRuntime.view(candidate.executionID)?.completion?.projection === "recovery_required") {
        return "recovery_required" as const
      }
      throw new Error("Committed completion could not be claimed for projection")
    }
    const abandonDeletedSession = () => {
      ExecutionRuntime.deleteSessions([claim.sessionID], guard ? { [claim.sessionID]: guard.generation } : undefined)
      return "abandoned" as const
    }
    const guard = await Storage.sessionGuard(claim.sessionID)
    if (!guard || guard.tombstone || guard.generation !== claim.sessionGeneration) return abandonDeletedSession()
    try {
      await projectCompletion(claim)
    } catch (error) {
      if (Storage.isSessionDeletedError(error)) return abandonDeletedSession()
      if (error instanceof CompletionProjectionError) {
        const recorded = ExecutionRuntime.markProjectionRecovery(claim, error.reasonCode)
        if (recorded.recorded) return "recovery_required" as const
      }
      throw error
    }
    const projected = ExecutionRuntime.ackCompletion(claim)
    if (!projected.projected) {
      if (projected.reason === "abandoned") return "abandoned" as const
      throw new Error("Committed completion projection could not be acknowledged")
    }
    return "projected" as const
  }

  export function reviewEvidenceFiles(messages: MessageV2.WithParts[], notBefore = 0): string[] {
    const turnStart = messages.findLastIndex(
      (message) =>
        message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
    )
    if (turnStart < 0 || messages[turnStart].info.time.created < notBefore) return []
    return messages
      .slice(turnStart)
      .flatMap((message) => message.parts)
      .filter((part): part is MessageV2.PatchPart => part.type === "patch")
      .flatMap((part) => part.files)
  }

  async function restoreReviewEvidence(sessionID: string, notBefore = 0): Promise<void> {
    if (HarnessState.getEditedFileCount(sessionID) === 0) {
      const messages = await Session.messages({ sessionID, excludePatches: false })
      for (const filepath of reviewEvidenceFiles(messages, notBefore))
        HarnessState.restoreEditedFile(sessionID, filepath)
    }
  }

  async function completionSessionTree(sessionID: string) {
    const result: string[] = [sessionID]
    const visited = new Set(result)
    const queue = [{ sessionID, depth: 0 }]
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      if (current.depth >= MAX_COMPLETION_DESCENDANT_DEPTH) continue
      for (const child of await Session.children(current.sessionID)) {
        if (visited.has(child.id)) continue
        if (result.length >= MAX_COMPLETION_DESCENDANT_SESSIONS) {
          throw new Error(`Completion session tree exceeds ${MAX_COMPLETION_DESCENDANT_SESSIONS} sessions`)
        }
        visited.add(child.id)
        result.push(child.id)
        queue.push({ sessionID: child.id, depth: current.depth + 1 })
      }
    }
    return result
  }

  async function reviewFiles(sessionID: string): Promise<string[]> {
    const files = new Set<string>()
    const rootMessages = await Session.messages({ sessionID, excludePatches: false })
    const rootTurn = rootMessages.findLast(
      (message) =>
        message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
    )
    const turnStartedAt = rootTurn?.info.time.created ?? 0
    for (const current of await completionSessionTree(sessionID)) {
      await restoreReviewEvidence(current, current === sessionID ? 0 : turnStartedAt)
      for (const filepath of HarnessState.getEditedFiles(current)) files.add(filepath)
    }
    return [...files]
  }

  async function resolveCompletion(input: {
    sessionID: string
    lastUser: MessageV2.User
    execution: import("@/core/execution/runtime").ExecutionRuntime.Context
    candidate: import("@/core/execution/runtime").ExecutionRuntime.Completion
    abort: AbortSignal
  }): Promise<"committed" | "blocked" | "retry"> {
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    input.abort.throwIfAborted()
    if (input.candidate.state === "committed") {
      await projectAndAckCompletion(input.candidate)
      return input.candidate.outcome === "blocked" ? "blocked" : "committed"
    }
    const retry = async (reason?: string) => {
      const retryMessage: MessageV2.User = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: input.lastUser.agent,
        model: input.lastUser.model,
      }
      const retryPart: MessageV2.TextPart = {
        id: Identifier.ascending("part"),
        messageID: retryMessage.id,
        sessionID: input.sessionID,
        type: "text",
        text: reviewRetryText(reason),
        synthetic: true,
      }
      const continuation = await ExecutionRuntime.retryCompletion({
        sessionID: input.sessionID,
        execution: input.execution,
        digest: input.candidate.digest,
        message: retryMessage,
        part: retryPart,
      })
      await Session.updateMessage(continuation.message)
      await Session.updatePart(continuation.part)
      ExecutionRuntime.projectContinuation(continuation.id)
      return "retry" as const
    }
    const blockers: string[] = []
    if (HarnessState.hasActivePlan(input.sessionID)) blockers.push("the taskflow plan is still open")
    const workflowID = HarnessState.getActiveWorkflowId(input.sessionID)
    if (workflowID) blockers.push(`workflow ${workflowID} is still running`)
    const { SubAgentLifecycle } = await import("@/integrations/tool/subagent-lifecycle")
    for (const childID of (await completionSessionTree(input.sessionID)).slice(1)) {
      if (SubAgentLifecycle.status(childID).status === "running") {
        blockers.push(`child session ${childID} is running`)
      }
    }
    if (blockers.length) return retry(`Completion preconditions failed: ${blockers.join("; ")}.`)
    for (const filepath of input.candidate.editedFiles) HarnessState.restoreEditedFile(input.sessionID, filepath)
    await restoreReviewEvidence(input.sessionID)
    const { runBlockingReview } = await import("@/integrations/tool/review-gate")
    const reviewClaim = input.candidate.requiresReview
      ? await ExecutionRuntime.claimReview({
          sessionID: input.sessionID,
          execution: input.execution,
          digest: input.candidate.digest,
          revision: input.candidate.revision,
        })
      : undefined
    const review = await runBlockingReview(input.sessionID, {
      signal: input.abort,
      decision: {
        policyVersion: input.candidate.policyVersion,
        policyDigest: input.candidate.policyDigest,
        requirement: input.candidate.reviewRequirement,
        reasonCode: input.candidate.reviewReasonCode,
        requiredReviewers: input.candidate.requiredReviewers,
        attemptLimit: input.candidate.attemptLimit,
      },
      authorizeSession: reviewClaim
        ? (reviewerSessionID) =>
            ExecutionRuntime.authorizeReviewSession({
              sessionID: input.sessionID,
              reviewerSessionID,
              execution: input.execution,
              reviewID: reviewClaim.id,
            })
        : undefined,
    })
    input.abort.throwIfAborted()
    if (reviewClaim) {
      await ExecutionRuntime.recordReview({
        sessionID: input.sessionID,
        execution: input.execution,
        reviewID: reviewClaim.id,
        state: review.passed ? "passed" : review.error ? "inconclusive" : "rejected",
      })
    }
    if (review.passed) {
      if (HarnessState.needsReview(input.sessionID)) {
        return retry("The workspace changed after review; the current revision must be reviewed again.")
      }
      const committed = await ExecutionRuntime.commitCompletion({
        sessionID: input.sessionID,
        execution: input.execution,
        digest: input.candidate.digest,
      }).catch(async (error) => {
        if (error instanceof ExecutionRuntime.BudgetExceededError && error.reason === "stale_revision") {
          return retry("The workspace changed after review; the current revision must be reviewed again.")
        }
        throw error
      })
      if (committed === "retry") return committed
      await projectAndAckCompletion(committed)
      for (const sessionID of await completionSessionTree(input.sessionID)) HarnessState.clearReviewScope(sessionID)
      return "committed"
    }
    if (!review.error && !review.exhausted) {
      return retry(review.reason)
    }
    const original = input.candidate.parts[0]
    const blockedText = reviewBlockedText(review.reason)
    const blocked = await ExecutionRuntime.finalizeBlocked({
      sessionID: input.sessionID,
      digest: input.candidate.digest,
      parts: [
        {
          ...(original ?? {
            id: Identifier.ascending("part"),
            messageID: input.candidate.messageID,
            sessionID: input.sessionID,
            type: "text" as const,
            time: { start: Date.now(), end: Date.now() },
          }),
          text: blockedText,
          synthetic: true,
          metadata: { ...original?.metadata, reviewGate: "blocked" },
        },
      ],
      execution: input.execution,
      reasonCode: review.error ? "review_unavailable" : "review_rejected",
      reasonMessage: "Independent review could not approve this completion.",
    })
    await projectAndAckCompletion(blocked)
    return "blocked"
  }

  export const _internals = {
    prepareTurnContext,
    shouldLoadTools,
    shouldResolveTools,
    isSyntheticContinuation,
    reviewRetryText,
    reviewBlockedText,
    projectCompletion,
    projectAndAckCompletion,
    recordModelResolutionError,
    appendShellOutput,
    lastModel,
    start,
    finish,
  }

  const state = Instance.state(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
          execution?: import("@/core/execution/runtime").ExecutionRuntime.Context
          callbacks: {
            resolve(input: MessageV2.WithParts): void
            reject(): void
          }[]
        }
      > = {}
      return data
    },
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
        for (const callback of item.callbacks) {
          callback.reject()
        }
      }
    },
  )

  export function assertNotBusy(sessionID: string) {
    const match = state()[sessionID]
    if (match) throw new Session.BusyError(sessionID)
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

  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

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
  })

  export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    const parts: PromptInput["parts"] = [
      {
        type: "text",
        text: template,
      },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
      files.map(async (match) => {
        const name = match[1]
        if (seen.has(name)) return
        seen.add(name)
        const filepath = name.startsWith("~/")
          ? path.join(os.homedir(), name.slice(2))
          : path.resolve(Instance.worktree, name)

        const stats = await fs.stat(filepath).catch(() => undefined)
        if (!stats) {
          // First, check if it's a skill
          const skill = await Skill.get(name)
          if (skill) {
            const parsed = await ConfigMarkdown.parse(skill.location)
            parts.push({
              type: "text",
              text: `\n<skill name="${skill.name}">\n${parsed.content.trim()}\n</skill>\n`,
            })
            return
          }

          // If not a skill, check for agent
          const agent = await Agent.get(name)
          if (agent) {
            parts.push({
              type: "agent",
              name: agent.name,
            })
          }
          return
        }

        if (stats.isDirectory()) {
          parts.push({
            type: "file",
            url: `file://${filepath}`,
            filename: name,
            mime: "application/x-directory",
          })
          return
        }

        parts.push({
          type: "file",
          url: `file://${filepath}`,
          filename: name,
          mime: "text/plain",
        })
      }),
    )
    return parts
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

    using _ = defer(() => {
      finishExecutionInvocation?.(owner.signal.aborted ? "cancelled" : invocationExitState)
      releaseExecutionLease?.()
      finish(sessionID, owner)
    })

    let step = 0
    let activeModel: Provider.Model | undefined
    let activeVariant: string | undefined
    let fallbackActive = false
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
      SessionStatus.set(sessionID, { type: "busy" })
      log.info("loop", { step, sessionID })
      if (abort.aborted) break
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
        ExecutionRuntime.finishInvocation(executionContext, "completed")
        if (lastUserMessage && isSyntheticContinuation(lastUserMessage)) {
          executionContext = await ExecutionRuntime.bindContinuation({
            sessionID,
            invocationID: lastUser.id,
            execution: executionContext,
          })
        } else {
          releaseExecutionLease?.()
          releaseExecutionLease = undefined
          executionContext = await ExecutionRuntime.resolveInvocation({
            sessionID,
            invocationID: lastUser.id,
            kind: session.parentID ? (/^(reviewer|checker)$/.test(lastUser.agent) ? "reviewer" : "child") : "root",
            acceptedMessageID: lastUser.id,
            resumesExecutionID: lastUser.resumesExecutionID,
          })
        }
        finishExecutionInvocation = (state) => ExecutionRuntime.finishInvocation(executionContext!, state)
      }
      {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        if (!trackExecution(sessionID, owner, executionContext)) {
          if (executionContext.rootSessionID === sessionID) ExecutionRuntime.cancelExecution(executionContext)
          else ExecutionRuntime.cancelInvocation(executionContext)
          break
        }
        releaseExecutionLease ??= ExecutionRuntime.holdLease(executionContext)
        abort = AbortSignal.any([owner.signal, ExecutionRuntime.leaseSignal(executionContext)])
      }
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
      if (
        lastAssistant?.finish &&
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        lastUser.id < lastAssistant.id
      ) {
        log.info("exiting loop", { sessionID })
        break
      }

      step++
      if (step === 1)
        ensureTitle({
          session,
          history: msgs,
        })

      const routingPrompt = msgs
        .findLast((message) => message.info.id === lastUser.id)
        ?.parts.filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
        .map((part) => part.text)
        .join("\n")
      const { ExecutionRuntime: RouteRuntime } = await import("@/core/execution/runtime")
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
          break
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
        if (returned === "blocked") break
        activeModel = undefined
        activeVariant = routeAfterApply.route.base.variant
        continue
      }
      let model: Provider.Model
      try {
        model =
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

      // pending subtask
      // TODO: centralize "invoke tool" logic
      if (task?.type === "subtask") {
        const taskTool = await TaskTool.init()
        const assistantMessage = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          parentID: lastUser.id,
          sessionID,
          agent: task.agent,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
        })) as MessageV2.Assistant
        let part = (await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessage.id,
          sessionID: assistantMessage.sessionID,
          type: "tool",
          callID: ulid(),
          tool: TaskTool.id,
          state: {
            status: "running",
            input: {
              prompt: task.prompt,
              description: task.description,
              subagent_type: task.agent,
              command: task.command,
            },
            time: {
              start: Date.now(),
            },
          },
        })) as MessageV2.ToolPart
        let taskArgs = {
          prompt: task.prompt,
          description: task.description,
          subagent_type: task.agent,
          command: task.command,
        }
        let executionError: Error | undefined
        const taskAgent = await Agent.get(task.agent)
        const taskCtx: Tool.Context = {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID: sessionID,
          abort,
          callID: part.callID,
          extra: { bypassAgentCheck: true, execution: executionContext },
          async metadata(input) {
            await Session.updatePart({
              ...part,
              type: "tool",
              state: {
                ...part.state,
                ...input,
              },
            } satisfies MessageV2.ToolPart)
          },
          async ask(req) {
            const latestSession = await Session.get(sessionID)
            await PermissionNext.ask({
              ...req,
              sessionID: sessionID,
              ruleset: PermissionNext.merge(taskAgent.permission, latestSession.permission ?? []),
            })
          },
        }
        const result = await ToolRuntime.execute({
          tool: "task",
          args: taskArgs,
          context: taskCtx,
          execute: (args, context) => taskTool.execute(args, context),
        }).catch((error) => {
          executionError = error
          log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
          return undefined
        })
        assistantMessage.finish = "tool-calls"
        assistantMessage.time.completed = Date.now()
        await Session.updateMessage(assistantMessage)
        if (result && part.state.status === "running") {
          await Session.updatePart({
            ...part,
            state: {
              status: "completed",
              input: part.state.input,
              title: result.title,
              metadata: result.metadata,
              output: result.output,
              attachments: result.attachments,
              time: {
                ...part.state.time,
                end: Date.now(),
              },
            },
          } satisfies MessageV2.ToolPart)
        }
        if (!result) {
          await Session.updatePart({
            ...part,
            state: {
              status: "error",
              error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
              time: {
                start: part.state.status === "running" ? part.state.time.start : Date.now(),
                end: Date.now(),
              },
              metadata: part.metadata,
              input: part.state.input,
            },
          } satisfies MessageV2.ToolPart)
        }

        // Add synthetic user message to prevent certain reasoning models from erroring
        // If we create assistant messages w/ out user ones following mid loop thinking signatures
        // will be missing and it can cause errors for models like gemini for example
        const summaryUserMsg: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID,
          role: "user",
          time: {
            created: Date.now(),
          },
          agent: lastUser.agent,
          model: lastUser.model,
        }
        await Session.updateMessage(summaryUserMsg)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: summaryUserMsg.id,
          sessionID,
          type: "text",
          text: "Summarize the task tool output above and continue with your task.",
          synthetic: true,
        } satisfies MessageV2.TextPart)

        continue
      }

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
      const agent = await Agent.get(lastUser.agent)
      const fastProfile = SessionExecutionProfile.get(sessionID) === "companion-fast"
      const maxSteps = agent.steps ?? (fastProfile ? 18 : Infinity)
      const isLastStep = step >= maxSteps
      msgs = insertReminders({
        messages: msgs,
        agent,
        step,
      })

      const currentModel = model

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: lastUser.id,
          role: "assistant",
          agent: agent.name,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: currentModel.id,
          providerID: currentModel.providerID,
          time: {
            created: Date.now(),
          },
          sessionID,
        })) as MessageV2.Assistant,
        sessionID: sessionID,
        model: currentModel,
        abort,
        initialFallbackModel: fallbackActive ? activeModel : undefined,
      })

      // Check if user explicitly invoked an agent via @ in this turn
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
      const hasPriorToolActivity = msgs.some((message) =>
        message.parts.some((part) => part.type === "tool" || part.type === "subtask"),
      )
      const loadedMcpNames = new Set<string>()

      const resolvedTools = shouldResolveTools(isLastStep)
        ? await resolveTools({
            agent,
            session,
            model,
            tools: lastUser.tools,
            processor,
            bypassAgentCheck,
            hasPriorToolActivity,
            loadedMcpNames,
            prompt: (lastUserMsg?.parts ?? [])
              .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
              .map((part) => part.text)
              .join("\n"),
            execution: executionContext,
          })
        : {}
      const routeState = RouteRuntime.view(executionContext.executionID)?.route
      const expertEpisodeID = routeState?.stage === "expert" ? routeState.activeEpisodeID : undefined
      const tools = expertEpisodeID
        ? Object.fromEntries(Object.entries(resolvedTools).filter(([name]) => ["read", "grep", "find"].includes(name)))
        : resolvedTools

      if (step === 1 && AgentEval.executionPolicy(sessionID).allowAuxiliarySummaries) {
        SessionSummary.summarize({
          sessionID: sessionID,
          messageID: lastUser.id,
        })
      }

      // F8: targeted shallow copy — only clone messages/parts that will be mutated
      const sessionMessages =
        step > 1 && lastFinished
          ? msgs.map((msg) => {
              if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) return msg
              // Check if any text parts need wrapping
              const needsWrap = msg.parts.some((p) => p.type === "text" && !p.ignored && !p.synthetic && p.text.trim())
              if (!needsWrap) return msg
              return {
                ...msg,
                parts: msg.parts.map((part) => {
                  if (part.type !== "text" || part.ignored || part.synthetic || !part.text.trim()) return part
                  return {
                    ...part,
                    text: [
                      "<system-reminder>",
                      "The user sent the following message:",
                      part.text,
                      "",
                      "Please address this message and continue with your tasks.",
                      "</system-reminder>",
                    ].join("\n"),
                  }
                }),
              }
            })
          : [...msgs]

      await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: sessionMessages })

      // Extract user text for context enrichment (memory recall + skill auto-injection)
      let userText = ""
      const lastUserWithParts = lastUser ? msgs.find((m) => m.info.id === lastUser.id) : undefined
      if (lastUserWithParts?.parts) {
        userText = lastUserWithParts.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as any).text)
          .join(" ")
      }

      // Run environment, custom rules, memory recalls and skill auto-injection in parallel
      const [environment, custom, memoryContext, coreMemoryContext, autoSkillContext] = await Promise.all([
        SystemPrompt.environment(userText, loadedMcpNames),
        SystemPrompt.custom(),
        userText ? recall(userText, { sessionID, technology: "general" }) : Promise.resolve(""),
        userText
          ? recallCoreMemories(userText, 3, { skipRerank: fastProfile, routeModel: lastUser?.model, sessionID })
          : Promise.resolve(""),
        userText ? SystemPrompt.autoInjectSkills(userText) : Promise.resolve(""),
      ])

      const system = [...environment, ...custom]
      if (tools.model_control)
        system.push(
          "For conversation model or thinking-level changes, use model_control (list then request), never repository searches or configuration edits. You can recommend a better model for difficult work using the same tool. Explain the reason in the user's language. A proposal is not a completed switch. Respect rejected requests; only claim a switch after the runtime confirms it. Current dispatch: " +
            currentModel.providerID +
            "/" +
            currentModel.id +
            " (thinking: " +
            (activeVariant ?? "default") +
            ").",
        )
      const routeDecision = RouteRuntime.routeProposalHistory(executionContext.executionID)
        .filter((proposal) => proposal.invocationID === executionContext.invocationID)
        .at(-1)
      if (routeDecision)
        system.push(
          `Model change result: ${routeDecision.state}; target: ${routeDecision.toRoute.providerID}/${routeDecision.toRoute.modelID}. Rejected or expired proposals did not change the model; do not repeat them without a new user request.`,
        )
      if (expertEpisodeID) {
        system.push(
          "You are in a bounded read-only expert episode. Analyze or review only; do not claim to mutate files, run commands, or finish the user's root task. Return a concise evidence-based handoff for the base model. Do not include hidden chain-of-thought.",
        )
      }
      if (memoryContext) system.push(memoryContext)
      if (coreMemoryContext) system.push(`<core_memory>\n${coreMemoryContext}\n</core_memory>`)
      if (autoSkillContext) system.push(autoSkillContext)
      const turnContext = prepareTurnContext(system, await MessageV2.toModelMessage(sessionMessages), isLastStep)

      const requiresFinalGate = !session.parentID
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      await ExecutionRuntime.admitStep({
        sessionID,
        stepID: processor.message.id,
        execution: executionContext,
      })
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
        },
        { deferText: requiresFinalGate },
      )
      // Update fallback model if it was set during processing
      if (result.fallbackModel) {
        activeModel = result.fallbackModel
        fallbackActive = true
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
      const terminalCandidate =
        result.status === "continue" &&
        processor.message.finish &&
        !["tool-calls", "unknown"].includes(processor.message.finish)
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
        const reviewDecision = (await evaluateReviewDecision(sessionID)).decision
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID,
          messageID: processor.message.id,
          finish: processor.message.finish!,
          parts: result.deferredTextParts ?? [],
          editedFiles,
          requiresReview: reviewDecision.requirement === "required",
          reviewDecision,
          execution: executionContext,
        })
        const outcome = await resolveCompletion({ sessionID, lastUser, execution: executionContext, candidate, abort })
        if (outcome === "retry") {
          continue
        }
        break
      }
      if (result.status === "stop") {
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
          })
          await projectAndAckCompletion(completion)
        }
        break
      }
      if (result.status === "compact") {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
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

  async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    hasPriorToolActivity: boolean
    loadedMcpNames: Set<string>
    prompt: string
    execution?: import("@/core/execution/runtime").ExecutionRuntime.Context
  }) {
    using _ = log.time("resolveTools")
    const explicitTools = Object.values(input.tools ?? {}).some((enabled) => enabled === true)
    const loadAll = shouldLoadTools({
      prompt: input.prompt,
      explicitTools,
      bypassAgentCheck: input.bypassAgentCheck,
      hasPriorToolActivity: input.hasPriorToolActivity,
    })
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, execution: input.execution },
      agent: input.agent.name,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        const latestSession = await Session.get(input.session.id)
        await PermissionNext.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: PermissionNext.merge(input.agent.permission, latestSession.permission ?? []),
        })
      },
    })

    const tool = await getTool()
    const jsonSchema = await getJsonSchema()

    for (const item of await ToolRegistry.tools(
      input.model.providerID,
      input.agent,
      loadAll ? undefined : new Set(["model_control"]),
    )) {
      if (item.id === "model_control" && input.session.parentID) continue
      const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: jsonSchema(schema as any),
        async execute(args, options) {
          const ctx = context(args, options)
          return ToolRuntime.execute({
            tool: item.id,
            args,
            context: ctx,
            execute: (nextArgs, nextContext) => item.execute(nextArgs, nextContext),
          })
        },
        toModelOutput(result) {
          return {
            type: "text",
            value: result.output,
          }
        },
      })
    }

    if (!loadAll) return tools
    // Timeout MCP tools loading to prevent hanging when MCP servers are slow/unreachable
    const mcpAbort = new AbortController()
    const mcpTimer = setTimeout(() => {
      mcpAbort.abort()
      log.debug("MCP tools are still initializing; skipping them for this turn")
    }, 250)
    const mcpTools = await MCP.tools(mcpAbort.signal, input.loadedMcpNames).catch(() => {
      // MCP.tools() is atomic for a turn: if a later client aborts, its partial
      // tool map is discarded, so discard the matching client metadata too.
      input.loadedMcpNames.clear()
      return {}
    })
    clearTimeout(mcpTimer)
    for (const [key, item] of Object.entries(mcpTools)) {
      const execute = item.execute
      if (!execute) continue

      // Wrap execute to add plugin hooks and format output
      item.execute = async (args, opts) => {
        const ctx = context(args, opts)
        return ToolRuntime.execute({
          tool: key,
          args,
          context: ctx,
          permission: async (_nextArgs, nextContext) =>
            nextContext.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] }),
          execute: async (nextArgs, nextContext) => {
            const result = await execute(nextArgs, { ...opts, abortSignal: nextContext.abort })
            const textParts: string[] = []
            const attachments: MessageV2.FilePart[] = []
            for (const contentItem of result.content) {
              if (contentItem.type === "text") textParts.push(contentItem.text)
              else if (contentItem.type === "image") {
                attachments.push({
                  id: Identifier.ascending("part"),
                  sessionID: input.session.id,
                  messageID: input.processor.message.id,
                  type: "file",
                  mime: contentItem.mimeType,
                  url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                })
              }
            }
            return {
              title: "",
              metadata: result.metadata ?? {},
              output: textParts.join("\n\n"),
              attachments,
              content: result.content,
            }
          },
        })
      }
      item.toModelOutput = (result) => {
        return {
          type: "text",
          value: result.output,
        }
      }
      tools[key] = item
    }

    return tools
  }

  async function createUserMessage(input: PromptInput) {
    const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
    const info: MessageV2.Info = {
      id: input.messageID ?? Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      tools: input.tools,
      agent: agent.name,
      model: input.model ?? agent.model ?? (await lastModel(input.sessionID)),
      system: input.system,
      variant: input.variant,
      modelPinned: input.modelPinned,
      thinkingPinned: input.thinkingPinned,
      resumesExecutionID: input.resumesExecutionID,
    }

    const parts = await Promise.all(
      input.parts.map(async (part): Promise<MessageV2.Part[]> => {
        if (part.type === "file") {
          // before checking the protocol we check if this is an mcp resource because it needs special handling
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })

            const pieces: MessageV2.Part[] = [
              {
                id: Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]

            try {
              const resourceContent = await MCP.readResource(clientName, uri)
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              // Handle different content types
              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : [resourceContent.contents]

              for (const content of contents) {
                if ("text" in content && content.text) {
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: content.text as string,
                  })
                } else if ("blob" in content && content.blob) {
                  // Handle binary content if needed
                  const mimeType = "mimeType" in content ? content.mimeType : part.mime
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mimeType}]`,
                  })
                }
              }

              pieces.push({
                ...part,
                id: part.id ?? Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
              })
            } catch (error: unknown) {
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                id: Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }

            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: DataUrl.decodeText(part.url),
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:":
              log.info("file", { mime: part.mime })
              // have to normalize, symbol search returns absolute paths
              // Decode the pathname since URL constructor doesn't automatically decode it
              const filepath = fileURLToPath(part.url)
              if (
                Instance.worktree &&
                !Filesystem.contains(Instance.worktree, filepath) &&
                !Filesystem.contains(Instance.directory, filepath)
              ) {
                throw new Error(`File path "${filepath}" is outside worktree boundary`)
              }
              const stat = await Bun.file(filepath).stat()

              if (stat.isDirectory()) {
                part.mime = "application/x-directory"
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  // some LSP servers (eg, gopls) don't give full range in
                  // workspace/symbol searches, so we'll try to find the
                  // symbol in the document to get the full range
                  if (start === end) {
                    const symbols = await LSP.documentSymbol(filePathURI)
                    for (const symbol of symbols) {
                      let range: LSP.Range | undefined
                      if ("range" in symbol) {
                        range = symbol.range
                      } else if ("location" in symbol) {
                        range = symbol.location.range
                      }
                      if (range?.start?.line && range?.start?.line === start) {
                        start = range.start.line
                        end = range?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start - 1, 0)
                  if (end) {
                    limit = end - offset
                  }
                }
                const args = { filePath: filepath, offset, limit }

                const pieces: MessageV2.Part[] = [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]

                await ReadTool.init()
                  .then(async (t) => {
                    const model = await Provider.getModel(info.model.providerID, info.model.modelID)
                    const readCtx: Tool.Context = {
                      sessionID: input.sessionID,
                      abort: new AbortController().signal,
                      agent: input.agent!,
                      messageID: info.id,
                      extra: { bypassCwdCheck: true, model },
                      metadata: async () => {},
                      ask: async () => {},
                    }
                    const result = await t.execute(args, readCtx)
                    pieces.push({
                      id: Identifier.ascending("part"),
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: result.output,
                    })
                    if (result.attachments?.length) {
                      pieces.push(
                        ...result.attachments.map((attachment) => ({
                          ...attachment,
                          synthetic: true,
                          filename: attachment.filename ?? part.filename,
                          messageID: info.id,
                          sessionID: input.sessionID,
                        })),
                      )
                    } else {
                      pieces.push({
                        ...part,
                        id: part.id ?? Identifier.ascending("part"),
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })
                    }
                  })
                  .catch((error) => {
                    log.error("failed to read file", { error })
                    const message = error instanceof Error ? error.message : error.toString()
                    Bus.publish(Session.Event.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({
                        message,
                      }).toObject(),
                    })
                    pieces.push({
                      id: Identifier.ascending("part"),
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    })
                  })

                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { path: filepath }
                const listCtx: Tool.Context = {
                  sessionID: input.sessionID,
                  abort: new AbortController().signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true },
                  metadata: async () => {},
                  ask: async () => {},
                }
                const result = await FindTool.init().then((t) => t.execute({ mode: "tree", path: filepath }, listCtx))
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the find tool with the following input: ${JSON.stringify({ mode: "tree", path: filepath })}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }

              const file = Bun.file(filepath)
              FileTime.read(input.sessionID, filepath)
              return [
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Called the Read tool with the following input: {\"filePath\":\"${filepath}\"}`,
                  synthetic: true,
                },
                {
                  id: part.id ?? Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url: `data:${part.mime};base64,` + Buffer.from(await file.bytes()).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
          }
        }

        // Handle skill injection for text parts
        if (part.type === "text" && part.text) {
          const skillMatches = ConfigMarkdown.files(part.text)
          const skillParts: MessageV2.Part[] = []
          const seenSkills = new Set<string>()

          for (const match of skillMatches) {
            const name = match[1]
            if (seenSkills.has(name)) continue

            const skill = await Skill.get(name)
            if (skill) {
              seenSkills.add(name)
              try {
                const parsed = await ConfigMarkdown.parse(skill.location)
                skillParts.push({
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `\n<skill name="${skill.name}">\n${parsed.content.trim()}\n</skill>\n`,
                })
              } catch (error) {
                log.error("failed to load skill", { name, error })
              }
            }
          }

          if (skillParts.length > 0) {
            return [
              {
                id: Identifier.ascending("part"),
                ...part,
                messageID: info.id,
                sessionID: input.sessionID,
              },
              ...skillParts,
            ]
          }
        }

        if (part.type === "agent") {
          // Check if this agent would be denied by task permission
          const perm = PermissionNext.evaluate("task", part.name, agent.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            {
              id: Identifier.ascending("part"),
              ...part,
              messageID: info.id,
              sessionID: input.sessionID,
            },
            {
              id: Identifier.ascending("part"),
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              // An extra space is added here. Otherwise the 'Use' gets appended
              // to user's last word; making a combined word
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [
          {
            id: Identifier.ascending("part"),
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    ).then((x) => x.flat())

    await Plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      {
        message: info,
        parts,
      },
    )

    await Session.updateMessage(info)
    for (const part of parts) {
      await Session.updatePart(part)
    }

    return {
      info,
      parts,
    }
  }

  export function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info; step: number }) {
    const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
    if (!userMessage) return input.messages

    const sessionID = userMessage.info.sessionID

    // Single pass: collect synthetic text + metadata to avoid 6 separate O(n×m) scans.
    // Each .some(m => m.parts.some(...)) previously scanned ALL messages × ALL parts.
    // Now one pass builds a Set for O(1) lookups instead.
    const syntheticTexts = new Set<string>()
    let hasTaskflowCall = false
    let wasPlan = false

    for (const msg of input.messages) {
      if (msg.info.role === "assistant" && msg.info.agent === "plan") wasPlan = true
      for (const part of msg.parts) {
        if (part.type === "tool" && (part.tool === "taskflow" || part.tool === "chainupdate")) {
          hasTaskflowCall = true
        }
        if (part.type === "text" && (part as any).synthetic) {
          syntheticTexts.add((part as any).text)
        }
      }
    }

    // Fast substring check across all synthetic texts
    const hasSyntheticText = (substr: string) => {
      for (const text of syntheticTexts) {
        if (text.includes(substr)) return true
      }
      return false
    }

    let aggregatedReminders: string[] = []

    if (!["reviewer", "checker", "explore", "plan"].includes(input.agent.name)) {
      const toolCallIDs = new Set<string>()
      for (const message of input.messages) {
        for (let index = 0; index < message.parts.length; index++) {
          const part = message.parts[index]
          if (part.type !== "tool") continue
          toolCallIDs.add(part.id || `${message.info.id}:${index}`)
        }
      }
      const progress = HarnessState.consumeTaskflowReminder({
        sessionID,
        toolCallCount: toolCallIDs.size,
      })
      if (progress) {
        const completed = progress.steps.filter((step) => step.status === "completed").length
        const visibleSteps = progress.steps.slice(0, 20)
        const omitted = progress.steps.length - visibleSteps.length
        aggregatedReminders.push(
          [
            `<taskflow_progress trigger="${progress.trigger}" tool_calls_since_last="${progress.toolCallsSinceLast}">`,
            `Taskflow progress: ${completed}/${progress.steps.length} completed.`,
            ...visibleSteps.map((step) => `- [${step.status}] ${escapeXmlText(step.id)}: ${escapeXmlText(step.name)}`),
            ...(omitted > 0 ? [`- ... ${omitted} additional step(s) omitted from this bounded reminder.`] : []),
            progress.statusUnchanged
              ? `Taskflow status has not changed since the previous checkpoint. Reconcile the active task and call taskflow update/complete/fail if its recorded status is stale.`
              : `Review the active task and keep taskflow status synchronized as work proceeds.`,
            `This reminder is advisory: do not mark work complete without evidence.`,
            `</taskflow_progress>`,
          ].join("\n"),
        )
      }
    }

    if (input.agent.name === "plan" && !syntheticTexts.has(PROMPT_PLAN)) {
      aggregatedReminders.push(PROMPT_PLAN)
    }

    if (wasPlan && input.agent.name === "build") {
      if (!syntheticTexts.has(BUILD_SWITCH)) {
        aggregatedReminders.push(BUILD_SWITCH)
      }

      // Plan→Build barrier: require an active taskflow plan before writing code
      const hasActivePlan = HarnessState.hasActivePlan(sessionID)
      if (!hasActivePlan && input.step <= 2 && !hasSyntheticText("plan_barrier")) {
        aggregatedReminders.push(
          [
            "<plan_barrier>",
            "⛔ PLAN→BUILD TRANSITION BARRIER",
            "No active taskflow plan found. Before writing any code you MUST:",
            '1. Call taskflow [action="start", plan=[...]] to load the plan steps',
            "2. Set the first step to running with taskflow update before proceeding",
            "Do NOT skip this step. Jumping directly to code without an active taskflow violates the AUTONOMOUS_GOAL_LOOP rules.",
            "</plan_barrier>",
          ].join("\n"),
        )
      }
    }

    if (
      input.step > 2 &&
      !hasTaskflowCall &&
      !hasSyntheticText("chain_reminder") &&
      !["explore", "reviewer", "checker"].includes(input.agent.name)
    ) {
      aggregatedReminders.push(
        "<chain_reminder>⚠️ Step threshold exceeded (>2 steps) without active progress plan. You SHOULD call taskflow [action=start] to initialize progress tracking for the user.</chain_reminder>",
      )
    }

    // ── Harness: BLOCKING ORCHESTRATION MODE reminder ─────────────────────
    if (!["reviewer", "checker", "explore", "plan"].includes(input.agent.name)) {
      const activeWorkflowId = HarnessState.getActiveWorkflowId(sessionID)
      if (activeWorkflowId && !hasSyntheticText("orchestrator_blocking")) {
        aggregatedReminders.push(
          [
            `<orchestrator_blocking workflowId="${activeWorkflowId}">`,
            `⛔ BLOCKING ORCHESTRATION MODE — workflow ${activeWorkflowId} is executing.`,
            `ALL sub-agents are running. You CANNOT do any other work right now.`,
            `Do NOT claim you are doing anything in parallel. You are blocked until all tasks complete.`,
            `When orchestration finishes, you will receive the combined results automatically.`,
            `</orchestrator_blocking>`,
          ].join("\n"),
        )
      }
    }

    // ── Dynamic edit-count reminders (harness enforcement) ──────────────────
    if (!["reviewer", "checker", "plan", "explore"].includes(input.agent.name)) {
      const editCount = HarnessState.getEditedFileCount(sessionID)
      const hasCritical = HarnessState.hasCriticalEdit(sessionID)

      if (!hasSyntheticText("edit_reminder")) {
        if (hasCritical) {
          aggregatedReminders.push(
            [
              '<edit_reminder type="critical">',
              "⚠️ System Reminder: A CRITICAL file (auth/config/database/migration/env/secret) was modified.",
              "You MUST verify correctness before continuing. Run the project typecheck and test commands now.",
              "</edit_reminder>",
            ].join("\n"),
          )
        } else if (editCount >= 1) {
          aggregatedReminders.push(
            [
              `<edit_reminder type="high" count="${editCount}">`,
              `⚠️ System Reminder: ${editCount}+ file edit(s) detected in this session.`,
              "The review gate is ACTIVE: taskflow action='clear' is code-level blocked until the",
              "reviewer sub-agent returns PASS on your changes. Before calling clear:",
              "1. Run the project test and typecheck commands and capture raw output",
              "2. Fix any failures — the reviewer will independently verify with raw logs",
              "</edit_reminder>",
            ].join("\n"),
          )
        }
      }
    }

    if (aggregatedReminders.length > 0) {
      input.messages.push({
        info: {
          id: Identifier.ascending("message"),
          sessionID: sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: input.agent.name,
          model: (userMessage.info as MessageV2.User).model,
        } as MessageV2.User,
        parts: aggregatedReminders.map(
          (text) =>
            ({
              id: Identifier.ascending("part"),
              messageID: "", // Replaced during generation, but not needed for in-memory mapping
              sessionID: sessionID,
              type: "text",
              text: text,
              synthetic: true,
            }) as MessageV2.TextPart,
        ),
      })
    }

    return input.messages
  }

  export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  export async function shell(input: ShellInput) {
    const owner = start(input.sessionID)
    if (!owner) {
      throw new Session.BusyError(input.sessionID)
    }
    const abort = owner.signal
    using _ = defer(() => finish(input.sessionID, owner))

    const session = await Session.get(input.sessionID)
    if (session.revert) {
      SessionRevert.cleanup(session)
    }
    const agent = await Agent.get(input.agent)
    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
      id: input.messageID ?? Identifier.ascending("message"),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await Session.updateMessage(userMsg)
    const userPart: MessageV2.Part = {
      type: "text",
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
      synthetic: true,
    }
    await Session.updatePart(userPart)

    const msg: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      agent: input.agent,
      cost: 0,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await Session.updatePart(part)
    const shell = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
      nu: {
        args: ["-c", input.command],
      },
      fish: {
        args: ["-c", input.command],
      },
      zsh: {
        args: [
          "-c",
          "-l",
          `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      bash: {
        args: [
          "-c",
          "-l",
          `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      // Windows cmd
      cmd: {
        args: ["/c", input.command],
      },
      // Windows PowerShell
      powershell: {
        args: ["-NoProfile", "-Command", input.command],
      },
      pwsh: {
        args: ["-NoProfile", "-Command", input.command],
      },
      // Fallback: any shell that doesn't match those above
      //  - No -l, for max compatibility
      "": {
        args: ["-c", `${input.command}`],
      },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const proc = spawn(shell, args, {
      cwd: Instance.directory,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: EnvPolicy.build({ cwd: Instance.directory, scope: "session:shell", overrides: { TERM: "dumb" } }),
    })

    let output = ""
    let outputUpdateTimer: ReturnType<typeof setTimeout> | undefined
    let outputUpdate = Promise.resolve()

    const flushOutput = () => {
      outputUpdateTimer = undefined
      const snapshot = output
      outputUpdate = outputUpdate
        .then(async () => {
          if (part.state.status !== "running") return
          part.state.metadata = { output: snapshot, description: "" }
          await Session.updatePart(part)
        })
        .catch((error) => {
          log.warn("failed to publish batched shell output", {
            sessionID: input.sessionID,
            error: error instanceof Error ? error.name : "UnknownError",
          })
        })
    }

    const appendOutput = (chunk: unknown) => {
      output = appendShellOutput(output, String(chunk))
      if (!outputUpdateTimer) outputUpdateTimer = setTimeout(flushOutput, SHELL_UPDATE_INTERVAL_MS)
    }

    proc.stdout?.on("data", (chunk) => {
      appendOutput(chunk)
    })

    proc.stderr?.on("data", (chunk) => {
      appendOutput(chunk)
    })

    let aborted = false
    let exited = false

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        exited = true
        abort.removeEventListener("abort", abortHandler)
        resolve()
      })
    })

    if (outputUpdateTimer) {
      clearTimeout(outputUpdateTimer)
      outputUpdateTimer = undefined
    }
    await outputUpdate

    if (aborted) {
      output = appendShellOutput(output, "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n"))
    }
    msg.time.completed = Date.now()
    await Session.updateMessage(msg)
    if (part.state.status === "running") {
      part.state = {
        status: "completed",
        time: {
          ...part.state.time,
          end: Date.now(),
        },
        input: part.state.input,
        title: "",
        metadata: {
          output,
          description: "",
        },
        output,
      }
      await Session.updatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  export const CommandInput = z.object({
    messageID: Identifier.schema("message").optional(),
    sessionID: Identifier.schema("session"),
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    modelPinned: z.boolean().optional(),
    thinkingPinned: z.boolean().optional(),
    parts: z
      .array(
        z.discriminatedUnion("type", [
          MessageV2.FilePart.omit({
            messageID: true,
            sessionID: true,
          }).partial({
            id: true,
          }),
        ]),
      )
      .optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>
  const bashRegex = /!`([^`]+)`/g
  // Match [Image N] as single token, quoted strings, or non-space sequences
  const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
  const placeholderRegex = /\$(\d+)/g
  const quoteTrimRegex = /^["']|["']$/g
  /**
   * Regular expression to match @ file references in text
   * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
   * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
   */

  export async function command(input: CommandInput) {
    log.info("command", input)
    const command = await Command.get(input.command)
    const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())

    const raw = input.arguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    const templateCommand = await command.template

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
      const value = Number(item.slice(1))
      if (value > last) last = value
    }

    // Let the final placeholder swallow any extra arguments so prompts read naturally
    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= args.length) return ""
      if (position === last) return args.slice(argIndex).join(" ")
      return args[argIndex]
    })
    let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

    const shell = ConfigMarkdown.shell(template)
    if (shell.length > 0) {
      const results = await Promise.all(
        shell.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`
              .env(EnvPolicy.build({ cwd: Instance.directory, scope: "session:command-template" }))
              .quiet()
              .nothrow()
              .text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )
      let index = 0
      template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    // System commands: handle directly without AI (e.g., "skill" lists installed skills)
    if (input.command === Command.Default.SKILL) {
      const msgId = Identifier.ascending("message")
      const now = Date.now()
      const msg = (await Session.updateMessage({
        id: msgId,
        sessionID: input.sessionID,
        role: "assistant",
        parentID: input.messageID ?? Identifier.ascending("message"),
        agent: agentName,
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: "",
        providerID: "",
        time: { created: now, completed: now },
      })) as MessageV2.Assistant

      const part = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "text",
        text: template,
      })

      Bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: msg.id,
      })

      return { info: msg, parts: [part] } as MessageV2.WithParts
    }

    const model = await (async () => {
      if (command.model) {
        return Provider.parseModel(command.model)
      }
      if (command.agent) {
        const cmdAgent = await Agent.get(command.agent)
        if (cmdAgent?.model) {
          return cmdAgent.model
        }
      }
      if (input.model) return Provider.parseModel(input.model)
      return await lastModel(input.sessionID)
    })()

    try {
      await Provider.getModel(model.providerID, model.modelID)
    } catch (e) {
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const { providerID, modelID, suggestions } = e.data
        const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
        })
      }
      throw e
    }
    const agent = await Agent.get(agentName)
    if (!agent) {
      const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }

    const templateParts = await resolvePromptParts(template)
    const parts =
      (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: command.description ?? "",
              command: input.command,
              // TODO: how can we make task tool accept a more complex input?
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

    const result = (await prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      model,
      agent: agentName,
      parts,
      variant: input.variant,
      modelPinned: input.modelPinned,
      thinkingPinned: input.thinkingPinned,
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
      messageID: result.info.id,
    })

    return result
  }

  async function ensureTitle(input: { session: Session.Info; history: MessageV2.WithParts[] }) {
    if (!AgentEval.executionPolicy(input.session.id).allowAuxiliarySummaries) return
    if (input.session.parentID) return
    if (!Session.isDefaultTitle(input.session.title)) return

    // Find first non-synthetic user message
    const firstRealUserIdx = input.history.findIndex(
      (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
    )
    if (firstRealUserIdx === -1) return

    const isFirst =
      input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
        .length === 1
    if (!isFirst) return

    const firstRealUser = input.history[firstRealUserIdx]

    // For subtask-only messages (from command invocations), extract the prompt directly
    // since toModelMessage converts subtask parts to generic "The following tool was executed by the user"
    const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
    const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

    const text = hasOnlySubtaskParts
      ? subtaskParts.map((part) => part.prompt).join(" ")
      : firstRealUser.parts
          .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
          .map((part) => part.text)
          .join(" ")
    const title = SessionSummary.localTitle(text)
    if (!title) return
    return Session.update(input.session.id, (draft) => {
      draft.title = title
    })
  }
}
