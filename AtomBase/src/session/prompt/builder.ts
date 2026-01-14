/**
 * PromptBuilder - Modular Prompt Composition System
 *
 * Dynamically composes system prompts from modular components:
 * - Base prompts (identity, tools, workflow, communication, code-editing, git-safety)
 * - Provider-specific optimizations (anthropic, gemini, openai, generic)
 * - Agent-specific behaviors (agent, explore, plan, build)
 */

import fs from "fs/promises"
import path from "path"

// Import base prompts
import PROMPT_IDENTITY from "./base/identity.txt"
import PROMPT_TOOLS from "./base/tools.txt"
import PROMPT_WORKFLOW from "./base/workflow.txt"
import PROMPT_COMMUNICATION from "./base/communication.txt"
import PROMPT_CODE_EDITING from "./base/code-editing.txt"
import PROMPT_GIT_SAFETY from "./base/git-safety.txt"
import PROMPT_EXTENSIONS from "./base/extensions.txt"

// Import provider-specific prompts
import PROMPT_ANTHROPIC from "./provider/anthropic.txt"
import PROMPT_GEMINI from "./provider/gemini.txt"
import PROMPT_OPENAI from "./provider/openai.txt"
import PROMPT_GENERIC from "./provider/generic.txt"

// Import agent-specific prompts
import PROMPT_AGENT from "./agent/agent.txt"
import PROMPT_EXPLORE from "./agent/explore.txt"
import PROMPT_PLAN from "./agent/plan.txt"
import PROMPT_BUILD from "./agent/build.txt"

export type ProviderType = "anthropic" | "gemini" | "openai" | "generic"
export type AgentType = "agent" | "explore" | "plan" | "build"

/**
 * Maps model API IDs to their provider types
 */
function detectProvider(modelId: string): ProviderType {
    const id = modelId.toLowerCase()

    if (id.includes("claude")) return "anthropic"
    if (id.includes("gemini")) return "gemini"
    if (id.includes("gpt") || id.includes("o1") || id.includes("o3") || id.includes("o4")) return "openai"

    return "generic"
}

/**
 * Provider-specific prompt map
 */
const PROVIDER_PROMPTS: Record<ProviderType, string> = {
    anthropic: PROMPT_ANTHROPIC,
    gemini: PROMPT_GEMINI,
    openai: PROMPT_OPENAI,
    generic: PROMPT_GENERIC,
}

/**
 * Agent-specific prompt map
 */
const AGENT_PROMPTS: Record<AgentType, string> = {
    agent: PROMPT_AGENT,
    explore: PROMPT_EXPLORE,
    plan: PROMPT_PLAN,
    build: PROMPT_BUILD,
}

/**
 * Base prompts that are always included
 */
const BASE_PROMPTS = [
    PROMPT_IDENTITY,
    PROMPT_TOOLS,
    PROMPT_WORKFLOW,
    PROMPT_COMMUNICATION,
    PROMPT_CODE_EDITING,
    PROMPT_GIT_SAFETY,
    PROMPT_EXTENSIONS,
]

export interface BuildOptions {
    /** Model API ID (e.g., "claude-3-5-sonnet", "gemini-2.0-flash") */
    modelId: string
    /** Agent type (default: "agent") */
    agent?: AgentType
    /** Include todo/task management in prompt */
    includeTodo?: boolean
    /** Custom sections to append */
    customSections?: string[]
}

/**
 * Builds a complete system prompt from modular components
 */
export function build(options: BuildOptions): string {
    const { modelId, agent = "agent", customSections = [] } = options

    const provider = detectProvider(modelId)

    const sections: string[] = [
        // Core identity and capabilities
        ...BASE_PROMPTS,
        // Provider-specific optimizations
        PROVIDER_PROMPTS[provider],
        // Agent-specific behavior
        AGENT_PROMPTS[agent],
        // Custom sections
        ...customSections,
    ]

    return sections.filter(Boolean).join("\n\n---\n\n")
}

/**
 * Gets the provider prompt for a given model ID
 */
export function getProviderPrompt(modelId: string): string {
    const provider = detectProvider(modelId)
    return PROVIDER_PROMPTS[provider]
}

/**
 * Gets all base prompts concatenated
 */
export function getBasePrompts(): string {
    return BASE_PROMPTS.join("\n\n---\n\n")
}

/**
 * Gets the agent prompt for a given agent type
 */
export function getAgentPrompt(agent: AgentType): string {
    return AGENT_PROMPTS[agent]
}

/**
 * Returns prompt statistics for debugging/optimization
 */
export function getStats(options: BuildOptions): {
    totalTokens: number
    sections: { name: string; tokens: number }[]
} {
    const prompt = build(options)

    // Rough token estimation (4 chars per token on average)
    const estimateTokens = (text: string) => Math.ceil(text.length / 4)

    const sections = [
        { name: "identity", tokens: estimateTokens(PROMPT_IDENTITY) },
        { name: "tools", tokens: estimateTokens(PROMPT_TOOLS) },
        { name: "workflow", tokens: estimateTokens(PROMPT_WORKFLOW) },
        { name: "communication", tokens: estimateTokens(PROMPT_COMMUNICATION) },
        { name: "code-editing", tokens: estimateTokens(PROMPT_CODE_EDITING) },
        { name: "git-safety", tokens: estimateTokens(PROMPT_GIT_SAFETY) },
        { name: `provider:${detectProvider(options.modelId)}`, tokens: estimateTokens(PROVIDER_PROMPTS[detectProvider(options.modelId)]) },
        { name: `agent:${options.agent || "agent"}`, tokens: estimateTokens(AGENT_PROMPTS[options.agent || "agent"]) },
    ]

    return {
        totalTokens: estimateTokens(prompt),
        sections,
    }
}

export const PromptBuilder = {
    build,
    getProviderPrompt,
    getBasePrompts,
    getAgentPrompt,
    getStats,
    detectProvider,
}

export default PromptBuilder
