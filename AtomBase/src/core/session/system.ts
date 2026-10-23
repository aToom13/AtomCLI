import { Log } from "@/util/util/log"
import { Global } from "../global"
import { Filesystem } from "@/util/util/filesystem"
import { Config } from "../config/config"
import { Skill } from "@/integrations/skill/skill"
import { MCP } from "@/integrations/mcp"

import { Instance } from "@/services/project/instance"
import path from "path"
import os from "os"
import { ProjectDetector } from "./project-detector"
import { ContextManifest } from "./context-manifest"

// Unified prompt system
import { PromptManager } from "./prompt/manager"

import type { Provider } from "@/integrations/provider/provider"
import { Flag } from "@/interfaces/flag/flag"
import { ConfigMarkdown } from "@/core/config/markdown"
import { PermissionNext } from "@/util/permission/next"
import type { ExecutionContract } from "@/core/routing/execution-contract"

// Memory integration
import memorySystem from "../memory"
import { SessionMemoryIntegration } from "../memory/integration/session"

export namespace SystemPrompt {
  export function header(_providerID: string) {
    return []
  }

  export function instructions() {
    // Legacy codex_header instructions are now integrated into PromptManager.
    // Return empty to prevent duplication/conflict.
    return ""
  }

  export function provider(
    model: Provider.Model,
    agentName?: string,
    scope?: "direct" | "focused" | "coordinated",
    risk?: "low" | "elevated" | "critical",
  ) {
    // Map agent name to PromptManager AgentType
    // Known agent types get their specific prompts; others fall back to "agent"
    const knownAgentTypes = ["agent", "explore", "plan", "build", "checker", "reviewer"] as const
    type KnownAgent = (typeof knownAgentTypes)[number]
    const agentType: KnownAgent = knownAgentTypes.includes(agentName as KnownAgent)
      ? (agentName as KnownAgent)
      : "agent"

    // Use unified PromptManager for all models
    const prompt = PromptManager.build({
      modelId: model.api.id,
      agent: agentType,
      scope,
      risk,
    })
    return [prompt]
  }

