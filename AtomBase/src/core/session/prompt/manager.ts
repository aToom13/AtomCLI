/**
 * PromptManager — Unified Prompt Orchestration System
 *
 * Single entry point for all system prompt composition. Merges the former
 * builder.ts (which imported .txt files) with the modular manager architecture.
 *
 * Architecture:
 *
 *   prompt/
 *   ├── core/           8 base .txt prompts (always included)
 *   ├── provider/       4 provider-specific .txt prompts
 *   ├── agent/          4 agent-mode .txt prompts
 *   ├── runtime/        Special-purpose runtime injections
 *   └── manager.ts      ← THIS FILE (unified orchestrator)
 *
 * Modules:
 *   IdentityModule      → core/identity.txt
 *   ToolsModule         → core/tools.txt + orchestrate/todo extras
 *   WorkflowModule      → core/workflow.txt
 *   CommunicationModule → core/communication.txt
 *   CodeEditingModule   → core/code-editing.txt + read-before-edit emphasis
 *   GitSafetyModule     → core/git-safety.txt
 *   ExtensionsModule    → core/extensions.txt (skills + MCP)
 *   SelfLearningModule  → core/self-learning.txt
 *   ContextModule       → Dynamic env (CWD, OS, date, git, user profile)
 *   ProviderModule      → provider/*.txt (auto-detected from model ID)
 *   AgentModule         → agent/*.txt (based on agent type)
 */

import fs from "fs/promises"
import path from "path"
import os from "os"

// ─── Core Prompts (always included) ──────────────────────────

import PROMPT_IDENTITY from "./core/identity.txt"
import PROMPT_TOOLS from "./core/tools.txt"
import PROMPT_WORKFLOW from "./core/workflow.txt"
import PROMPT_COMMUNICATION from "./core/communication.txt"
import PROMPT_CODE_EDITING from "./core/code-editing.txt"
import PROMPT_GIT_SAFETY from "./core/git-safety.txt"
import PROMPT_EXTENSIONS from "./core/extensions.txt"
import PROMPT_SELF_LEARNING from "./core/self-learning.txt"

// ─── Provider-Specific Prompts ───────────────────────────────

import PROMPT_ANTHROPIC from "./provider/anthropic.txt"
import PROMPT_GEMINI from "./provider/gemini.txt"
import PROMPT_OPENAI from "./provider/openai.txt"
import PROMPT_GENERIC from "./provider/generic.txt"

// ─── Agent-Specific Prompts ──────────────────────────────────

import PROMPT_AGENT from "./agent/agent.txt"
import PROMPT_EXPLORE from "./agent/explore.txt"
import PROMPT_PLAN from "./agent/plan.txt"
import PROMPT_BUILD from "./agent/build.txt"

// ─── Learning System ─────────────────────────────────────────

import { Learning } from "@/services/learning"

// ─── Types ───────────────────────────────────────────────────

export type ProviderType = "anthropic" | "gemini" | "openai" | "generic"
export type AgentType = "agent" | "explore" | "plan" | "build"

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

// ─── Provider Detection ──────────────────────────────────────

function detectProvider(modelId: string): ProviderType {
    const id = modelId.toLowerCase()
    if (id.includes("claude")) return "anthropic"
    if (id.includes("gemini")) return "gemini"
    if (id.includes("gpt") || id.includes("o1") || id.includes("o3") || id.includes("o4")) return "openai"
    return "generic"
}

// ─── Prompt Maps ─────────────────────────────────────────────

const PROVIDER_PROMPTS: Record<ProviderType, string> = {
    anthropic: PROMPT_ANTHROPIC,
    gemini: PROMPT_GEMINI,
    openai: PROMPT_OPENAI,
    generic: PROMPT_GENERIC,
}

const AGENT_PROMPTS: Record<AgentType, string> = {
    agent: PROMPT_AGENT,
    explore: PROMPT_EXPLORE,
    plan: PROMPT_PLAN,
    build: PROMPT_BUILD,
}

/**
 * Core prompts that are ALWAYS included in every system prompt.
 * Order matters — identity first, then capabilities, then rules.
 */
const CORE_PROMPTS = [
    PROMPT_IDENTITY,
    PROMPT_SELF_LEARNING,
    PROMPT_TOOLS,
    PROMPT_WORKFLOW,
    PROMPT_COMMUNICATION,
    PROMPT_CODE_EDITING,
    PROMPT_GIT_SAFETY,
    PROMPT_EXTENSIONS,
]

