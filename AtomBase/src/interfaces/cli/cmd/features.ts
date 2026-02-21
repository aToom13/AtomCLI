import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"

const FEATURES = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                           AtomCLI Hidden Features                            ║
╚══════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────────┐
│  🔧 CUSTOM TOOLS                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Create your own tools in ~/.atomcli/tool/*.ts                              │
│  Example: ~/.atomcli/tool/screenshot.ts                                     │
│                                                                             │
│  export default {                                                           │
│    description: "Take a screenshot",                                        │
│    args: { filename: z.string() },                                          │
│    execute: async (args) => \`Screenshot saved to \${args.filename}\`         │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  📚 SKILLS SYSTEM                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Add specialized behaviors via SKILL.md files:                              │
│  • ~/.atomcli/skill/SKILL.md (global)                                       │
│  • .atomcli/skill/SKILL.md (project-local)                                  │
│                                                                             │
│  Commands: atomcli skill list | atomcli skill show <name>                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  🔌 MCP (Model Context Protocol)                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Connect external tools and services:                                       │
│  • atomcli mcp add <server>   - Add MCP server                              │
│  • atomcli mcp list           - List connected MCPs                         │
│  • /mcp (in TUI)              - Toggle MCPs on/off                          │
│                                                                             │
│  Popular MCPs: memory, sequential-thinking, filesystem                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  🏠 LOCAL LLM (Ollama)                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Run models locally without API keys:                                       │
│  1. Install Ollama: curl -fsSL https://ollama.ai/install.sh | sh            │
│  2. Pull a model: ollama pull gemma3:4b                                     │
│  3. In AtomCLI: Ctrl+A → Ollama → Select model                              │
│                                                                             │
│  Your local models are auto-detected when Ollama is running.                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚙️  CONFIGURATION                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Global: ~/.atomcli/atomcli.json                                            │
│  Project: .atomcli/atomcli.json                                             │
│                                                                             │
│  Options:                                                                   │
│  • provider.<id>.options    - Provider-specific settings                    │
│  • disabled_providers       - Hide unwanted providers                       │
│  • permission               - Default tool permissions                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  🎯 AGENTS                                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Built-in agents with different capabilities:                               │
│  • build   - Default coding agent (Ctrl+Tab to switch)                      │
│  • plan    - Planning mode (creates .atomcli/plan/*.md)                     │
│  • explore - Read-only codebase exploration                                 │
│  • agent   - Autonomous mode (full permissions)                             │
│                                                                             │
│  Create custom agents in .atomcli/agent/*.md                                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  📁 DATA STORAGE                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  All data stored locally:                                                   │
│  • Sessions: ~/.local/share/atomcli/storage/session/                        │
│  • Messages: ~/.local/share/atomcli/storage/message/                        │
│  • Config:   ~/.atomcli/atomcli.json                                        │
│                                                                             │
│  No data leaves your machine unless you use cloud providers.                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  ⌨️  KEYBOARD SHORTCUTS (TUI)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  Tab        - Switch agent                                                  │
│  Ctrl+A     - Connect provider / Select model                               │
│  Ctrl+P     - Command palette                                               │
│  Ctrl+R     - Review changes                                                │
│  Ctrl+Z     - Undo last message                                             │
│  Ctrl+Y     - Redo                                                          │
│  Escape     - Cancel / Close dialog                                         │
└─────────────────────────────────────────────────────────────────────────────┘

For more info: https://github.com/aToom13/AtomCLI
`

export const FeaturesCommand = cmd({
    command: "features",
    describe: "show all AtomCLI features and hidden capabilities",
    builder: (yargs: Argv) => yargs,
    handler: async () => {
        console.log(UI.logo())
        console.log(FEATURES)
    },
})
