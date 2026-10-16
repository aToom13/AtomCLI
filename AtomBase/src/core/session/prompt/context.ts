import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { Identifier } from "@/core/id/id"
import { MessageV2 } from "../message-v2"
import MAX_STEPS from "../prompt/runtime/max-steps.txt"

export namespace PromptContext {
  const CHECKPOINT_HANDOFF_MAX_CHARS = 12_000

  export function isContinuationPrompt(prompt: string): boolean {
    return /^(?:devam(?: et)?|sürdür|continue|retry|try again)(?: lütfen| please)?[.!?]?$/iu.test(prompt.trim())
  }

  export function continuationContract(
    prompt: string,
    currentExecutionID: string,
    executions: { id: string; lifecycle: string; outcome?: string | null }[],
    getContract: (
      executionID: string,
    ) => import("@/core/routing/execution-contract").ExecutionContract.Info | undefined,
  ) {
    if (!isContinuationPrompt(prompt)) return
    const previous = executions.find((item) => item.id !== currentExecutionID)
    if (previous?.lifecycle !== "terminal" || previous.outcome === "completed") return
    return getContract(previous.id)
  }

  const WORK_SIGNAL =
    /(?:read|inspect|find|grep|search|edit|write|change|fix|create|delete|run|test|build|implement|refactor|review|verify|debug|install|deploy|commit|push|file|code|repo|project|config|api|server|phone|companion|test|testleri|oku|incele|araştır|araştir|bul|bulup|değiştir|değiştir|güncelle|düzelt|düzelt|oluştur|sil|çalıştır|derle|uygula|kur|yükle|dosya|kod|depo|proje|ayar|sunucu|telefon|eşleştir|mesaj|git|test)/i
  const CONVERSATIONAL =
    /^(?:selam|merhaba|naber|nasılsın|nasılsin|hello|hi|hey|thanks|thank you|teşekkürler|teşekkür ederim|tesekkurler|good morning|good evening|gunaydın|iyi geceler)\b/iu

  export function isDirectAnswer(prompt: string, agent: string): boolean {
    if (agent !== "agent") return false
    const trimmed = prompt.trim()
    if (isContinuationPrompt(trimmed)) return false
    if (!trimmed || trimmed.length > 240) return false
    if (WORK_SIGNAL.test(trimmed)) return false
    if (CONVERSATIONAL.test(trimmed)) return true
    return /\?\s*$/u.test(trimmed) && trimmed.length <= 160
  }

  export function explicitOrchestration(prompt: string): boolean {
    return /\b(?:sub[- ]?agent|alt ajan|alt agent|parallel|paralel|orchestrate|orchestration|workflow|taskflow|multi[- ]?agent)\b/iu.test(
      prompt,
    )
  }

  /**
   * True when the user explicitly asks for delegation to (sub)agents or
   * parallel work. These requests need the model-facing `agent` tool, which is
   * only advertised at coordinated scope — so this is a scope floor of
   * coordinated, stronger than a generic orchestration mention.
   */
  export function explicitSubagentDelegation(prompt: string): boolean {
    return /\b(?:sub[- ]?agent|alt ajan|alt agent|child agent|ara ajan|multiple agents|multi[- ]?agent|paralel(?:de)?|parallel(?:ly)?|delegat(?:e|ion)|y\u00f6nletr)\b/iu.test(
      prompt,
    )
  }

  export function shouldLoadTools(input: {
    providerID?: string
    prompt: string
    explicitTools: boolean
    bypassAgentCheck: boolean
    hasPriorToolActivity: boolean
  }) {
    if (input.providerID === "atomcli" || input.providerID === "opencode") return true
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
    if (casual.has(normalized)) return false
    const firstWord = normalized.split(" ")[0]
    if (firstWord && (casual.has(firstWord) || casual.has(firstWord.replace(/\?+$/, "")))) {
      const rest = normalized.slice(firstWord.length).trim().replace(/^\?+/, "").trim()
      if (!rest) return false
      if (rest.split(" ").length < 3 && rest.length < 12) return false
      return true
    }
    return true
  }

  export function prepareTurnContext<T>(system: string[], messages: T[], isLastStep: boolean) {
    return {
      system: isLastStep ? [...system, MAX_STEPS] : system,
      messages,
      isLastStep,
    }
  }

  export function shouldResolveTools(isLastStep: boolean) {
    return !isLastStep
  }

