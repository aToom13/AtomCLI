import { Config } from "@/core/config/config"
import { SessionExecutionProfile } from "@/core/session/execution-profile"
import { ReviewPolicy } from "@/core/verification/review-policy"
import type { TaskNode } from "./state"

export function requiresTaskQA(
  task: TaskNode,
  editedFileCount: number,
  editedFiles: string[] = [],
  profile: SessionExecutionProfile.Name = "standard",
  review: Partial<Config.Info["review"]> = {},
): boolean {
  if (task.agent === "reviewer" || task.agent === "checker") return false
  if (review?.auto !== true || editedFileCount === 0) return false
  const policy = ReviewPolicy.snapshotFromConfig({ review, executionProfile: profile })
  return ReviewPolicy.requiresIndependentReview(policy.effectivePolicy, {
    editedFiles,
    prompt: task.prompt,
    extraHighRiskPatterns: policy.highRiskPatterns,
  })
}
