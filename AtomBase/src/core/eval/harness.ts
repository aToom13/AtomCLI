import z from "zod"
import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"
import { ModelQuality } from "@/core/routing/model-quality"
import type { MessageV2 } from "@/core/session/message-v2"
import { TaskProfile } from "@/core/routing/task-profile"

export namespace AgentEval {
  export const Category = z.enum(["coding", "documentation", "analysis", "general"])
  export const Observation = z.object({
    id: z.string().min(1),
    suite: z.string().min(1).default("default"),
    category: Category,
    promptVersion: z.string().default("current"),
    providerID: z.string().min(1),
    modelID: z.string().min(1),
    testsPassed: z.boolean().optional(),
    reviewerVerdict: z.enum(["passed", "failed", "not_run"]).default("not_run"),
    completed: z.boolean(),
    responseEmpty: z.boolean().default(false),
    toolCalls: z.number().int().nonnegative().default(0),
    toolErrors: z.number().int().nonnegative().default(0),
    retries: z.number().int().nonnegative().default(0),
    userCorrections: z.number().int().nonnegative().default(0),
    inputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative().default(0),
    cost: z.number().nonnegative().default(0),
    durationMs: z.number().nonnegative().default(0),
    timestamp: z.number().default(() => Date.now()),
    automatic: z.boolean().default(false),
  })
  export type Observation = z.infer<typeof Observation>

  export interface Result extends Observation {
    score: number
    success: boolean
    quality: number
  }

  export function score(input: Observation): Result {
    // Automatically observed normal answers often have no test/reviewer signal;
    // treat a non-empty completed response as mildly positive, not a penalty.
    let points = input.completed ? (input.automatic ? 55 : 45) : 0
    if (input.testsPassed === true) points += 25
    if (input.testsPassed === false) points -= 20
    if (input.reviewerVerdict === "passed") points += 20
    if (input.reviewerVerdict === "failed") points -= 25
    if (input.responseEmpty) points -= 35
    points -= Math.min(15, input.toolErrors * 5)
    points -= Math.min(10, input.retries * 2)
    points -= Math.min(20, input.userCorrections * 10)
    const resultScore = Math.max(0, Math.min(100, points))
    return {
      ...input,
      score: resultScore,
      success:
        input.completed &&
        !input.responseEmpty &&
        input.testsPassed !== false &&
        input.reviewerVerdict !== "failed" &&
        input.userCorrections === 0,
      quality: resultScore / 100,
    }
  }

  export async function record(raw: unknown, options: { updateModelQuality?: boolean } = {}) {
    const observation = Observation.parse(raw)
    const result = score(observation)
    const projectID = Instance.project.id
    await Storage.write(["agent-eval", projectID, result.suite, `${result.timestamp}-${result.id}`], result)
    if (options.updateModelQuality !== false) {
      await ModelQuality.record({
        providerID: result.providerID,
        modelID: result.modelID,
        category: result.category,
        quality: result.quality,
        success: result.success,
        latencyMs: result.durationMs,
        signal:
          result.userCorrections > 0
            ? "user_correction"
            : result.reviewerVerdict !== "not_run"
              ? "review"
              : result.testsPassed !== undefined
                ? "test"
                : "request",
        timestamp: result.timestamp,
      })
    }
    return result
  }

  function userText(message: MessageV2.WithParts | undefined) {
    if (!message || message.info.role !== "user") return ""
    return message.parts
      .filter((part) => part.type === "text" && !("synthetic" in part && part.synthetic))
      .map((part) => (part as MessageV2.TextPart).text)
      .join("\n")
      .trim()
  }

  export interface BenchmarkContext {
    suite: string
    caseID: string
    runID: string
  }

  const automaticState = Instance.state(() => ({
    claims: new Map<string, Promise<void>>(),
    benchmarks: new Map<string, BenchmarkContext>(),
  }))

  export function registerBenchmark(sessionID: string, context: BenchmarkContext) {
    automaticState().benchmarks.set(sessionID, context)
  }