// ─── Read-Before-Edit Emphasis ───────────────────────────────

const READ_BEFORE_EDIT_EMPHASIS = `
<critical_rule>
## ⛔ THE GOLDEN RULE — READ BEFORE EDIT

This is the single most critical rule in your entire system prompt.

\`\`\`
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   You MUST Read() a file BEFORE you can Edit() it.          │
│                                                              │
│   The Edit tool WILL FAIL if you haven't read first.        │
│   This is a hard technical constraint, not a suggestion.    │
│                                                              │
│   BEFORE every edit, verify:                                │
│   1. Have I Read() this file in this session?               │
│   2. Has the file changed since I last read it?             │
│   3. Do I understand the code patterns in this file?        │
│   4. Does my oldString EXACTLY match current content?       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
\`\`\`
</critical_rule>
`.trim()

// ─── Orchestrate Tool Details ────────────────────────────────

const ORCHESTRATE_DETAILS = `
<orchestrate_guide>
## 🎯 Orchestrate Tool — Multi-Agent Workflow Engine

The \`orchestrate\` tool decomposes complex tasks into parallel and sequential sub-tasks,
each executed by a dedicated sub-agent.

### When to Use
Use when a request can be broken into **multiple independent subtasks**:
- "Analyze code, write tests, and create docs" → 3 tasks, tests+docs depend on analysis
- "Refactor module A and B, then integrate" → 2 parallel + 1 dependent task

### How to Use (2 Steps)

**Step 1 — Plan:**
\`\`\`json
{
  "action": "plan",
  "tasks": [
    { "id": "analyze", "prompt": "Analyze the codebase", "category": "analysis" },
    { "id": "tests", "prompt": "Write tests", "category": "coding", "dependsOn": ["analyze"] },
    { "id": "docs", "prompt": "Write docs", "category": "documentation", "dependsOn": ["analyze"] }
  ]
}
\`\`\`
→ Returns \`workflowId\`. Same-layer tasks run in **parallel**.

**Step 2 — Execute:**
\`\`\`json
{ "action": "execute", "workflowId": "<returned-id>" }
\`\`\`
→ Runs in background. You get notified with results + Session IDs.

**Optional — Status / Abort:**
\`\`\`json
{ "action": "status", "workflowId": "<id>" }
{ "action": "abort", "workflowId": "<id>" }
{ "action": "abort", "sessionId": "<sub-agent-session-id>" }
\`\`\`

### Task Categories
\`"coding"\` | \`"documentation"\` | \`"analysis"\` | \`"general"\`

### Task vs Orchestrate
- **Task**: Single focused subtask, blocking (waits for result)
- **Orchestrate**: Multiple subtasks, non-blocking (background execution)
</orchestrate_guide>
`.trim()

// ─── TodoWrite Details ───────────────────────────────────────

const TODOWRITE_DETAILS = `
<chain_todo_guide>
## 📋 Chain + TodoWrite — Visual Progress + Task Tracking

You have TWO complementary tools for task management:

### 🔗 Chain (chainupdate) — What the USER sees
Visual progress bar at the top of the terminal. **Always use for user visibility.**
\`\`\`
chainupdate [action=start]                        → Start progress bar
chainupdate [action=update, status=doing_X]       → Show current action
chainupdate [action=complete]                     → Advance progress
chainupdate [action=clear]                        → Clear when done
\`\`\`

### 📋 TodoWrite — Task state tracking
Structured task list with states. **Use for planning and state management.**
\`\`\`typescript
TodoWrite([
  { id: "1", content: "🔍 Analyze", status: "in_progress" },  // ⚠️ ONLY ONE!
  { id: "2", content: "📝 Implement", status: "pending" },
  { id: "3", content: "✅ Verify", status: "pending" }
])
\`\`\`

### 🔄 Use BOTH Together
1. **Start**: \`chainupdate [action=start]\` + TodoWrite with plan
2. **Progress**: \`chainupdate [action=update]\` for visual + TodoWrite for state
3. **Step done**: \`chainupdate [action=complete]\` + TodoWrite mark completed
4. **Finish**: \`chainupdate [action=clear]\` + TodoWrite all completed

### Rules
- Only ONE \`in_progress\` task at a time
- Mark \`in_progress\` BEFORE starting, \`completed\` IMMEDIATELY after
- Chain = user visibility, TodoWrite = state tracking
</chain_todo_guide>
`.trim()

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
        const memorySummary = await Learning.buildMemorySummary()
        if (memorySummary) {
            parts.push(`<learning_memory>\n${memorySummary}\n</learning_memory>`)
        }
    } catch {
        // No learning data — that's fine
    }

    return parts.join("\n\n")
}

