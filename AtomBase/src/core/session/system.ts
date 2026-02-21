import { Ripgrep } from "@/services/file/ripgrep"
import { Global } from "../global"
import { Filesystem } from "@/util/util/filesystem"
import { Config } from "../config/config"
import { Skill } from "@/integrations/skill/skill"
import { MCP } from "@/integrations/mcp"

import { Instance } from "@/services/project/instance"
import path from "path"
import os from "os"

// Unified prompt system
import { PromptManager } from "./prompt/manager"

// Runtime prompt injections
import PROMPT_ANTHROPIC_SPOOF from "./prompt/runtime/anthropic-spoof.txt"

import type { Provider } from "@/integrations/provider/provider"
import { Flag } from "@/interfaces/flag/flag"

// Memory integration
import { SessionMemoryIntegration } from "../memory/integration/session"

export namespace SystemPrompt {
  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  export function instructions() {
    // Legacy codex_header instructions are now integrated into PromptManager.
    // Return empty to prevent duplication/conflict.
    return ""
  }

  export function provider(model: Provider.Model) {
    // Use unified PromptManager for all models
    const prompt = PromptManager.build({
      modelId: model.api.id,
      agent: "agent"  // Default agent mode
    })
    return [prompt]
  }

  export async function environment(): Promise<string[]> {
    const project = Instance.project
    const now = new Date()
    const year = now.getFullYear()
    const dateStr = now.toLocaleString("tr-TR", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    // Initialize memory system
    await SessionMemoryIntegration.initialize()

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
      `<files>`,
      `  ${project.vcs === "git" && false
        ? await Ripgrep.tree({
          cwd: Instance.directory,
          limit: 200,
        })
        : ""
      }`,
      `</files>`,
    ].join("\n")

    // Get user context from memory
    const userContext = await SessionMemoryIntegration.getUserContext()
    const userContextBlock = userContext ? `\n\n## 🧠 User Memory\n\n${userContext}` : ""

    const [skills, mcpStatus] = await Promise.all([Skill.state(), MCP.status()])
    const skillList = Object.values(skills).map(s => `  - ${s.name}: ${s.description}`).join("\n")
    const connectedMcps = Object.entries(mcpStatus)
      .filter(([_, status]) => status.status === "connected")
      .map(([name, _]) => name)
    const mcpList = connectedMcps.map(name => `  - ${name}`).join("\n")

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

Example usage:
- mcp_memory_save: key="user_preference_typescript", value="User prefers explicit type annotations"
- mcp_memory_search: query="project conventions"
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
      ...(mcpInstructions.length > 0 ? [``, `<!-- MCP USAGE GUIDE -->`, ...mcpInstructions] : [])
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
}
