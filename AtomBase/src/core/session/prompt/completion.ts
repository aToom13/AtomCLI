import { Identifier } from "@/core/id/id"
import { Storage } from "@/core/storage/storage"
import { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { Bus } from "../../bus"
import { Session } from ".."
import { HarnessState, type ExecutionLog } from "../harness-state"
import { MessageV2 } from "../message-v2"
import { PromptFinalization } from "./finalization"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "@/util/util/filesystem"
import { TaskVerification } from "@/core/execution/task-verification"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { VerificationEvidence } from "@/core/execution/verification-evidence"
import { PermissionNext } from "@/util/permission/next"

const { reviewRetryText, reviewBlockedText } = PromptFinalization
const MAX_COMPLETION_DESCENDANT_DEPTH = 32
const MAX_COMPLETION_DESCENDANT_SESSIONS = 500

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
  if (!PromptFinalization.isUserFacingReport(input.text))
    input = {
      ...input,
      status: "inconclusive",
      text: "The expert returned empty output or unexecuted tool protocol. No successful handoff is claimed; use structured tool calls to continue.",
    }
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

function reviewEvidenceFiles(messages: MessageV2.WithParts[], notBefore = 0): string[] {
  const turnStart = messages.findLastIndex(
    (message) => message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
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
    for (const filepath of reviewEvidenceFiles(messages, notBefore)) HarnessState.restoreEditedFile(sessionID, filepath)
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
    (message) => message.info.role === "user" && !message.parts.every((part) => "synthetic" in part && part.synthetic),
  )
  const turnStartedAt = rootTurn?.info.time.created ?? 0
  for (const current of await completionSessionTree(sessionID)) {
    await restoreReviewEvidence(current, current === sessionID ? 0 : turnStartedAt)
    for (const filepath of HarnessState.getEditedFiles(current)) files.add(filepath)
  }
  return [...files]
}

function reviewFromDurableClaim(state: "passed" | "rejected" | "inconclusive"): {
  passed: boolean
  exhausted: boolean
  skipped: boolean
  reason?: string
  error?: boolean
} {
  if (state === "passed") return { passed: true, exhausted: false, skipped: true }
  if (state === "rejected")
    return {
      passed: false,
      exhausted: true,
      skipped: true,
      reason: "The current revision was already reviewed and rejected.",
    }
  return {
    passed: false,
    exhausted: true,
    skipped: true,
    error: true,
    reason: "The current revision review was inconclusive.",
  }
}

/**
 * `commitCompletion` rejects with a `stale_*` reason when the workspace or the
 * execution state moved after the completion was staged. Re-hydrating and
 * retrying is the deterministic recovery, and the step budget already bounds
 * the number of attempts. These reasons are optimistic-concurrency conflicts
 * only: lifecycle reasons (`not_active`, `terminal_outcome`) must not be
 * retried, and `stale_fence` means another owner took the lease, so retrying
 * it would risk split-brain. `review_required` and `active_blocker` are flow
 * control signals handled at their own call sites.
 */
const RETRYABLE_STALE_REASONS = new Set([
  "stale_revision",
  "stale_plan_revision",
  "stale_route",
  "stale_content_snapshot",
  "stale_policy",
  "stale_candidate",
])
// An external writer that keeps mutating the workspace (formatter, watcher,
// git hook, a second AtomCLI) would otherwise livelock the turn, so cap
// consecutive conflicts and fall back to a blocked completion.
const MAX_STALE_COMMIT_RETRIES = 3
const STALE_COMMIT_BACKOFF_MS = 250
const STALE_COMMIT_COUNTER_TTL_MS = 30 * 60 * 1000
const staleCommitConflicts = Instance.sessionState(() => new Map<string, { count: number; at: number }>())

function recordStaleCommitConflict(executionID: string) {
  const now = Date.now()
  const counters = staleCommitConflicts()
  for (const [id, entry] of counters) {
    if (now - entry.at >= STALE_COMMIT_COUNTER_TTL_MS) counters.delete(id)
  }
  const entry = counters.get(executionID)
  if (!entry) counters.set(executionID, { count: 1, at: now })
  else entry.count++
  return counters.get(executionID)!.count
}

function clearStaleCommitConflicts(executionID: string) {
  staleCommitConflicts().delete(executionID)
}

async function directoryDeliveryIssues(input: {
  sessionID: string
  executionID: string
  candidate: import("@/core/execution/runtime").ExecutionRuntime.Completion
}) {
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const messages = await Session.messages({ sessionID: input.sessionID })
  const start = messages.findIndex(
    (message) => message.info.id === ExecutionRuntime.view(input.executionID)?.userMessageID,
  )
  if (start < 0) return []
  let directories: string[] = []
  // ponytail: explicit inline-code English/Turkish directory targets; structured acceptance covers broader goals.
  for (const message of messages.slice(start)) {
    if (message.info.role !== "user") continue
    const text = message.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
      .map((part) => part.text)
      .join("\n")
      .replace(/```[\s\S]*?```/g, "")
    if (!/\b(create|write|implement)\b|oluştur|yaz/i.test(text)) continue
    const targets = [
      ...text.matchAll(
        /(?:\b(?:in|inside|under)\s+(?:the\s+)?(?:directory\s+|folder\s+)?`([^`\n]+)`|`([^`\n]+)`\s+(?:klasöründe|dizininde|içinde))/gi,
      ),
    ].map((match) => match[1] ?? match[2])
    if (targets.length) directories = targets.map((target) => path.resolve(Instance.directory, target))
  }
  if (!directories.length) return []
  const edited = input.candidate.editedFiles.map((file) => path.resolve(Instance.directory, file))
  const liveFiles = (
    await Promise.all(
      edited.map(
        async (file) =>
          await fs
            .stat(file)
            .then((entry) => (entry.isFile() ? file : undefined))
            .catch(() => undefined),
      ),
    )
  ).filter((file): file is string => Boolean(file))
  const names = liveFiles.length
    ? liveFiles.map((file) => path.basename(file))
    : input.candidate.parts.flatMap((part) =>
        [...part.text.matchAll(/`([^`\n\s/\\]+\.[a-zA-Z0-9]+)`/g)].map((match) => match[1]),
      )
  if (!names.length) return []
  const issues: string[] = []
  for (const directory of directories) {
    if (liveFiles.some((file) => Filesystem.contains(directory, file))) continue
    if (!Filesystem.contains(Instance.directory, directory)) {
      issues.push(`requested directory ${directory} has no verified deliverable files`)
      continue
    }
    const realDirectory = await fs.realpath(directory).catch(() => undefined)
    const workspace = await fs.realpath(Instance.directory)
    const present =
      realDirectory &&
      Filesystem.contains(workspace, realDirectory) &&
      (
        await Promise.all(
          names.map((name) =>
            fs
              .lstat(path.join(realDirectory, name))
              .then((entry) => entry.isFile())
              .catch(() => false),
          ),
        )
      ).some(Boolean)
    if (!present)
      issues.push(
        `requested directory ${directory} is missing deliverable files (${[...new Set(names)].join(", ")}); observed edits: ${liveFiles.join(", ") || "none"}`,
      )
  }
  return issues
}

async function resolveCompletion(input: {
  sessionID: string
  lastUser: MessageV2.User
  execution: import("@/core/execution/runtime").ExecutionRuntime.Context
  candidate: import("@/core/execution/runtime").ExecutionRuntime.Completion
  abort: AbortSignal
  allowRetry?: boolean
}): Promise<"committed" | "blocked" | "retry"> {
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  input.abort.throwIfAborted()
  if (input.candidate.state === "committed") {
    await projectAndAckCompletion(input.candidate)
    return input.candidate.outcome === "blocked" ? "blocked" : "committed"
  }
  const retry = async (reason?: string, independentReview = true) => {
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
      text: independentReview
        ? reviewRetryText(reason)
        : `The final response was withheld because completion preconditions failed.\n${reason ?? "Verify the requested result before finishing."}`,
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
  const candidateText = input.candidate.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  // Internal review candidates may contain no text parts; validate every report that is actually supplied.
  const malformedReport =
    input.candidate.parts.some((part) => part.type === "text") && !PromptFinalization.isUserFacingReport(candidateText)
  if (malformedReport)
    blockers.push("final response is empty or contains unexecuted tool protocol; use structured tool calls")
  const staticChecks = await TaskVerification.staticChecks(
    input.candidate.editedFiles,
    Instance.directory,
    input.sessionID,
  )
  blockers.push(...staticChecks.filter((check) => !check.ok).map((check) => check.evidence))
  const directoryIssues = await directoryDeliveryIssues({
    sessionID: input.sessionID,
    executionID: input.execution.executionID,
    candidate: input.candidate,
  })
  blockers.push(...directoryIssues)
  const rootMessages = await Session.messages({ sessionID: input.sessionID })
  const accepted = rootMessages.find(
    (message) => message.info.id === ExecutionRuntime.view(input.execution.executionID)?.userMessageID,
  )
  const verificationStart = accepted?.info.time.created ?? input.lastUser.time.created
  const failedChecks = async () => {
    const failures: string[] = []
    const builds: { command: string; timestamp: number; snapshot: TaskVerification.BuildSnapshot }[] = []
    for (const sessionID of await completionSessionTree(input.sessionID)) {
      const messages = sessionID === input.sessionID ? rootMessages : await Session.messages({ sessionID })
      const logs: ExecutionLog[] = [...HarnessState.getLastLogs(sessionID)]
      for (const message of messages) {
        for (const part of message.parts) {
          if (part.type !== "tool" || part.tool !== "bash" || part.state.status !== "completed") continue
          const command = part.state.input.command
          const exit = part.state.metadata.exit
          if (typeof command !== "string" || (typeof exit !== "number" && exit !== null)) continue
          const snapshot = TaskVerification.BuildSnapshot.safeParse(part.state.metadata.sourceSnapshot)
          if (part.state.time.end >= verificationStart && snapshot.success) {
            builds.push({ command, timestamp: part.state.time.end, snapshot: snapshot.data })
          }
          logs.push({
            command,
            verificationSimple:
              typeof part.state.metadata.verificationSimple === "boolean"
                ? part.state.metadata.verificationSimple
                : undefined,
            workdir:
              typeof part.state.metadata.workdir === "string"
                ? part.state.metadata.workdir
                : typeof part.state.input.workdir === "string"
                  ? path.resolve(
                      message.info.role === "assistant" ? message.info.path.cwd : Instance.directory,
                      part.state.input.workdir,
                    )
                  : message.info.role === "assistant"
                    ? message.info.path.cwd
                    : Instance.directory,
            output: part.state.output,
            exitCode: exit,
            timestamp: part.state.time.end,
          })
        }
      }
      failures.push(...HarnessState.failedVerificationCommands(sessionID, verificationStart, logs))
    }
    failures.push(...(await TaskVerification.staleBuildChecks(builds, input.candidate.editedFiles, Instance.directory)))
    return failures
  }
  const failedVerification = await failedChecks()
  blockers.push(...failedVerification.map((command) => `verification failed: ${command}`))
  const contract = ExecutionRuntime.getExecutionContract(input.execution.executionID)
  const evidence = ExecutionRuntime.getExecutionEvidence(input.execution.executionID)
  const checkpoint = ExecutionRuntime.checkpoints(input.execution.executionID).at(-1)
  const referencedChecks = new Map<string, NonNullable<ExecutionCheckpoint.Result["checks"]>[number]>()
  for (const record of ExecutionRuntime.checkpoints(input.execution.executionID))
    for (const check of record.payload?.checkpoint?.checks ?? []) referencedChecks.set(check.name, check)
  const checkResults = await VerificationEvidence.resolve(
    input.sessionID,
    [...referencedChecks.values()],
    verificationStart,
  )
  blockers.push(
    ...checkResults
      .filter((check) => check.status !== "PASS")
      .map((check) => `${check.name}: ${check.status} (${check.reason})`),
  )
  // ponytail: unchanged assessments only; semantic proof remains with task acceptance.
  if (
    checkpoint?.decision === "continue" &&
    checkpoint.payload?.checkpoint?.remainingWork?.length &&
    typeof checkpoint.payload?.evidence?.toolCalls === "number" &&
    checkpoint.payload?.evidence?.toolCalls === evidence?.toolCalls
  )
    blockers.push("the checkpoint still requires work; no tools ran after its unfinished assessment")
  const { Skill } = await import("@/integrations/skill")
  blockers.push(...(await Skill.pendingSessionReads(input.sessionID, input.execution, input.lastUser.id)))
  if (
    contract?.expectedSurfaces.includes("browser") &&
    (input.candidate.editedFiles.length || contract.needsExternalAction || contract.intent === "operate")
  ) {
    if (!evidence?.browserNavigations)
      blockers.push(
        "the inspected site or browser deliverable needs navigation/reload at its original URL after the latest source or unknown write-effect tool; serving a text findings report does not verify the site",
      )
    const criteria = (contract.acceptance ?? []).join("\n")
    const inspectionIntent = ["inspect", "operate"].includes(contract.intent)
    const inspectAccessibility = inspectionIntent && /\baccessibility\b/i.test(criteria)
    const inspectNetwork = inspectionIntent && /\bnetwork\b/i.test(criteria)
    const inspectionOnly =
      inspectionIntent &&
      (inspectAccessibility || inspectNetwork) &&
      !/\b(screenshot|visual|render(?:ing)?|game(?:play)?|pointer|keyboard|animation)\b/i.test(criteria)
    if (inspectAccessibility && !evidence?.browserAccessibilityCalls)
      blockers.push("the inspected site has no successful accessibility inspection")
    if (inspectNetwork && !evidence?.browserNetworkCalls)
      blockers.push("the inspected site has no successful network inspection")
    if (!evidence?.browserVerificationCalls && !inspectionOnly)
      blockers.push("the browser deliverable has no visual or behavior check")
  }
  if (HarnessState.hasActivePlan(input.sessionID, input.execution.executionID))
    blockers.push("the taskflow plan is still open")
  const workflowID = HarnessState.getActiveWorkflowId(input.sessionID)
  if (workflowID) blockers.push(`workflow ${workflowID} is still running`)
  const { SubAgentLifecycle } = await import("@/integrations/tool/subagent-lifecycle")
  for (const childID of (await completionSessionTree(input.sessionID)).slice(1)) {
    if (SubAgentLifecycle.status(childID).status === "running") {
      blockers.push(`child session ${childID} is running`)
    }
  }
  if (blockers.length) {
    const reason = [
      `Completion preconditions failed: ${blockers.join("; ")}.`,
      ...(failedVerification.length
        ? [
            "After repairs, rerun the failed verification commands listed above successfully in the same working directory. Passing individual files does not clear a failed grouped or directory test run. Inspect and fix any remaining failures; do not change test expectations to bypass them.",
          ]
        : []),
    ].join("\n")
    const protocolRetries = rootMessages.filter(
      (message) =>
        message.info.time.created >= verificationStart &&
        message.parts.some(
          (part) => part.type === "text" && part.synthetic && part.text.includes("contains unexecuted tool protocol"),
        ),
    ).length
    if (
      input.allowRetry !== false &&
      (!malformedReport || protocolRetries < ExecutionCheckpoint.MAX_INVALID_RESPONSES - 1)
    )
      return retry(reason, false)
    await ExecutionRuntime.discardCompletion({
      sessionID: input.sessionID,
      execution: input.execution,
      digest: input.candidate.digest,
    })
    const original = input.candidate.parts[0]
    const candidateText = input.candidate.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
      .trim()
    const failure: import("@/core/execution/runtime").ExecutionRuntime.TerminalFailure = malformedReport
      ? { outcome: "blocked", reasonCode: "verification_required", reasonMessage: reason, retryable: false }
      : ExecutionRuntime.classifyTerminalFailure(
          new ExecutionRuntime.BudgetExceededError("step_limit", input.execution.executionID),
        )
    const completion = ExecutionRuntime.finalizeOutcome({
      sessionID: input.sessionID,
      messageID: input.candidate.messageID,
      execution: input.execution,
      failure: {
        ...failure,
        reasonMessage: malformedReport
          ? `${reason} Protocol recovery stopped without successful completion.`
          : `${reason} Execution stopped at its step limit; send another message to continue.`,
      },
      parts: [
        {
          ...(original ?? {
            id: Identifier.ascending("part"),
            messageID: input.candidate.messageID,
            sessionID: input.sessionID,
            type: "text" as const,
            time: { start: Date.now(), end: Date.now() },
          }),
          text: [
            directoryIssues.length || malformedReport ? "" : candidateText,
            `Execution status: technical blocker. ${reason}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          synthetic: true,
          metadata: { ...original?.metadata, blockerKind: "technical" },
        },
      ],
    })
    await projectAndAckCompletion(completion)
    return "blocked"
  }
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
  // REV-03: a decided claim for the same digest+revision is the single
  // durable review decision. Re-running reviewers would waste budget and
  // could silently diverge from the recorded verdict.
  const review =
    reviewClaim && reviewClaim.state !== "pending"
      ? reviewFromDurableClaim(reviewClaim.state)
      : !reviewClaim
        ? undefined
        : await runBlockingReview(input.sessionID, {
            signal: input.abort,
            requestRetry:
              input.allowRetry === false
                ? undefined
                : async (reason) => {
                    input.abort.throwIfAborted()
                    const session = await Session.get(input.sessionID)
                    const requestID = Identifier.ascending("permission")
                    const cancel = () => {
                      void PermissionNext.reply({ requestID, reply: "reject" })
                    }
                    // Permission state initializes asynchronously; catch abort both
                    // before registration and while the request is visible.
                    const unsubscribe = Bus.subscribe(PermissionNext.Event.Asked, (event) => {
                      if (event.properties.id === requestID && input.abort.aborted) cancel()
                    })
                    input.abort.addEventListener("abort", cancel, { once: true })
                    try {
                      await PermissionNext.ask({
                        id: requestID,
                        permission: "review.retry",
                        sessionID: input.sessionID,
                        patterns: [`${input.execution.executionID}:${input.candidate.digest}`],
                        always: [],
                        ruleset: session.permission ?? [],
                        metadata: {
                          reason,
                          description:
                            "Retry independent review up to three more times; rejection keeps completion blocked. This does not waive review or acceptance checks.",
                        },
                      })
                      input.abort.throwIfAborted()
                      return true
                    } catch (error) {
                      if (
                        error instanceof PermissionNext.RejectedError ||
                        error instanceof PermissionNext.CorrectedError ||
                        error instanceof PermissionNext.DeniedError
                      )
                        return false
                      throw error
                    } finally {
                      unsubscribe()
                      input.abort.removeEventListener("abort", cancel)
                    }
                  },
            executionID: input.execution.executionID,
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
  if (review?.error) {
    const failed = await failedChecks()
    if (failed.length) {
      review.error = false
      review.reason = `Verification failed: ${failed.join("; ")}`
    }
  }
  if (!review || review.passed) {
    if (review?.passed && input.candidate.requiresReview && HarnessState.needsReview(input.sessionID)) {
      if (input.allowRetry === false) {
        const original = input.candidate.parts[0]
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
              text: "The workspace changed after review. Execution stopped at its step limit; send another message to continue.",
              synthetic: true,
              metadata: { ...original?.metadata, reviewGate: "blocked" },
            },
          ],
          execution: input.execution,
          reasonCode: "review_rejected",
          reasonMessage:
            "The workspace changed after review. Execution stopped at its step limit; send another message to continue.",
        })
        await projectAndAckCompletion(blocked)
        return "blocked"
      }
      return retry("The workspace changed after review; the current revision must be reviewed again.")
    }
    const blockStaleCommit = async (reasonMessage: string) => {
      const original = input.candidate.parts[0]
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
            text: reasonMessage,
            synthetic: true,
            metadata: { ...original?.metadata, reviewGate: "blocked" },
          },
        ],
        execution: input.execution,
        reasonCode: "review_rejected",
        reasonMessage,
      })
      await projectAndAckCompletion(blocked)
      return "blocked" as const
    }
    const committed = await ExecutionRuntime.commitCompletion({
      sessionID: input.sessionID,
      execution: input.execution,
      digest: input.candidate.digest,
    }).catch(async (error) => {
      if (error instanceof ExecutionRuntime.BudgetExceededError && RETRYABLE_STALE_REASONS.has(error.reason)) {
        const conflicts = recordStaleCommitConflict(input.execution.executionID)
        if (conflicts > MAX_STALE_COMMIT_RETRIES) {
          return blockStaleCommit(
            "The workspace or execution state kept changing while this completion was being committed. Execution stopped; send another message to continue.",
          )
        }
        if (input.allowRetry === false) {
          return blockStaleCommit(
            "The workspace changed after review. Execution stopped at its step limit; send another message to continue.",
          )
        }
        // Give whatever moved the workspace a moment to settle so a burst of
        // conflicts resolves on the next attempt instead of consuming the cap.
        await Bun.sleep(STALE_COMMIT_BACKOFF_MS)
        return retry("The workspace changed after review; the current revision must be reviewed again.")
      }
      throw error
    })
    if (committed === "retry" || committed === "blocked") return committed
    await projectAndAckCompletion(committed)
    clearStaleCommitConflicts(input.execution.executionID)
    for (const sessionID of await completionSessionTree(input.sessionID)) HarnessState.clearReviewScope(sessionID)
    return "committed"
  }
  if (!review.error && !review.exhausted && input.allowRetry !== false) {
    return retry(review.reason)
  }
  const original = input.candidate.parts[0]
  const blockerKind = review.error ? "procedural_harness" : "verification"
  const originalText = input.candidate.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim()
  const blockedText = [
    originalText,
    review.error
      ? `Verification status: procedural/harness blocker. Independent review could not run: ${review.reason ?? "unknown reviewer error"}. Review remains required; no approval or successful completion is claimed. Restore reviewer/provider availability, then send another message to retry. The previous blocked decision stays in the audit history.`
      : `Verification status: verification blocker. ${reviewBlockedText(review.reason)}`,
  ]
    .filter(Boolean)
    .join("\n\n")
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
        metadata: { ...original?.metadata, reviewGate: "blocked", blockerKind },
      },
    ],
    execution: input.execution,
    reasonCode: review.error ? "review_unavailable" : "review_rejected",
    reasonMessage: "Independent review could not approve this completion.",
  })
  await projectAndAckCompletion(blocked)
  // Keep edits and rejection budgets for recovery; discard terminal reviewer bindings.
  for (const sessionID of await completionSessionTree(input.sessionID)) HarnessState.clearReviewerSessions(sessionID)
  return "blocked"
}

export const PromptCompletion = {
  returnExpertHandoff,
  recordModelResolutionError,
  reviewEvidenceFiles,
  reviewFiles,
  resolveCompletion,
  reviewFromDurableClaim,
  projectCompletion,
  projectAndAckCompletion,
}