  export function earlyProgressReminder(input: {
    scope?: "direct" | "focused" | "coordinated"
    step: number
    toolCalls?: number
    successfulToolCalls?: number
    mutatingCalls?: number
  }) {
    if (input.scope === "direct" || input.step > 3) return undefined
    if ((input.toolCalls ?? 0) < 3 || (input.successfulToolCalls ?? 0) < 3) return undefined
    if ((input.mutatingCalls ?? 0) > 0) return undefined
    return "Produce the first useful result now: a concrete finding, diagnostic, reproduction, failing check, or bounded next action. Do not start a new architecture or subsystem before surfacing usable evidence."
  }

  export function isSyntheticContinuation(message: MessageV2.WithParts) {
    return (
      message.info.role === "user" &&
      message.parts.length > 0 &&
      message.parts.every((part) => part.type === "compaction" || ("synthetic" in part && part.synthetic === true))
    )
  }

  export function isFinishedResponse(user: MessageV2.User, assistant?: MessageV2.Assistant) {
    return (
      assistant?.parentID === user.id &&
      Boolean(assistant.finish) &&
      !["tool-calls", "unknown"].includes(assistant.finish!)
    )
  }

  export function checkpointTools<T>(_tools: Record<string, T>): Record<string, T> {
    return {}
  }

  export function isCheckpointContinuation(message?: MessageV2.WithParts): boolean {
    if (!message || !isSyntheticContinuation(message)) return false
    const text = message.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    return text.includes("The final response was withheld") || text.includes("Completion preconditions failed")
  }

