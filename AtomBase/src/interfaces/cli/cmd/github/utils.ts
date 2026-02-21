import { MessageV2 } from "@/core/session/message-v2"

// Constants
export const AGENT_USERNAME = "atomcli-agent[bot]"
export const AGENT_REACTION = "eyes"
export const WORKFLOW_FILE = ".github/workflows/atomcli.yml"

// Event categories for routing
// USER_EVENTS: triggered by user actions, have actor/issueId, support reactions/comments
// REPO_EVENTS: triggered by automation, no actor/issueId, output to logs/PR only
export const USER_EVENTS = ["issue_comment", "pull_request_review_comment", "issues", "pull_request"] as const
export const REPO_EVENTS = ["schedule", "workflow_dispatch"] as const
export const SUPPORTED_EVENTS = [...USER_EVENTS, ...REPO_EVENTS] as const

export type UserEvent = (typeof USER_EVENTS)[number]
export type RepoEvent = (typeof REPO_EVENTS)[number]

/**
 * Parses GitHub remote URLs in various formats:
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - git@github.com:owner/repo
 * - ssh://git@github.com/owner/repo.git
 * - ssh://git@github.com/owner/repo
 */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
    const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
}

/**
 * Extracts displayable text from assistant response parts.
 * Returns null for tool-only or reasoning-only responses (signals summary needed).
 * Throws for truly unusable responses (empty, step-start only, etc.).
 */
export function extractResponseText(parts: MessageV2.Part[]): string | null {
    // Priority 1: Look for text parts
    const textPart = parts.findLast((p) => p.type === "text")
    if (textPart) return textPart.text

    // Priority 2: Reasoning-only - return null to signal summary needed
    const reasoningPart = parts.findLast((p) => p.type === "reasoning")
    if (reasoningPart) return null

    // Priority 3: Tool-only - return null to signal summary needed
    const toolParts = parts.filter((p) => p.type === "tool" && p.state.status === "completed")
    if (toolParts.length > 0) return null

    // No usable parts - throw with debug info
    const partTypes = parts.map((p) => p.type).join(", ") || "none"
    throw new Error(`Failed to parse response. Part types found: [${partTypes}]`)
}
