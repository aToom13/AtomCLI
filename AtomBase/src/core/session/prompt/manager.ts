/**
 * PromptManager — Unified Prompt Orchestration System
 *
 * Architecture:
 *   prompt/
 *   ├── core/      8 base .txt prompts (thinking-pattern + 7 core, always included)
 *   ├── agent/     6 agent-mode .txt prompts
 *   ├── runtime/   dynamic runtime injection snippets
 *   └── manager.ts ← THIS FILE
 *
 * All providers share the same unified system prompt.
 * Agent module: based on agent type
 */

import fs from "fs/promises"
import path from "path"
import os from "os"

// ─── Core Prompts (always included) ──────────────────────────

import PROMPT_THINKING_PATTERN from "./core/thinking-pattern.txt"
import PROMPT_IDENTITY from "./core/identity.txt"
import PROMPT_TOOLS from "./core/tools.txt"
import PROMPT_WORKFLOW from "./core/workflow.txt"
import PROMPT_COMMUNICATION from "./core/communication.txt"
import PROMPT_CODE_EDITING from "./core/code-editing.txt"
import PROMPT_GIT_SAFETY from "./core/git-safety.txt"
import PROMPT_EXTENSIONS from "./core/extensions.txt"

// All providers share a single unified system prompt (no provider-specific files).

// ─── Agent-Specific Prompts ──────────────────────────────────

import PROMPT_AGENT from "./agent/agent.txt"
import PROMPT_EXPLORE from "./agent/explore.txt"
import PROMPT_PLAN from "./agent/plan.txt"
import PROMPT_BUILD from "./agent/build.txt"
import PROMPT_CHECKER from "./agent/checker.txt"
import PROMPT_REVIEWER from "./agent/reviewer.txt"

import { buildMemorySummary } from "@/integrations/tool/memory"

// ─── Types ───────────────────────────────────────────────────

type ProviderType = "anthropic" | "gemini" | "openai" | "generic"
export type AgentType = "agent" | "explore" | "plan" | "build" | "checker" | "reviewer"

export interface BuildOptions {
  /** Model API ID (e.g., "claude-3-5-sonnet", "gemini-2.0-flash") */
  modelId: string
  /** Agent type (default: "agent") */
  agent?: AgentType
  /** Custom sections to append */
  customSections?: string[]
  /** Include learning memory summary */
  includeLearningMemory?: boolean
  /** Include user profile */
  includeUserProfile?: boolean
}

// ─── Provider Detection (used for stats/info only) ──────────

function detectProvider(modelId: string): "anthropic" | "gemini" | "openai" | "generic" {
  const id = modelId.toLowerCase()
  if (id.includes("claude")) return "anthropic"
  if (id.includes("gemini")) return "gemini"
  if (id.includes("gpt") || id.includes("o1") || id.includes("o3") || id.includes("o4")) return "openai"
  return "generic"
}

const AGENT_PROMPTS: Record<AgentType, string> = {
  agent: PROMPT_AGENT,
  explore: PROMPT_EXPLORE,
  plan: PROMPT_PLAN,
  build: PROMPT_BUILD,
  checker: PROMPT_CHECKER,
  reviewer: PROMPT_REVIEWER,
}

/**
 * Core prompts that are ALWAYS included in every system prompt.
 * Order matters — thinking-pattern first, then identity, then capabilities, then rules.
 */
const CORE_PROMPTS = [
  PROMPT_THINKING_PATTERN,
  PROMPT_IDENTITY,
  PROMPT_TOOLS,
  PROMPT_WORKFLOW,
  PROMPT_COMMUNICATION,
  PROMPT_CODE_EDITING,
  PROMPT_GIT_SAFETY,
  PROMPT_EXTENSIONS,
]

// ─── Read-Before-Edit Emphasis ───────────────────────────────

const READ_BEFORE_EDIT_EMPHASIS = `<critical_rule>
You MUST read() a file BEFORE you can edit() it. The edit tool WILL FAIL otherwise. Always verify your oldString EXACTLY matches current content.
</critical_rule>`.trim()