  export function checkpointHandoff(previous: { sequence: number; payload: unknown }): string {
    const payload = (previous.payload ?? {}) as {
      checkpoint?: Record<string, unknown>
      evidence?: Record<string, unknown>
      mutationRevision?: number
      planRevision?: number
      routeRevision?: number
    }
    const checkpoint = (payload.checkpoint ?? {}) as Record<string, unknown>
    const evidence = (payload.evidence ?? {}) as Record<string, unknown>
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : [])
    const list = (value: unknown) => (Array.isArray(value) ? value.length : 0)
    return JSON.stringify({
      sequence: previous.sequence,
      decision: checkpoint.decision,
      objectiveAssessment: checkpoint.objectiveAssessment,
      progressSummary: checkpoint.progressSummary,
      completedWork: strings(checkpoint.completedWork),
      remainingWork: strings(checkpoint.remainingWork),
      failures: strings(checkpoint.failures),
      blockers: strings(checkpoint.blockers),
      routeAssessment: checkpoint.routeAssessment,
      routeDecision: checkpoint.routeDecision ?? "keep",
      selfCritique: typeof checkpoint.selfCritique === "string" ? checkpoint.selfCritique : undefined,
      failedApproaches: strings(checkpoint.failedApproaches ?? checkpoint.failed_approaches),
      whatToChanges: strings(checkpoint.whatToChanges ?? checkpoint.what_to_changes),
      nextActions: strings(checkpoint.nextActions),
      counters: {
        toolCalls: evidence.toolCalls ?? 0,
        successfulToolCalls: evidence.successfulToolCalls ?? 0,
        failureCount: evidence.failureCount ?? 0,
        filesRead: list(evidence.filesRead),
        filesChanged: list(evidence.filesChanged),
      },
      mutationRevision: payload.mutationRevision,
      planRevision: payload.planRevision,
      routeRevision: payload.routeRevision,
    }).slice(0, CHECKPOINT_HANDOFF_MAX_CHARS)
  }

  /**
   * Union the list fields the model reports across every checkpoint. Since the
   * model is asked for *delta* completed/failure items per slice, the harness —
   * not the model — is responsible for keeping the accumulated history. This is
   * what keeps checkpoint payloads small without losing the durable record.
   */
  export function accumulateCheckpointFields(checkpoints: Array<{ payload?: unknown }>) {
    const completedWork: string[] = []
    const failures: string[] = []
    const discoveries: string[] = []
    const blockers: string[] = []
    const seen = {
      completedWork: new Set<string>(),
      failures: new Set<string>(),
      discoveries: new Set<string>(),
      blockers: new Set<string>(),
    }
    const push = (value: unknown, out: string[], set: Set<string>) => {
      if (typeof value !== "string") return
      const text = value.trim()
      if (!text || set.has(text)) return
      set.add(text)
      out.push(text)
    }
    const list = (value: unknown) => (Array.isArray(value) ? value : [])
    for (const record of checkpoints) {
      const checkpoint = ((record.payload as Record<string, unknown> | undefined)?.checkpoint ?? {}) as Record<
        string,
        unknown
      >
      for (const item of list(checkpoint.invalidatedWork)) {
        if (!item || typeof item !== "object" || typeof item.claim !== "string" || typeof item.reason !== "string")
          continue
        const claim = item.claim.trim()
        const index = completedWork.indexOf(claim)
        if (index !== -1) completedWork.splice(index, 1)
        seen.completedWork.delete(claim)
      }
      for (const item of list(checkpoint.completedWork)) push(item, completedWork, seen.completedWork)
      for (const item of list(checkpoint.failures)) push(item, failures, seen.failures)
      for (const item of list(checkpoint.discoveries)) push(item, discoveries, seen.discoveries)
      for (const item of list(checkpoint.blockers)) push(item, blockers, seen.blockers)
    }
    return { completedWork, failures, discoveries, blockers }
  }

  export function checkpointDelta(messages: MessageV2.WithParts[], since = 0): string {
    const lines = messages
      .filter((message) => message.info.time.created >= since)
      .flatMap((message) =>
        message.parts.flatMap((part) => {
          if (part.type === "tool") {
            const detail =
              part.state.status === "completed"
                ? part.state.output
                : part.state.status === "error"
                  ? part.state.error
                  : part.state.status
            return [`tool ${part.tool} [${part.state.status}]: ${String(detail).slice(0, 1000)}`]
          }
          if (part.type === "patch") return [`files changed: ${part.files.join(", ")}`]
          if (part.type === "subtask") return [`child task: ${part.prompt}`]
          if (part.type === "compaction") return ["conversation compaction recorded"]
          if (part.type === "text" && !part.synthetic) return [`message: ${part.text.slice(0, 2000)}`]
          return []
        }),
      )
    // Repeated lines collapse to the *newest* occurrence: the tail slice keeps
    // the most recent evidence, so a stale first copy of a repeated tool result
    // must not evict the fresh one (fixes "return to old results" after checkpoint).
    const deduped: string[] = []
    const lastSeen = new Map<string, number>()
    for (const line of lines) {
      const previous = lastSeen.get(line)
      if (previous !== undefined) deduped[previous] = ""
      lastSeen.set(line, deduped.length)
      deduped.push(line)
    }
    return deduped.filter(Boolean).slice(-100).join("\n").slice(-24_000)
  }

  export function parseCheckpointJsonCandidates(text: string): unknown[] {
    const trimmed = text.trim()
    const candidates: unknown[] = []
    const seen = new Set<string>()
    const add = (value: string) => {
      const candidate = value.trim()
      if (!candidate || seen.has(candidate)) return
      seen.add(candidate)
      try {
        candidates.push(JSON.parse(candidate))
      } catch {}
    }
    add(trimmed)
    for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) add(match[1])
    let start = -1
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = 0; index < trimmed.length; index++) {
      const char = trimmed[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') {
        quoted = true
        continue
      }
      if (char === "{") {
        if (depth === 0) start = index
        depth++
      } else if (char === "}" && depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          add(trimmed.slice(start, index + 1))
          start = -1
        }
      }
    }
    return candidates
  }

  export function parseCheckpointJson(text: string): unknown {
    return parseCheckpointJsonCandidates(text)[0]
  }

  export function normalizeCheckpointForOpenTaskflow(
    checkpoint: ExecutionCheckpoint.Result,
    openTaskflow: boolean,
  ): ExecutionCheckpoint.Result {
    if (!openTaskflow || checkpoint.decision !== "finish") return checkpoint
    const reason = "The durable taskflow is still open; continue by updating or completing its remaining steps."
    return {
      ...checkpoint,
      decision: "continue",
      requestedCalls: Math.max(checkpoint.requestedCalls ?? 0, ExecutionCheckpoint.MIN_CHECKPOINT_CALLS),
      finalResponse: undefined,
      remainingWork: [...new Set([...checkpoint.remainingWork, reason])],
      blockers: [...new Set([...checkpoint.blockers, reason])],
      estimatedRemainingCalls: Math.max(checkpoint.estimatedRemainingCalls, 1),
      nextActions: [...new Set([...checkpoint.nextActions, "Reconcile the open taskflow before finishing."])],
    }
  }

  export function checkpointFinalParts(
    parts: MessageV2.TextPart[] | undefined,
    input: { sessionID: string; messageID: string; finalResponse: string },
  ): MessageV2.TextPart[] {
    const original = parts?.[0]
    return [
      {
        ...(original ?? {
          id: Identifier.ascending("part"),
          messageID: input.messageID,
          sessionID: input.sessionID,
          type: "text",
          time: { start: Date.now(), end: Date.now() },
        }),
        text: input.finalResponse,
      },
    ]
  }
}