  export function unregisterBenchmark(sessionID: string) {
    automaticState().benchmarks.delete(sessionID)
  }

  export function isBenchmarkSession(sessionID: string) {
    return automaticState().benchmarks.has(sessionID)
  }

  export function executionPolicy(sessionID: string) {
    const benchmark = isBenchmarkSession(sessionID)
    return {
      allowModelFallback: !benchmark,
      allowAuxiliarySummaries: !benchmark,
      allowMemoryLearning: !benchmark,
      maxRetries: benchmark ? 0 : undefined,
    }
  }

  /** Benchmarks must measure the requested model, never a transparent fallback. */
  export function allowsModelFallback(sessionID: string) {
    return executionPolicy(sessionID).allowModelFallback
  }

  /** Derive reproducible quality observations from real completed turns. */
  export async function recordSession(sessionID: string, messages: MessageV2.WithParts[]) {
    const byID = new Map(messages.map((message) => [message.info.id, message]))
    const benchmark = automaticState().benchmarks.get(sessionID)
    const recorded: Result[] = []
    for (const message of messages) {
      if (
        message.info.role !== "assistant" ||
        message.info.summary ||
        !message.info.time.completed ||
        message.info.finish === "tool-calls"
      )
        continue
      const claimID = `${Instance.project.id}:${message.info.id}`
      const claims = automaticState().claims
      const existing = claims.get(claimID)
      if (existing) {
        await existing
        continue
      }
      let releaseClaim!: () => void
      claims.set(
        claimID,
        new Promise<void>((resolve) => {
          releaseClaim = resolve
        }),
      )
      try {
        const marker = ["agent-eval-auto", Instance.project.id, message.info.id]
        if (await Storage.read<boolean>(marker).catch(() => false)) continue

        const parentID = message.info.parentID
        const assistantCreated = message.info.time.created
        const providerID = message.info.providerID
        const modelID = message.info.modelID
        const parent = byID.get(parentID)
        const prompt = userText(parent)
        const profile = TaskProfile.infer(prompt)
        const turnMessages = messages.filter(
          (candidate): candidate is MessageV2.WithParts & { info: MessageV2.Assistant } => {
            const info = candidate.info
            return (
              info.role === "assistant" &&
              info.parentID === parentID &&
              info.time.created <= assistantCreated &&
              info.providerID === providerID &&
              info.modelID === modelID
            )
          },
        )
        const turnParts = turnMessages.flatMap((candidate) => candidate.parts)
        const toolParts = turnParts.filter((part): part is MessageV2.ToolPart => part.type === "tool")
        const testTools = toolParts.filter((part) => {
          if (part.tool !== "bash") return false
          const command = String(part.state.input?.command ?? "")
          return /(^|\s)(test|typecheck|lint|check|build)(\s|$)|bun\s+(test|run\s+(test|typecheck|lint|build))/.test(
            command,
          )
        })
        const testsPassed =
          testTools.length === 0
            ? undefined
            : testTools.every(
                (part) => part.state.status === "completed" && Number(part.state.metadata?.exit ?? 0) === 0,
              )
        const reviewParts = toolParts.filter((part) => part.tool === "review-gate" || part.tool === "review_gate")
        const reviewText = reviewParts
          .map((part) =>
            part.state.status === "completed"
              ? part.state.output
              : part.state.status === "error"
                ? part.state.error
                : "",
          )
          .join("\n")
        const reviewerVerdict = /VERDICT:\s*PASSED|review.*pass/i.test(reviewText)
          ? ("passed" as const)
          : /VERDICT:\s*REJECTED|review.*fail/i.test(reviewText)
            ? ("failed" as const)
            : ("not_run" as const)
        const text = turnParts
          .filter((part): part is MessageV2.TextPart => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim()
        const retries = turnParts.filter((part) => part.type === "retry").length
        const totals = turnMessages.reduce(
          (total, candidate) => ({
            input: total.input + candidate.info.tokens.input + candidate.info.tokens.cache.read,
            output: total.output + candidate.info.tokens.output,
            cost: total.cost + candidate.info.cost,
          }),
          { input: 0, output: 0, cost: 0 },
        )

        // A correction is evidence about the previous answer, not the model now
        // attempting the repair. Attribute it once to the preceding assistant.
        if (/\b(still|wrong|incorrect|did not|doesn't|again)\b|hala|yanlış|olmadı|tekrar düzelt/i.test(prompt)) {
          const correctionMarker = ["agent-eval-correction", Instance.project.id, parent?.info.id ?? parentID]
          if (!(await Storage.read<boolean>(correctionMarker).catch(() => false))) {
            const parentIndex = messages.findIndex((candidate) => candidate.info.id === parentID)
            const previous = messages
              .slice(0, Math.max(0, parentIndex))
              .findLast((candidate) => candidate.info.role === "assistant" && !candidate.info.summary)
            if (previous?.info.role === "assistant") {
              const previousPrompt = userText(byID.get(previous.info.parentID))
              const previousProfile = TaskProfile.infer(previousPrompt)
              await ModelQuality.record({
                providerID: previous.info.providerID,
                modelID: previous.info.modelID,
                category: previousProfile.category,
                quality: 0.2,
                success: false,
                signal: "user_correction",
                timestamp: parent?.info.time.created ?? Date.now(),
              })
              const correction = await record(
                {
                  id: `correction-${previous.info.id}`,
                  suite: "runtime",
                  category: previousProfile.category,
                  providerID: previous.info.providerID,
                  modelID: previous.info.modelID,
                  completed: true,
                  responseEmpty: false,
                  userCorrections: 1,
                  timestamp: parent?.info.time.created ?? Date.now(),
                  automatic: true,
                },
                { updateModelQuality: false },
              )
              recorded.push(correction)
              await Storage.write(correctionMarker, true)
            }
          }
        }
        const result = await record({
          id: benchmark?.caseID ?? `${sessionID}-${message.info.id}`,
          suite: benchmark?.suite ?? "runtime",
          promptVersion: benchmark?.runID ?? "current",
          category: profile.category,
          providerID,
          modelID,
          completed: !message.info.error && !!message.info.finish,
          responseEmpty: text.length === 0,
          testsPassed,
          reviewerVerdict,
          toolCalls: toolParts.length,
          toolErrors: toolParts.filter((part) => part.state.status === "error").length,
          retries,
          inputTokens: totals.input,
          outputTokens: totals.output,
          cost: totals.cost,
          durationMs: Math.max(
            0,
            message.info.time.completed -
              (parent?.info.time.created ?? turnMessages[0]?.info.time.created ?? message.info.time.created),
          ),
          timestamp: message.info.time.completed,
          automatic: true,
        })
        await Storage.write(marker, true)
        recorded.push(result)
      } finally {
        releaseClaim()
        claims.delete(claimID)
      }
    }
    return recorded
  }

  export async function list(suite = "default") {
    const projectID = Instance.project.id
    const keys = await Storage.list(["agent-eval", projectID, suite])
    return Promise.all(keys.map((key) => Storage.read<Result>(key)))
  }

  export function summarize(results: Result[]) {
    const count = results.length
    const sum = (pick: (item: Result) => number) => results.reduce((total, item) => total + pick(item), 0)
    return {
      count,
      successRate: count ? results.filter((item) => item.success).length / count : 0,
      averageScore: count ? sum((item) => item.score) / count : 0,
      averageDurationMs: count ? sum((item) => item.durationMs) / count : 0,
      totalCost: sum((item) => item.cost),
      totalTokens: sum((item) => item.inputTokens + item.outputTokens),
      totalToolCalls: sum((item) => item.toolCalls),
      totalToolErrors: sum((item) => item.toolErrors),
      totalRetries: sum((item) => item.retries),
      totalUserCorrections: sum((item) => item.userCorrections),
    }
  }
}
