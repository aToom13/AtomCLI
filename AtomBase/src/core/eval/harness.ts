import z from "zod"
import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"
import { ModelQuality } from "@/core/routing/model-quality"

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
  })
  export type Observation = z.infer<typeof Observation>

  export interface Result extends Observation {
    score: number
    success: boolean
    quality: number
  }

  export function score(input: Observation): Result {
    let points = input.completed ? 45 : 0
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
      success: input.completed && !input.responseEmpty && input.testsPassed !== false && input.reviewerVerdict !== "failed",
      quality: resultScore / 100,
    }
  }

  export async function record(raw: unknown) {
    const observation = Observation.parse(raw)
    const result = score(observation)
    const projectID = Instance.project.id
    await Storage.write(["agent-eval", projectID, result.suite, `${result.timestamp}-${result.id}`], result)
    await ModelQuality.record({
      providerID: result.providerID,
      modelID: result.modelID,
      category: result.category,
      quality: result.quality,
      success: result.success,
      latencyMs: result.durationMs,
      signal: result.userCorrections > 0 ? "user_correction" : result.reviewerVerdict !== "not_run" ? "review" : result.testsPassed !== undefined ? "test" : "request",
      timestamp: result.timestamp,
    })
    return result
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