// ─── Dynamic Context Generator ──────────────────────────────

async function generateDynamicContext(): Promise<string> {
  const parts: string[] = []

  // User profile
  try {
    const profilePath = path.join(os.homedir(), ".atomcli", "personality", "user-profile.json")
    const data = await fs.readFile(profilePath, "utf-8")
    const profile = JSON.parse(data)

    const profileParts = ["<user_context>", "# USER CONTEXT"]
    if (profile.name) profileParts.push(`- **Name**: ${profile.name}`)
    if (profile.techLevel) profileParts.push(`- **Tech Level**: ${profile.techLevel}`)
    if (profile.communication) profileParts.push(`- **Communication Style**: ${profile.communication}`)
    if (profile.primaryLanguage) profileParts.push(`- **Primary Language**: ${profile.primaryLanguage}`)
    if (profile.interests?.length > 0) profileParts.push(`- **Interests**: ${profile.interests.join(", ")}`)
    profileParts.push("</user_context>")

    parts.push(profileParts.join("\n"))
  } catch {
    // No user profile — that's fine
  }

  // Learning memory
  try {
    const memorySummary = await buildMemorySummary()
    if (memorySummary) {
      parts.push(`<learning_memory>\n${memorySummary}\n</learning_memory>`)
    }
  } catch {
    // No learning data — that's fine
  }

  return parts.join("\n\n")
}

const CORE_PROMPTS_BY_AGENT: Record<string, string[]> = {
  agent: [PROMPT_THINKING_PATTERN, PROMPT_IDENTITY, PROMPT_TOOLS, PROMPT_WORKFLOW, PROMPT_COMMUNICATION, PROMPT_CODE_EDITING, PROMPT_GIT_SAFETY, PROMPT_EXTENSIONS],
  build: [PROMPT_THINKING_PATTERN, PROMPT_IDENTITY, PROMPT_TOOLS, PROMPT_WORKFLOW, PROMPT_COMMUNICATION, PROMPT_CODE_EDITING, PROMPT_GIT_SAFETY, PROMPT_EXTENSIONS],
  plan: [PROMPT_THINKING_PATTERN, PROMPT_IDENTITY, PROMPT_TOOLS, PROMPT_WORKFLOW, PROMPT_COMMUNICATION, PROMPT_EXTENSIONS],
  explore: [PROMPT_THINKING_PATTERN, PROMPT_TOOLS, PROMPT_WORKFLOW, PROMPT_COMMUNICATION, PROMPT_EXTENSIONS],
  checker: [PROMPT_THINKING_PATTERN, PROMPT_TOOLS, PROMPT_WORKFLOW, PROMPT_COMMUNICATION, PROMPT_CODE_EDITING, PROMPT_EXTENSIONS],
  reviewer: [PROMPT_THINKING_PATTERN, PROMPT_TOOLS, PROMPT_WORKFLOW, PROMPT_COMMUNICATION, PROMPT_CODE_EDITING, PROMPT_EXTENSIONS],
}

function getCorePromptsForAgent(agent: string): string[] {
  return CORE_PROMPTS_BY_AGENT[agent] ?? CORE_PROMPTS
}

// ─── PromptManager (Main Export) ─────────────────────────────

/**
 * Builds a complete system prompt synchronously.
 * Uses .txt file imports + inline emphasis sections.
 */
function build(options: BuildOptions): string {
  const { modelId, agent = "agent", customSections = [] } = options
  const coreSections = getCorePromptsForAgent(agent)

  const sections: string[] = [
    // Core prompts conditionally selected for agent
    ...coreSections,
    // Critical emphasis: read-before-edit (only if editing prompt included)
    ...(coreSections.includes(PROMPT_CODE_EDITING) ? [READ_BEFORE_EDIT_EMPHASIS] : []),
    // Agent-specific behavior
    AGENT_PROMPTS[agent as AgentType],
    // Custom sections
    ...customSections,
  ]

  return sections.filter(Boolean).join("\n\n---\n\n")
}

