# AtomCLI - Documentation Summary

## Overview

**AtomCLI** is an autonomous AI coding agent framework built with TypeScript and Bun runtime. Version: 3.2.4-EarlyBeta

## Architecture

### Core Modules

| Module        | Purpose                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `agent`       | Core agent logic - chain execution, prompt management                    |
| `orchestrate` | Multi-agent task delegation and sub-agent session management             |
| `session`     | LLM calls, message handling, retry logic, summarization                  |
| `provider`    | 20+ LLM provider integrations (OpenAI, Anthropic, Google, Ollama, Azure) |
| `command`     | CLI command handling                                                     |
| `config`      | Configuration management with markdown support                           |
| `browser`     | Playwright-based browser automation                                      |
| `file`        | File operations - ripgrep, watching, ignore patterns                     |
| `skill`       | Extensible skill system                                                  |
| `storage`     | Persistent storage layer                                                 |
| `companion`   | Mobile pairing, QR discovery, WebSocket bridge, push notifications       |

### Entry Point

`src/shim.ts` - Main entry point

## Key Features

- **Multi-Provider LLM Support** - Integrates with 20+ providers via `@ai-sdk/*`
- **Multi-Agent Collaboration** - Event-driven team workflows
- **Mobile Companion App** - Remote session monitoring, permission approval, and chat via Flutter app
- **Session-Based Context** - Conversation management with summarization
- **Browser Automation** - Built-in Playwright support
- **File Watching** - Parcel watcher for cross-platform monitoring
- **i18n Support** - English and Turkish locales

## Tech Stack

- **Runtime**: Bun 1.3
- **UI**: @opentui/core, SolidJS
- **API Server**: Hono
- **MCP**: @modelcontextprotocol/sdk
- **Mobile**: Flutter (companion app)
- **Web Dashboard**: SolidJS + Vite + Nitro (enterprise)

## Usage

```bash
# Install
bun install

# Run
bun run --conditions=browser ./src/index.ts

# Typecheck
bun run typecheck

# Test
bun test
```