  export async function environment(
    query = "",
    availableMcpNames?: Iterable<string>,
    includeUserMemory = true,
  ): Promise<string[]> {
    const project = Instance.project
    const now = new Date()
    const year = now.getFullYear()
    const dateStr = now.toLocaleString("tr-TR", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    // Initialize memory system (storage & embeddings)
    try {
      await memorySystem.initialize()
    } catch (error) {
      // Memory storage is optional — don't crash on init failure
      Log.Default.warn("memory", { msg: "Storage initialization failed, continuing without memory storage", error })
    }

    // Initialize session integration (profiles & preferences)
    await SessionMemoryIntegration.initialize()

    // Cheap local learning: remember which project this session runs in.
    void SessionMemoryIntegration.trackProject(path.basename(Instance.directory))

    // Detect project commands (test, typecheck, lint) from manifest files
    const manifest = await ContextManifest.get(query)
    const projectCommands = manifest.commands
    const projectCommandsBlock = ProjectDetector.format(projectCommands)

    const envBlock = [
      `## CURRENT DATE AND TIME (IMPORTANT!)`,
      ``,
      `**TODAY IS: ${year} - ${dateStr} (${timezone})**`,
      ``,
      `⚠️ CRITICAL: The current year is ${year}. When searching the web or providing information,`,
      `always use ${year} as your reference year. Do NOT confuse dates from search results`,
      `with the actual current date. The authoritative current date is: ${now.toISOString()}`,
      ``,
      `---`,
      ``,
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,
      `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      `  Current year: ${year}`,
      `  Current datetime: ${dateStr} (${timezone})`,
      `  ISO timestamp: ${now.toISOString()}`,
      `</env>`,
      ...(projectCommandsBlock ? [projectCommandsBlock] : []),
      `<files>`,
      `  ${manifest.tree}`,
      `</files>`,
      `<semantic_project_map>`,
      manifest.semantic,
      `</semantic_project_map>`,
    ].join("\n")

    // Get user context from memory
    const userContext = includeUserMemory ? await SessionMemoryIntegration.getUserContext() : ""
    const userContextBlock = userContext ? `\n\n## 🧠 User Memory\n\n${userContext}` : ""

    // MCP servers may take several seconds to initialize (for example an
    // npx-backed local server on first launch). Do not replace a connected
    // server with a false empty list while its startup is still in progress.
    const skills = await Skill.state()
    const skillList = Object.values(skills)
      .map(
        (s) =>
          `  - ${s.name}: ${s.description} (source: ${s.location}${s.alternatives?.length ? `; shadowed: ${s.alternatives.join(", ")}` : ""})`,
      )
      .join("\n")
    let connectedMcps: string[]
    if (availableMcpNames && [...availableMcpNames].length > 0) {
      connectedMcps = [...availableMcpNames]
    } else {
      const mcpStatus = await MCP.status().catch(() => ({}) as Record<string, MCP.Status>)
      connectedMcps = Object.entries(mcpStatus)
        .filter(([_, status]) => status.status === "connected")
        .map(([name, _]) => name)
    }
    const mcpList = connectedMcps.map((name) => `  - ${name}`).join("\n")

    // Build MCP usage instructions based on connected servers
    const mcpInstructions: string[] = []

    if (connectedMcps.includes("memory")) {
      mcpInstructions.push(`
## 🧠 Memory MCP (PROACTIVE USE REQUIRED)

You have access to a persistent memory system. USE IT PROACTIVELY:

**SAVE to memory when:**
- User shares a preference ("I prefer X over Y")
- You learn something important about the project
- User corrects a mistake you made
- A decision is made that should be remembered
- You discover project-specific patterns or conventions

**READ from memory when:**
- Starting a new session (check for relevant past context)
- Working on a topic you might have notes about
- Before making assumptions about user preferences

Note: AtomCLI also has a built-in persistent "memory" tool that stores durable
facts across sessions and injects relevant entries into prompts automatically.
Prefer the built-in memory tool for long-lived user/project facts; use this
MCP server only when you specifically need its separate storage.
`)
    }

    if (connectedMcps.includes("sequential-thinking")) {
      mcpInstructions.push(`
## 🔗 Sequential Thinking MCP

Use this for complex multi-step reasoning:

**USE when:**
- Debugging a tricky issue with multiple possible causes
- Planning a complex refactoring
- Analyzing a problem that requires step-by-step logic
- Making architectural decisions

This helps you think through problems systematically before acting.
`)
    }

    const skillsMcpBlock = [
      `<skills_available>`,
      `  <!-- STRATEGY: Load these skills using 'skill' tool if your task matches the description -->`,
      skillList || "  (No skills found)",
      `</skills_available>`,
      `<mcp_servers>`,
      mcpList || "  (No MCP servers connected)",
      `</mcp_servers>`,
      `Use mcp_tools list for the complete permitted catalog, then load exact IDs. Full schemas appear on the next turn. Do not infer availability from prompt keywords or an initially empty schema list.`,
      ...(mcpInstructions.length > 0 ? [``, `<!-- MCP USAGE GUIDE -->`, ...mcpInstructions] : []),
    ].join("\n")

    return [envBlock + userContextBlock, skillsMcpBlock]
  }

  const LOCAL_RULE_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    "CONTEXT.md", // deprecated
  ]
  const GLOBAL_RULE_FILES = [path.join(Global.Path.config, "AGENTS.md")]
  if (!Flag.ATOMCLI_DISABLE_CLAUDE_CODE_PROMPT) {
    GLOBAL_RULE_FILES.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }

  if (Flag.ATOMCLI_CONFIG_DIR) {
    GLOBAL_RULE_FILES.push(path.join(Flag.ATOMCLI_CONFIG_DIR, "AGENTS.md"))
  }

  export async function custom() {
    const config = await Config.get()
    const paths = new Set<string>()

    for (const localRuleFile of LOCAL_RULE_FILES) {
      const matches = await Filesystem.findUp(localRuleFile, Instance.directory, Instance.worktree)
      if (matches.length > 0) {
        matches.forEach((path) => paths.add(path))
        break
      }
    }

    for (const globalRuleFile of GLOBAL_RULE_FILES) {
      if (await Bun.file(globalRuleFile).exists()) {
        paths.add(globalRuleFile)
        break
      }
    }

    const urls: string[] = []
    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
          urls.push(instruction)
          continue
        }
        if (instruction.startsWith("~/")) {
          instruction = path.join(os.homedir(), instruction.slice(2))
        }
        let matches: string[] = []
        if (path.isAbsolute(instruction)) {
          matches = await Array.fromAsync(
            new Bun.Glob(path.basename(instruction)).scan({
              cwd: path.dirname(instruction),
              absolute: true,
              onlyFiles: true,
            }),
          ).catch(() => [])
        } else {
          matches = await Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
        }
        matches.forEach((path) => paths.add(path))
      }
    }

    const foundFiles = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => "Instructions from: " + p + "\n" + x),
    )
    const foundUrls = urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
    )
    return Promise.all([...foundFiles, ...foundUrls]).then((result) => result.filter(Boolean))
  }

  /**
   * Surfaces skill suggestions based on trigger_words matching the user's message.
   *
   * DESIGN: This does NOT blindly inject full skill content — that bypasses model reasoning.
   * Instead it emits a lightweight hint that tells the model "a relevant skill exists".
   * The model then makes the semantic decision to call skill(action="load") and read it.
   *
   * trigger_words = surfacing mechanism (bring to attention)
   * skill(action="load") = the model's own decision after understanding the task
   */
  export async function autoInjectSkills(
    userText: string,
    permission?: PermissionNext.Ruleset,
    onRead?: (record: Skill.LoadedChunk) => void,
    contract?: ExecutionContract.Info,
  ): Promise<string> {
    if (!userText.trim()) return ""
    let candidates: Skill.Info[]
    let explicit: Awaited<ReturnType<typeof Skill.explicitRequests>>
    try {
      ;[candidates, explicit] = await Promise.all([
        Skill.findAutoInjectCandidates(userText),
        Skill.explicitRequests(userText),
      ])
    } catch (error) {
      return `<skill_resolution_error>${error instanceof Error ? error.message : String(error)}</skill_resolution_error>`
    }
    const explicitReferences = Skill.requestsReferences(userText)
    let selected = explicit.skills.length
      ? explicit.skills
      : explicitReferences && candidates.length === 1
        ? candidates
        : []
    selected = await Skill.resolveDependencies([...selected, ...(await Skill.taskSkills(contract))], userText)
    const top = candidates.filter((skill) => !selected.includes(skill)).slice(0, 3)
    if (!selected.length && !top.length && !explicit.unresolved.length) return ""
    const blocks: string[] = []
    const remaining: string[] = []
    let budget = 48_000
    for (const skill of selected) {
      if (permission && PermissionNext.evaluate("skill", skill.name, permission).action !== "allow") {
        remaining.push(`${skill.name}: permission required; use the skill tool`)
        continue
      }
      blocks.push(
        `Skill: ${skill.name}; source: ${skill.location}${skill.alternatives?.length ? `; shadowed definitions: ${skill.alternatives.join(", ")}` : ""}`,
      )
      try {
        const content = (await ConfigMarkdown.parse(skill.location)).content.trim()
        const root = Skill.chunk(content, 0, Math.min(12_000, budget))
        onRead?.(Skill.loadedChunk(skill.name, skill.location, content, 0, root.length))
        blocks.push(`Loaded parent ${skill.name}: characters 0–${root.length} of ${content.length}\n${root}`)
        if (!explicit.references.has(skill.name) && !explicitReferences && (await Skill.referenceCatalog(skill)).length)
          remaining.push(
            `${skill.name}: select references from the parent instructions using the skill tool's references and reason; keyword suggestions do not complete routing`,
          )
        budget -= root.length
        if (root.length < content.length)
          remaining.push(`${skill.name}, offset=${root.length}: parent partially loaded`)
        const references = await Skill.loadReferences({
          skill,
          prompt: userText,
          names: explicit.references.get(skill.name) ?? (explicitReferences ? undefined : []),
          maxChars: Math.min(12_000, budget),
          relevantOnly: !explicitReferences,
          permission,
        })
        blocks.push(...references.entries)
        for (const record of references.loaded) onRead?.(record)
        budget -= references.loaded.reduce((total, file) => total + file.length, 0)
        remaining.push(...references.remaining.map((file) => `${file.name}, offset=${file.offset}: ${file.reason}`))
      } catch (error) {
        remaining.push(`${skill.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const hints = top
      .map((skill) => `  - **${skill.name}**: ${skill.description} (source: ${skill.location})`)
      .join("\n")
    return [
      `<skill_suggestion>`,
      ...(top.length ? [`Suggested skills; decide from their descriptions before loading:`, hints] : []),
      ...(blocks.length ? ["Explicit skills and task-routed references (loaded content follows):", ...blocks] : []),
      ...(explicitReferences && !selected.length
        ? [
            `Reference request has no unique skill identity. Use exact skill names; candidates: ${candidates.map((skill) => skill.name).join(", ") || "none"}`,
          ]
        : []),
      ...explicit.unresolved.map((item) => `Unresolved explicit reference: ${item}`),
      ...(remaining.length
        ? [
            "Content omitted from this block. Use confirmed earlier chunks or load these offsets with the skill tool before relying on them:",
            ...remaining.map((item) => `- ${item}`),
          ]
        : []),
      `</skill_suggestion>`,
    ].join("\n")
  }
}