// ─── PromptManager (Main Export) ─────────────────────────────

/**
 * Builds a complete system prompt synchronously.
 * Uses .txt file imports + inline emphasis sections.
 */
function build(options: BuildOptions): string {
    const { modelId, agent = "agent", customSections = [] } = options
    const provider = detectProvider(modelId)

    const sections: string[] = [
        // Core prompts from .txt files (identity, tools, workflow, etc.)
        ...CORE_PROMPTS,
        // Critical emphasis: read-before-edit
        READ_BEFORE_EDIT_EMPHASIS,
        // Detailed orchestrate instructions
        ORCHESTRATE_DETAILS,
        // Detailed TodoWrite instructions
        TODOWRITE_DETAILS,
        // Provider-specific optimizations
        PROVIDER_PROMPTS[provider],
        // Agent-specific behavior
        AGENT_PROMPTS[agent],
        // Custom sections (user-provided extras)
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

    const provider = detectProvider(modelId)

    // Load dynamic context
    let dynamicCtx = ""
    if (includeLearningMemory || includeUserProfile) {
        dynamicCtx = await generateDynamicContext()
    }

    const sections: string[] = [
        // Core prompts from .txt files
        ...CORE_PROMPTS,
        // Dynamic context (user profile + learning memory)
        ...(dynamicCtx ? [dynamicCtx] : []),
        // Critical emphasis: read-before-edit
        READ_BEFORE_EDIT_EMPHASIS,
        // Detailed orchestrate instructions
        ORCHESTRATE_DETAILS,
        // Detailed TodoWrite instructions
        TODOWRITE_DETAILS,
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
 * Gets the provider prompt for a given model ID.
 */
function getProviderPrompt(modelId: string): string {
    return PROVIDER_PROMPTS[detectProvider(modelId)]
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
        { name: "identity", tokens: estimateTokens(PROMPT_IDENTITY), chars: PROMPT_IDENTITY.length },
        { name: "self-learning", tokens: estimateTokens(PROMPT_SELF_LEARNING), chars: PROMPT_SELF_LEARNING.length },
        { name: "tools", tokens: estimateTokens(PROMPT_TOOLS), chars: PROMPT_TOOLS.length },
        { name: "workflow", tokens: estimateTokens(PROMPT_WORKFLOW), chars: PROMPT_WORKFLOW.length },
        { name: "communication", tokens: estimateTokens(PROMPT_COMMUNICATION), chars: PROMPT_COMMUNICATION.length },
        { name: "code-editing", tokens: estimateTokens(PROMPT_CODE_EDITING), chars: PROMPT_CODE_EDITING.length },
        { name: "git-safety", tokens: estimateTokens(PROMPT_GIT_SAFETY), chars: PROMPT_GIT_SAFETY.length },
        { name: "extensions", tokens: estimateTokens(PROMPT_EXTENSIONS), chars: PROMPT_EXTENSIONS.length },
        { name: "read-before-edit", tokens: estimateTokens(READ_BEFORE_EDIT_EMPHASIS), chars: READ_BEFORE_EDIT_EMPHASIS.length },
        { name: "orchestrate-guide", tokens: estimateTokens(ORCHESTRATE_DETAILS), chars: ORCHESTRATE_DETAILS.length },
        { name: "todowrite-guide", tokens: estimateTokens(TODOWRITE_DETAILS), chars: TODOWRITE_DETAILS.length },
        { name: `provider:${detectProvider(options.modelId)}`, tokens: estimateTokens(PROVIDER_PROMPTS[detectProvider(options.modelId)]), chars: PROVIDER_PROMPTS[detectProvider(options.modelId)].length },
        { name: `agent:${options.agent || "agent"}`, tokens: estimateTokens(AGENT_PROMPTS[options.agent || "agent"]), chars: AGENT_PROMPTS[options.agent || "agent"].length },
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
    getProviderPrompt,
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
