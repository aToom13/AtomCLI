# AtomCLI Development Guide

This guide covers everything you need to develop and contribute to AtomCLI.

## 📋 Prerequisites

- [Bun](https://bun.sh) v1.1.0+
- [Node.js](https://nodejs.org) v18+ (for MCP servers)
- [Git](https://git-scm.com)

## 🚀 Quick Start

```bash
# Clone repository
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI

# Install dependencies
bun install

# Build
cd AtomBase && bun run build

# Run locally (without installing)
./dist/atomcli-linux-x64/bin/atomcli
```

## 🏗️ Project Architecture

```
AtomCLI/
├── AtomBase/                 # Core application
│   ├── src/
│   │   ├── agent/            # AI agent logic
│   │   ├── cli/              # Command line interface
│   │   ├── config/           # Configuration management
│   │   ├── mcp/              # Model Context Protocol
│   │   ├── provider/         # LLM providers (OpenAI, Anthropic, etc.)
│   │   ├── session/          # Chat session management
│   │   ├── skill/            # Skills system
│   │   ├── tool/             # Built-in tools
│   │   │   ├── finance/      # Finance analysis tool
│   │   │   ├── bash/         # Shell command tool
│   │   │   ├── read/         # File reading tool
│   │   │   └── ...
│   │   └── tui/              # Terminal UI components
│   ├── test/                 # Test files
│   └── script/               # Build scripts
│
├── libs/                     # Shared libraries
│   ├── sdk/                  # SDK for extensions
│   ├── ui/                   # UI components
│   └── util/                 # Utilities
│
├── install.sh                # Installation script
└── README.md
```

## 🔧 Build Commands

```bash
cd AtomBase

# Development build (current platform only)
bun run build --single

# Full build (all platforms)
bun run build

# Run tests
bun test

# Run specific test file
bun test test/tool/finance.test.ts

# Type check
bun run typecheck
```

## 🧪 Testing

Tests use [Bun's test runner](https://bun.sh/docs/test/writing):

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test pattern
bun test --test-name-pattern "finance"

# Watch mode
bun test --watch
```

**Test Structure:**
```
test/
├── tool/           # Tool-specific tests
│   ├── finance.test.ts
│   ├── bash.test.ts
│   └── grep.test.ts
├── session/        # Session tests
├── provider/       # Provider tests
└── config/         # Config tests
```

## 🔌 Adding a New Tool

1. Create tool file in `src/tool/yourtool/index.ts`:

```typescript
import { Tool } from "../tool"
import { z } from "zod"

export const YourTool = Tool.define("your_tool", {
    description: "What this tool does",
    parameters: z.object({
        param1: z.string().describe("Parameter description"),
    }),

    async execute(params, ctx) {
        // Implementation
        return {
            title: "Tool Result",
            metadata: {},
            output: "Result text"
        }
    }
})
```

2. Register in `src/tool/registry.ts`:

```typescript
import { YourTool } from "./yourtool"

export const tools = [
    // ...existing tools
    YourTool,
]
```

3. Add tests in `test/tool/yourtool.test.ts`

## 🤖 Adding a New Provider

Providers are in `src/provider/`. See existing implementations:
- `openai/` - OpenAI API
- `anthropic/` - Anthropic API
- `google/` - Google AI
- `antigravity/` - Free models via OAuth

## 📁 Key Files

| File                       | Purpose               |
| -------------------------- | --------------------- |
| `src/agent/agent.ts`       | Main agent loop       |
| `src/provider/provider.ts` | Provider management   |
| `src/tool/tool.ts`         | Tool base class       |
| `src/session/session.ts`   | Chat session handling |
| `src/config/config.ts`     | Configuration loading |
| `src/tui/app.tsx`          | Main TUI component    |

## 🐛 Debugging

```bash
# Enable debug logs
DEBUG=* atomcli

# Specific module logs
DEBUG=finance:* atomcli
DEBUG=provider:* atomcli
```

## 📝 Code Style

- TypeScript with strict mode
- Functional approach preferred
- Use Zod for validation
- Keep functions small and focused

## 🔄 Pull Request Process

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes and add tests
4. Run tests: `bun test`
5. Commit: `git commit -m "feat: add my feature"`
6. Push and create PR

**Commit Convention:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Tests
- `chore:` Maintenance

## 📞 Support

- [GitHub Issues](https://github.com/aToom13/AtomCLI/issues)
- [Discussions](https://github.com/aToom13/AtomCLI/discussions)
