import { Provider } from "@/integrations/provider/provider"
import { ToolRegistry } from "@/integrations/tool/registry"
import { selectCandidates, type TaskCategory } from "@/integrations/tool/model-router"

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

    try {
      const provider = await Provider.getProvider("atomcli")
      if (provider) {
        const freeModels = Object.entries(provider.models).filter(
          ([id, m]) => id !== "atomcli-auto" && id !== "atomcli-free" && (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0,
        ) as Array<[string, Provider.Model]>
        const candidates = selectCandidates(freeModels, taskCat)
        if (candidates.length > 0) {
          return { providerID: "atomcli", modelID: candidates[0][0] }
        }
      }
    } catch {
      /* fallback */
    }
    return { providerID: "atomcli", modelID: "atomcli/minimax-m2.5-free" }
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
