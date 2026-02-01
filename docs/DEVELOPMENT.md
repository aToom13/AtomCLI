# AtomCLI Developer Documentation

This is the central documentation hub for AtomCLI development. Use the navigation below to explore the codebase and understand the architecture.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Core Modules](#core-modules)
- [CLI Commands](#cli-commands)
- [Development Workflow](#development-workflow)
- [Configuration System](#configuration-system)
- [Provider Integration](#provider-integration)
- [Tool System](#tool-system)
- [MCP Integration](#mcp-integration)
- [Testing](#testing)
- [Security Guidelines](#security-guidelines)

---

## Project Structure

```
AtomCLI/
├── AtomBase/                    # Main application
│   ├── src/                     # Source code
│   │   ├── cli/                 # CLI and TUI implementation
│   │   ├── session/             # Session and message handling
│   │   ├── provider/            # AI provider integrations
│   │   ├── tool/                # AI tool implementations
│   │   ├── config/              # Configuration management
│   │   ├── mcp/                 # MCP server management
│   │   └── server/              # HTTP server and routes
│   ├── script/                  # Build and utility scripts
│   └── dist/                    # Compiled binaries
├── libs/                        # Shared libraries
│   ├── sdk/                     # JavaScript/TypeScript SDK
│   ├── util/                    # Utility functions
│   └── ui/                      # UI components
├── docs/                        # Documentation
└── install.sh                   # Installation script
```

### Key Directories

| Directory                | Description          | Link                                |
| ------------------------ | -------------------- | ----------------------------------- |
| `AtomBase/src/cli/`      | CLI commands and TUI | [Browse](../AtomBase/src/cli/)      |
| `AtomBase/src/session/`  | Session management   | [Browse](../AtomBase/src/session/)  |
| `AtomBase/src/provider/` | AI providers         | [Browse](../AtomBase/src/provider/) |
| `AtomBase/src/tool/`     | Agent tools          | [Browse](../AtomBase/src/tool/)     |
| `AtomBase/src/config/`   | Configuration        | [Browse](../AtomBase/src/config/)   |
| `AtomBase/src/mcp/`      | MCP servers          | [Browse](../AtomBase/src/mcp/)      |
| `libs/sdk/`              | SDK package          | [Browse](../libs/sdk/)              |

---

## Architecture Overview

AtomCLI is built on these core technologies:

| Component    | Technology                                    | Purpose                        |
| ------------ | --------------------------------------------- | ------------------------------ |
| Runtime      | [Bun](https://bun.sh/)                        | JavaScript runtime and bundler |
| UI Framework | [SolidJS](https://solidjs.com/)               | Reactive TUI rendering         |
| Terminal UI  | [OpenTUI](https://github.com/example/opentui) | Terminal rendering library     |
| AI SDK       | [Vercel AI SDK](https://sdk.vercel.ai/)       | Multi-provider AI integration  |
| HTTP Server  | [Hono](https://hono.dev/)                     | Lightweight API server         |
| CLI Parser   | [Yargs](https://yargs.js.org/)                | Command-line argument parsing  |

### Data Flow

```
User Input
    │
    ▼
┌─────────────────┐
│   CLI / TUI     │  ← src/cli/cmd/tui/
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Session      │  ← src/session/
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Provider     │  ← src/provider/
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   AI Response   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Tool Calls    │  ← src/tool/
└─────────────────┘
```

---

## Core Modules

### CLI and TUI

The terminal interface is implemented in `AtomBase/src/cli/`:

| File                                                   | Description                                |
| ------------------------------------------------------ | ------------------------------------------ |
| [index.ts](../AtomBase/src/index.ts)                   | Main entry point, CLI command registration |
| [tui/app.tsx](../AtomBase/src/cli/cmd/tui/app.tsx)     | Main TUI application component             |
| [tui/thread.ts](../AtomBase/src/cli/cmd/tui/thread.ts) | TUI thread and worker management           |
| [tui/worker.ts](../AtomBase/src/cli/cmd/tui/worker.ts) | Background worker for session handling     |

### Session Management

Sessions handle conversations and message processing:

| File                                                           | Description                           |
| -------------------------------------------------------------- | ------------------------------------- |
| [session/index.ts](../AtomBase/src/session/index.ts)           | Session API and types                 |
| [session/message-v2.ts](../AtomBase/src/session/message-v2.ts) | Message handling and error processing |
| [session/retry.ts](../AtomBase/src/session/retry.ts)           | Retry logic for API calls             |

### Provider System

AI provider integrations in `AtomBase/src/provider/`:

| Provider   | File                                                    | Status       |
| ---------- | ------------------------------------------------------- | ------------ |
| Anthropic  | [anthropic.ts](../AtomBase/src/provider/anthropic.ts)   | Supported    |
| OpenAI     | [openai.ts](../AtomBase/src/provider/openai.ts)         | Supported    |
| Google     | [google.ts](../AtomBase/src/provider/google.ts)         | Supported    |
| Ollama     | [ollama.ts](../AtomBase/src/provider/ollama.ts)         | Supported    |
| OpenRouter | [openrouter.ts](../AtomBase/src/provider/openrouter.ts) | Supported    |
| MiniMax    | [minimax.ts](../AtomBase/src/provider/minimax.ts)       | Free tier    |
| GLM        | [glm.ts](../AtomBase/src/provider/glm.ts)               | Free tier    |
| Kilocode   | [kilocode.ts](../AtomBase/src/provider/kilocode.ts)     | v2.1.2+      |
| Fallback   | [fallback.ts](../AtomBase/src/provider/fallback.ts)     | v2.1.2+      |

### Tool System

Agent tools in `AtomBase/src/tool/`:

| Tool    | File                                          | Description           |
| ------- | --------------------------------------------- | --------------------- |
| Read    | [read.ts](../AtomBase/src/tool/read.ts)       | File reading          |
| Write   | [write.ts](../AtomBase/src/tool/write.ts)     | File writing          |
| Edit    | [edit.ts](../AtomBase/src/tool/edit.ts)       | Code editing          |
| Glob    | [glob.ts](../AtomBase/src/tool/glob.ts)       | File pattern matching |
| Grep    | [grep.ts](../AtomBase/src/tool/grep.ts)       | Content search        |
| Bash    | [bash.ts](../AtomBase/src/tool/bash.ts)       | Command execution     |
| Browser | [browser.ts](../AtomBase/src/tool/browser.ts) | Web browsing          |

### New Tools (v2.1.2+)

| Tool       | File                                                | Description                    |
| ---------- | --------------------------------------------------- | ------------------------------ |
| TestGen    | [test-gen.ts](../AtomBase/src/tool/test-gen.ts)     | Automatic test generation      |
| Docs       | [docs.ts](../AtomBase/src/tool/docs.ts)             | Documentation generation       |
| Refactor   | [refactor.ts](../AtomBase/src/tool/refactor.ts)     | Code smell detection & fixes   |
| Review     | [review.ts](../AtomBase/src/tool/review.ts)         | Code review & analysis         |
| Finance    | [finance.ts](../AtomBase/src/tool/finance.ts)       | Financial market analysis      |
| CodeSearch | [codesearch.ts](../AtomBase/src/tool/codesearch.ts) | AI code search                 |
| WebSearch  | [websearch.ts](../AtomBase/src/tool/websearch.ts)   | Web search with Exa AI         |

---

## CLI Commands

### Main Commands

| Command           | Description              | Source                                                 |
| ----------------- | ------------------------ | ------------------------------------------------------ |
| `atomcli`         | Start interactive TUI    | [tui/thread.ts](../AtomBase/src/cli/cmd/tui/thread.ts) |
| `atomcli run`     | Run single prompt        | [run.ts](../AtomBase/src/cli/cmd/run.ts)               |
| `atomcli upgrade` | Update to latest version | [upgrade.ts](../AtomBase/src/cli/cmd/upgrade.ts)       |

### MCP Commands

| Command               | Description          | Source                                                   |
| --------------------- | -------------------- | -------------------------------------------------------- |
| `atomcli mcp list`    | List MCP servers     | [mcp/list.ts](../AtomBase/src/cli/cmd/mcp/list.ts)       |
| `atomcli mcp add`     | Add MCP server       | [mcp/add.ts](../AtomBase/src/cli/cmd/mcp/add.ts)         |
| `atomcli mcp remove`  | Remove MCP server    | [mcp/remove.ts](../AtomBase/src/cli/cmd/mcp/remove.ts)   |
| `atomcli mcp install` | Install MCP from URL | [mcp/install.ts](../AtomBase/src/cli/cmd/mcp/install.ts) |

### Skill Commands

| Command                | Description           | Source                                       |
| ---------------------- | --------------------- | -------------------------------------------- |
| `atomcli skill list`   | List installed skills | [skill.ts](../AtomBase/src/cli/cmd/skill.ts) |
| `atomcli skill add`    | Add skill from URL    | [skill.ts](../AtomBase/src/cli/cmd/skill.ts) |
| `atomcli skill remove` | Remove skill          | [skill.ts](../AtomBase/src/cli/cmd/skill.ts) |

### Developer Tools (v2.1.2+)

| Command                      | Description                      | Source                                                          |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `atomcli test-gen`           | Generate unit tests              | [test-gen.ts](../AtomBase/src/cli/cmd/test-gen.ts)              |
| `atomcli docs`               | Generate documentation           | [docs.ts](../AtomBase/src/cli/cmd/docs.ts)                      |
| `atomcli security`           | Security vulnerability scan      | [security.ts](../AtomBase/src/cli/cmd/security.ts)              |
| `atomcli perf`               | Performance analysis             | [perf.ts](../AtomBase/src/cli/cmd/perf.ts)                      |
| `atomcli refactor`           | Code refactoring assistant       | [refactor.ts](../AtomBase/src/cli/cmd/refactor.ts)              |
| `atomcli review`             | Code review for PRs              | [review.ts](../AtomBase/src/cli/cmd/review.ts)                  |
| `atomcli workspace`          | Multi-project workspace manager  | [workspace.ts](../AtomBase/src/cli/cmd/workspace.ts)            |

---

## Advanced Features (v2.1.2+)

### Streaming Interrupt System

AtomCLI supports non-blocking user input during AI streaming:

- **Amendment Queue**: Send additional instructions while AI is writing
- **Shift+Enter**: Add amendment to queue
- **Enter**: Force interrupt current stream
- **Implementation**: [session/amendment.ts](../AtomBase/src/session/amendment.ts)

```typescript
// Usage in TUI
// While AI is streaming, press:
// - Shift+Enter to add amendment
// - Enter to interrupt
```

### Model Fallback System

Automatic failover when primary AI provider fails:

- **Fallback Chain**: Primary → Secondary → Tertiary models
- **Error Detection**: Automatic detection of rate limits, timeouts, service errors
- **Seamless Switching**: Continue conversation without interruption
- **Cost Tracking**: Track costs across different providers
- **Implementation**: [provider/fallback.ts](../AtomBase/src/provider/fallback.ts)

```typescript
// Configuration example
{
  "model": "anthropic/claude-sonnet-4",
  "fallback": {
    "secondary": "openai/gpt-4o",
    "tertiary": "google/gemini-pro"
  }
}
```

### Self-Learning System

AtomCLI learns from errors and successful patterns:

- **Error Analysis**: Automatically analyze and categorize errors
- **Pattern Storage**: Store successful solutions for reuse
- **Memory Persistence**: JSON-based storage in `~/.atomcli/learning/`
- **Research Integration**: Web research for unknown errors
- **Implementation**: [learning/](../AtomBase/src/learning/)

| Component | File | Description |
| --------- | ---- | ----------- |
| Memory | [memory.ts](../AtomBase/src/learning/memory.ts) | Persistent storage |
| Research | [research.ts](../AtomBase/src/learning/research.ts) | Web research integration |
| Error Analyzer | [error-analyzer.ts](../AtomBase/src/learning/error-analyzer.ts) | Error pattern analysis |
| Integration | [integration.ts](../AtomBase/src/learning/integration.ts) | Session integration |

---

## Development Workflow

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Git](https://git-scm.com/)
- Node.js 18+ (for some dependencies)

### Setup

```bash
# Clone repository
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI

# Install dependencies
bun install

# Navigate to main package
cd AtomBase
```

### Development Mode

```bash
# Run in development mode (hot reload)
bun run dev

# With debug logging
bun run dev --print-logs
```

### Building

```bash
# Build all platforms
bun run build

# Output in dist/ directory:
# - atomcli-linux-x64/
# - atomcli-linux-arm64/
# - atomcli-darwin-x64/
# - atomcli-darwin-arm64/
# - atomcli-windows-x64/
```

### Installing Local Build

```bash
# Copy to local bin
cp dist/atomcli-linux-x64/bin/atomcli ~/.local/bin/

# Or use symlink for development
ln -sf $(pwd)/dist/atomcli-linux-x64/bin/atomcli ~/.local/bin/atomcli
```

---

## Configuration System

Configuration is managed in `AtomBase/src/config/config.ts`:

### Config Locations

| File                            | Purpose                | Schema                                        |
| ------------------------------- | ---------------------- | --------------------------------------------- |
| `~/.config/atomcli/config.json` | Global settings        | [config.ts](../AtomBase/src/config/config.ts) |
| `~/.config/atomcli/mcp.json`    | MCP server configs     | Flat MCP format                               |
| `.atomcli/atomcli.json`         | Project-level settings | Same as global                                |

### Key Configuration Options

```typescript
interface Config {
  model?: string              // Default model (provider/model)
  autoupdate?: boolean | "notify"  // Update behavior
  disabled_providers?: string[]    // Providers to disable
  enabled_providers?: string[]     // Providers to enable (exclusive)
}
```

---

## Provider Integration

Adding a new provider:

1. Create file in `AtomBase/src/provider/`:

```typescript
// my-provider.ts
import { Provider } from "./index"

export namespace MyProvider {
  export const Info: Provider.Info = {
    id: "my-provider",
    name: "My Provider",
    models: [...],
  }
  
  export async function* models(info: Provider.Context) {
    yield* info.provider.defaultModels().values()
  }
  
  export function create(ctx: Provider.Context) {
    return createOpenAI({
      baseURL: "https://api.myprovider.com/v1",
      apiKey: ctx.apiKey,
    })
  }
}
```

2. Register in `AtomBase/src/provider/index.ts`

3. Add to provider list in exports

---

## Tool System

Tools are defined in `AtomBase/src/tool/` and registered via the agent's tool configuration.

### Tool Structure

```typescript
export const MyTool = Tool.define({
  name: "my_tool",
  description: "Tool description",
  parameters: z.object({
    param: z.string().describe("Parameter description"),
  }),
  async execute(ctx, params) {
    // Implementation
    return { result: "..." }
  },
})
```

### Tool Context

Tools receive a context with:
- `cwd` - Current working directory
- `session` - Active session
- `permissions` - Permission state

---

## MCP Integration

MCP (Model Context Protocol) servers extend agent capabilities.

### MCP Architecture

```
AtomCLI
    │
    ▼
┌─────────────────┐
│   MCP Manager   │  ← src/mcp/index.ts
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│Server1│ │Server2│  (stdio/SSE)
└───────┘ └───────┘
```

### Key Files

| File                                           | Description               |
| ---------------------------------------------- | ------------------------- |
| [mcp/index.ts](../AtomBase/src/mcp/index.ts)   | MCP server management     |
| [mcp/client.ts](../AtomBase/src/mcp/client.ts) | MCP client implementation |

---

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/tool/read.test.ts

# Watch mode
bun test --watch
```

---

## Security Guidelines

### File System Access

- Agent has read/write/delete access within workspace
- Always review implementation plans before approving changes
- Use `--cwd` to limit workspace scope

### Command Execution

- Commands run via subprocess in local shell
- No isolated sandbox by default
- Safe command list in permission system

### API Keys

- Stored in user config (`~/.config/atomcli/`)
- Never committed to repository
- Use environment variables for CI/CD

---

## Related Documentation

- [Main README](../README.md) - Project overview
- [Providers Guide](./PROVIDERS.md) - AI provider configuration and API keys
- [MCP Guide](./MCP-GUIDE.md) - MCP server installation and development
- [Skills Guide](./SKILLS-GUIDE.md) - Skill development and usage
- [Memory Integration](./MEMORY-INTEGRATION.md) - Semantic memory system
- [AtomBase README](../AtomBase/README.md) - Core package docs
- [SDK README](../libs/sdk/README.md) - SDK documentation
- [Libs README](../libs/README.md) - Shared libraries

---
