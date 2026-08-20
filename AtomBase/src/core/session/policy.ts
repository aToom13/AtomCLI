import { ToolRegistry } from "@/integrations/tool/registry"
import type { TaskCategory } from "@/integrations/tool/model-router"
import { ModelPurpose } from "@/core/routing/model-purpose"

export namespace SessionPolicy {
  /**
   * Recommends the appropriate agent type based on task description keywords.
   */
  export async function decideAgent(taskDescription: string): Promise<string> {
    const lower = taskDescription.toLowerCase()
    if (lower.includes("explore") || lower.includes("find file") || lower.includes("search code")) {
      return "explore"
    }
    if (lower.includes("review") || lower.includes("check code")) {
      return "reviewer"
    }
    if (lower.includes("test") || lower.includes("qa")) {
      return "checker"
    }
    if (lower.includes("doc") || lower.includes("readme")) {
      return "documenter"
    }
    if (lower.includes("analyze") || lower.includes("finance")) {
      return "analyst"
    }
    return "coder"
  }

  /**
   * Selects the optimal model for an agent type and task category.
   */
  export async function decideModel(agentName: string, category?: string): Promise<{ providerID: string; modelID: string }> {
    const taskCat: TaskCategory =
      (category as TaskCategory) ||
      (agentName === "documenter" ? "documentation" : agentName === "analyst" ? "analysis" : "coding")

    return ModelPurpose.select(taskCat, agentName)
  }

  /**
   * Returns allowed tools for a specific agent type from registry allowlists.
   * Returns undefined for primary/fail-open agents.
   */
  export function decideTools(agentName: string): string[] | undefined {
    return ToolRegistry.AGENT_TOOL_ALLOW_LISTS[agentName]
  }

  /**
   * Determines if auto-chain reminder should be triggered based on step count and chain presence.
   */
  export function shouldAutoStartChain(stepCount: number, hasChainCall: boolean): boolean {
    return stepCount > 2 && !hasChainCall
  }
}
