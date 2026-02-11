<div align="center">

# AtomCLI

```
           █████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗
          ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║
          ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║
          ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║
          ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║
          ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝
```

**AI-Powered Terminal Coding Assistant**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/aToom13/AtomCLI)](https://github.com/aToom13/AtomCLI/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/aToom13/AtomCLI)](https://github.com/aToom13/AtomCLI/issues)

<img src="docs/assets/StartPage.png" alt="AtomCLI" width="600"/>

</div>

---

## What is AtomCLI?

AtomCLI is an open-source, terminal-based AI coding assistant that helps developers write, debug, and refactor code directly from the command line. It provides an interactive TUI (Text User Interface) with full mouse support, multiple AI provider integrations, and extensibility through MCP servers and skills.

Unlike cloud-based solutions, AtomCLI stores all your data locally and gives you full control over which AI providers you use.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
```

Run `atomcli` to start.

---

## Features

### Core Capabilities

- **Interactive TUI** - Beautiful terminal interface with mouse support, syntax highlighting, and multi-panel layouts
- **Multi-Provider Support** - Works with OpenAI, Anthropic, Google, Ollama, OpenRouter, and more
- **Free Models Available** - Use built-in free providers (MiniMax, GLM, Kimi, GPT, ex.) without API keys
- **Semantic Memory System** - AI learns your preferences, coding style, and project context automatically
- **Code Intelligence** - File editing, code generation, debugging, and refactoring capabilities
- **Session Management** - Save and continue conversations, branch sessions, and manage history
- **Streaming Interrupt** - Send amendments while AI is writing (Shift+Enter)
- **Model Fallback** - Automatic failover when primary model fails

### Developer Tools (v2.1.4+)

- **`atomcli test-gen`** - Automatically generate unit tests for source files
- **`atomcli docs`** - Generate JSDoc comments and API documentation
- **`atomcli security`** - Scan code for vulnerabilities and secrets
- **`atomcli perf`** - Analyze code for performance issues and Big-O complexity
- **`atomcli refactor`** - Detect code smells and suggest automated refactorings
- **`atomcli review`** - Review GitHub PRs automatically
- **`atomcli workspace`** - Manage multi-project workspace
- **`atomcli setup`** - Install optional dependencies (Playwright for browser automation)

### Extensibility

- **MCP Support** - Extend capabilities with Model Context Protocol servers for memory, filesystem access, and custom tools
- **Skills System** - Add specialized behaviors and workflows from GitHub repositories or local files
- **Custom Agents** - Configure different agent personas for various development tasks

### Privacy and Control

- **Local Storage** - All data stored locally in `~/.atomcli/`
- **No Telemetry** - No data collection or analytics
- **Configurable** - Full control over providers, models, and behavior

---

## Installation

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex
```

<details>
<summary>See installation in action</summary>
<br>
<img src="docs/assets/Instalination.png" alt="Installation Process" width="600"/>
</details>

### Manual Installation

For development or custom setups:

```bash
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI && bun install
cd AtomBase && bun run build
cp dist/atomcli-linux-x64/bin/atomcli ~/.local/bin/
```

### Setup (Optional Dependencies)

Some AtomCLI features require additional dependencies:

```bash
atomcli setup                # Install optional dependencies (Playwright)
atomcli setup --check        # Check status without installing
```

The `setup` command installs **Playwright** for the browser automation tool, which enables:
- Web page navigation and interaction
- Screenshot capture
- JavaScript execution in browser context
- Console log monitoring

If Playwright is not installed, the browser tool will show a graceful error message with installation instructions.

### Updating

```bash
atomcli upgrade
```

AtomCLI automatically checks for updates on startup and notifies you when a new version is available.

For manual update:
```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash -s -- --update
```

### Uninstalling

```bash
atomcli --uninstall
```

---

## Usage

### Basic Commands

```bash
atomcli                      # Start interactive session
atomcli -c                   # Continue last session
atomcli -m anthropic/claude  # Start with specific model
atomcli --help               # Show all options
```

### Run Command (Non-Interactive)

Execute a single prompt without the TUI:

```bash
atomcli run "fix the bug in auth.ts"                    # Run with default model
atomcli run -m google/gemini-pro "explain this code"     # Use specific model
atomcli run --agent coder "add error handling"           # Use a specific agent
cat file.ts | atomcli run "review this code"             # Pipe input
atomcli run --json "list all functions"                  # JSON output mode
```

### Flow Command (Autonomous Dev Loop)

Run an autonomous agent that plans, executes, verifies, and iterates:

```bash
atomcli flow run ralph --loop "build a REST API for users"        # Autonomous loop
atomcli flow run ralph --loop "refactor the auth module"          # Multi-step tasks
atomcli flow run ralph --loop "add unit tests for utils.ts"       # Test generation
```

The flow command uses the **Ralph loop** — an autonomous development cycle:

1. **Planner** → Analyzes the task and generates execution steps
2. **Executor** → Executes each step using the AI agent (code, commands, etc.)
3. **Verifier** → Validates the work done
4. **Decision** → Determines if the step passed or needs retry

> **Note:** The flow command uses your default configured model. You can change it in `~/.config/atomcli/config.json` with the `"model"` field.

### Session Workflow

AtomCLI provides a conversational interface where you can:

1. Ask questions about your codebase
2. Request code changes or new features
3. Debug issues with AI assistance
4. Review and approve file modifications

<details>
<summary>See it in action</summary>
<br>
<img src="docs/assets/WorkUI.png" alt="AtomCLI Interface" width="600"/>

*Multi-panel layout with file tree, task list, and live coding*
</details>

### Keyboard Shortcuts

| Key      | Action                   |
| -------- | ------------------------ |
| `Tab`    | Switch agent             |
| `Ctrl+P` | Open command palette     |
| `Ctrl+C` | Cancel current operation |
| `Esc`    | Close dialogs            |

---

## MCP Servers

Model Context Protocol (MCP) servers extend AtomCLI with additional capabilities.

### Managing MCP Servers

```bash
atomcli mcp list             # List installed MCP servers
atomcli mcp add <name>       # Add a new MCP server
atomcli mcp remove <name>    # Remove an MCP server
```

### Common MCP Servers

- **memory-bank** - Persistent memory across sessions
- **filesystem** - Enhanced file system operations
- **sequential-thinking** - Step-by-step reasoning

### Adding via Chat

```
> Add memory-bank MCP
> Add filesystem MCP for /home/user/projects
```

---

## Skills

Skills are specialized instructions that modify agent behavior for specific tasks.


### Managing Skills

```bash
atomcli skill list           # List installed skills
atomcli skill add <url>      # Add skill from GitHub
atomcli skill remove <name>  # Remove a skill
```

### Adding via Chat

```
> Add this skill: https://github.com/********
> Find and add ralph skill from github
```

Skills are stored in `~/.atomcli/skills/` and can be enabled/disabled per session.

---

## Configuration

### Config Files

| File                            | Purpose                      |
| ------------------------------- | ---------------------------- |
| `~/.config/atomcli/config.json` | Global settings              |
| `~/.config/atomcli/mcp.json`    | MCP server configurations    |
| `~/.atomcli/`                   | Local data, sessions, skills |

### Example Configuration

```json
{
  "model": "anthropic/claude-sonnet-4",
  "autoupdate": "notify",
  "disabled_providers": ["openrouter"]
}
```

### Provider Configuration

Add API keys for providers:

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-..."
    },
    "openai": {
      "apiKey": "sk-..."
    }
  }
}
```

---

## Supported Platforms

| Platform | Architecture     | Status    |
| -------- | ---------------- | --------- |
| Linux    | x64              | Supported |
| Linux    | ARM64            | Supported |
| Linux    | x64 (musl)       | Supported |
| macOS    | x64              | Supported |
| macOS    | ARM64 (M1/M2/M3) | Supported |
| Windows  | x64 (via WSL)    | Supported |

---

## Architecture

AtomCLI is built with:

- **Bun** - JavaScript runtime and bundler
- **SolidJS** - Reactive UI framework for the TUI
- **OpenTUI** - Terminal UI rendering library
- **Vercel AI SDK** - Multi-provider AI integration
- **Hono** - Lightweight HTTP server for local API

### Project Structure

```
AtomCLI/
├── AtomBase/           # Main application source
│   ├── src/
│   │   ├── cli/        # CLI commands and TUI
│   │   ├── session/    # Session and message handling
│   │   ├── tool/       # AI tool implementations
│   │   ├── provider/   # AI provider integrations
│   │   └── config/     # Configuration management
│   └── dist/           # Compiled binaries
├── libs/sdk/           # JavaScript SDK
├── docs/               # Documentation
└── install.sh          # Installation script
```

---

## Development

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- Git

### Building from Source

```bash
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI
bun install
cd AtomBase
bun run dev    # Development mode
bun run build  # Production build
```

### Running Tests

```bash
bun test
```

For more details, see the [Development Guide](docs/DEVELOPMENT.md).

---

## Documentation

- [Development Guide](docs/DEVELOPMENT.md) - Build, test, contribute
- [Providers Guide](docs/PROVIDERS.md) - AI provider configuration and API keys
- [MCP Guide](docs/MCP-GUIDE.md) - MCP server installation and development
- [Skills Guide](docs/SKILLS-GUIDE.md) - Skill development and usage

---

## License

AtomCLI is released under the [MIT License](LICENSE).

---

<div align="center">

**[Star on GitHub](https://github.com/aToom13/AtomCLI)** | **[Report Bug](https://github.com/aToom13/AtomCLI/issues)** | **[Request Feature](https://github.com/aToom13/AtomCLI/issues)**

Made by [Atom13](https://github.com/aToom13)

</div>
