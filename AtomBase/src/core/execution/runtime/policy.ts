import path from "path"
import { Config } from "@/core/config/config"
import { ReviewPolicy } from "@/core/verification/review-policy"
import { SessionExecutionProfile } from "@/core/session/execution-profile"
import { Instance } from "@/services/project/instance"
import type { ExecutionLedger } from "../ledger"

export function microusd(value: number | undefined) {
  if (value === undefined) return undefined
  const converted = Math.ceil(value * 1_000_000)
  if (!Number.isSafeInteger(converted)) throw new Error("Execution cost limit exceeds the supported range")
  return converted
}

export function policy(budget: NonNullable<Awaited<ReturnType<typeof Config.get>>["execution_budget"]>): ExecutionLedger.Policy {
  return {
    maxCalls: budget.max_calls,
    maxSteps: budget.max_steps,
    maxDurationMs: budget.max_duration_ms,
    maxCostMicrousd: microusd(budget.max_cost_usd),
    rootMaxCostMicrousd: microusd(budget.session_max_cost_usd),
    projectMaxCostMicrousd: microusd(budget.project_max_cost_usd),
    unknownPriceBlocked:
      budget.unknown_price !== "allow" &&
      (budget.max_cost_usd !== undefined || budget.session_max_cost_usd !== undefined || budget.project_max_cost_usd !== undefined),
  }
}

export function configuredReviewPolicy(config: Awaited<ReturnType<typeof Config.get>>, sessionID: string) {
  return ReviewPolicy.snapshotFromConfig({ review: config.review, executionProfile: SessionExecutionProfile.get(sessionID) })
}

export async function contentSnapshotDigest(files: string[]) {
  const hasher = new Bun.CryptoHasher("sha256")
  for (const filename of [...files].sort()) {
    const filepath = path.isAbsolute(filename) ? filename : path.resolve(Instance.directory, filename)
    hasher.update(`${filename}\0`)
    try {
      const file = Bun.file(filepath)
      if (!(await file.exists())) {
        hasher.update("missing\0")
        continue
      }
      const reader = file.stream().getReader()
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          hasher.update(chunk.value)
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      hasher.update(`unreadable:${error instanceof Error ? error.name : "unknown"}\0`)
    }
    hasher.update("\0")
  }
  return hasher.digest("hex")
}