/**
 * Builds a complete system prompt asynchronously.
 * Includes dynamic context (user profile, learning memory).
 */
async function buildAsync(options: BuildOptions): Promise<string> {
  const {
    modelId,
    agent = "agent",
    customSections = [],
    includeLearningMemory = true,
    includeUserProfile = true,
  } = options

  // Load dynamic context
  let dynamicCtx = ""
  if (includeLearningMemory || includeUserProfile) {
    dynamicCtx = await generateDynamicContext()
  }

  const coreSections = getCorePromptsForAgent(agent)

  const sections: string[] = [
    // Core prompts conditionally selected for agent
    ...coreSections,
    // Dynamic context (user profile + learning memory)
    ...(dynamicCtx ? [dynamicCtx] : []),
    // Critical emphasis: read-before-edit (only if editing prompt included)
    ...(coreSections.includes(PROMPT_CODE_EDITING) ? [READ_BEFORE_EDIT_EMPHASIS] : []),
    // Agent-specific behavior
    AGENT_PROMPTS[agent as AgentType],
    // Custom sections
    ...customSections,
  ]

  return sections.filter(Boolean).join("\n\n---\n\n")
}

/**
 * Gets all core prompts concatenated.
 */
function getBasePrompts(): string {
  return CORE_PROMPTS.join("\n\n---\n\n")
}

/**
 * Gets the agent prompt for a given agent type.
 */
function getAgentPrompt(agent: AgentType): string {
  return AGENT_PROMPTS[agent]
}

/**
 * Returns prompt statistics for debugging/optimization.
 */
function getStats(options: BuildOptions): {
  totalTokens: number
  sections: { name: string; tokens: number; chars: number }[]
} {
  const prompt = build(options)
  const estimateTokens = (text: string) => Math.ceil(text.length / 4)

  const sections = [
    { name: "thinking-pattern", tokens: estimateTokens(PROMPT_THINKING_PATTERN), chars: PROMPT_THINKING_PATTERN.length },
    { name: "identity", tokens: estimateTokens(PROMPT_IDENTITY), chars: PROMPT_IDENTITY.length },
    { name: "tools", tokens: estimateTokens(PROMPT_TOOLS), chars: PROMPT_TOOLS.length },
    { name: "workflow", tokens: estimateTokens(PROMPT_WORKFLOW), chars: PROMPT_WORKFLOW.length },
    { name: "communication", tokens: estimateTokens(PROMPT_COMMUNICATION), chars: PROMPT_COMMUNICATION.length },
    { name: "code-editing", tokens: estimateTokens(PROMPT_CODE_EDITING), chars: PROMPT_CODE_EDITING.length },
    { name: "git-safety", tokens: estimateTokens(PROMPT_GIT_SAFETY), chars: PROMPT_GIT_SAFETY.length },
    { name: "extensions", tokens: estimateTokens(PROMPT_EXTENSIONS), chars: PROMPT_EXTENSIONS.length },
    {
      name: "read-before-edit",
      tokens: estimateTokens(READ_BEFORE_EDIT_EMPHASIS),
      chars: READ_BEFORE_EDIT_EMPHASIS.length,
    },
    {
      name: `agent:${options.agent || "agent"}`,
      tokens: estimateTokens(AGENT_PROMPTS[options.agent || "agent"]),
      chars: AGENT_PROMPTS[options.agent || "agent"].length,
    },
  ]

  return {
    totalTokens: estimateTokens(prompt),
    sections,
  }
}

// ─── Exports ─────────────────────────────────────────────────

export const PromptManager = {
  build,
  buildAsync,
  getBasePrompts,
  getAgentPrompt,
  getStats,
  detectProvider,
}

/**
 * @deprecated Use PromptManager instead. This alias exists for backward compatibility.
 */
export const PromptBuilder = PromptManager

export default PromptManager
