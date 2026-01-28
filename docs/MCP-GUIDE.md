# MCP Server Guide

Model Context Protocol (MCP) servers extend AtomCLI with additional capabilities like persistent memory, file system access, and custom tools.

---

## Table of Contents

- [What is MCP?](#what-is-mcp)
- [Managing MCP Servers](#managing-mcp-servers)
- [Popular MCP Servers](#popular-mcp-servers)
- [Installation Examples](#installation-examples)
- [Configuration](#configuration)
- [Creating Custom MCP Servers](#creating-custom-mcp-servers)
- [Troubleshooting](#troubleshooting)

---

## What is MCP?

MCP (Model Context Protocol) is a standard for extending AI agents with:

- **Tools**: New capabilities the agent can use
- **Resources**: Data sources the agent can access
- **Prompts**: Predefined prompt templates

MCP servers run as separate processes and communicate with AtomCLI via stdio or HTTP.

---

## Managing MCP Servers

### List Installed Servers

```bash
atomcli mcp list
```

### Add a Server

```bash
atomcli mcp add <name>
```

Or via chat:
```
> Add memory-bank MCP
```

### Remove a Server

```bash
atomcli mcp remove <name>
```

### Install from URL

```bash
atomcli mcp install <npm-package-or-url>
```

---

## Popular MCP Servers

### Memory Bank

Persistent memory across sessions. Remembers project context, decisions, and user preferences.

**Install**:
```bash
atomcli mcp add memory-bank
```

**Features**:
- Stores context in `.memory/` directory
- Automatically loads on session start
- Tracks project-specific knowledge

**Repository**: [github.com/alioshr/memory-bank-mcp](https://github.com/alioshr/memory-bank-mcp)

---

### Filesystem

Enhanced file system operations beyond basic read/write.

**Install**:
```bash
atomcli mcp add filesystem
```

**Features**:
- Directory listing
- File watching
- Pattern-based operations

---

### Sequential Thinking

Step-by-step reasoning for complex problems.

**Install**:
```bash
atomcli mcp add sequential-thinking
```

**Features**:
- Breaks down complex tasks
- Chain-of-thought prompting
- Better reasoning for multi-step problems

**Repository**: [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)

---

### Browser Tools

Web browsing capabilities.

**Features**:
- Navigate to URLs
- Extract page content
- Take screenshots

---

### Git

Git operations and repository management.

**Features**:
- Commit, push, pull
- Branch management
- Diff viewing

---

### Database

SQL database access.

**Features**:
- Query execution
- Schema inspection
- Data manipulation

---

### Slack

Slack workspace integration.

**Features**:
- Send messages
- Read channels
- Create posts

---

## Installation Examples

### NPM Package

```bash
# Install from npm
atomcli mcp install @modelcontextprotocol/server-filesystem
```

### GitHub Repository

```bash
# Install from GitHub
atomcli mcp install github:username/mcp-server-name
```

### Local Script

```json
{
  "my-server": {
    "type": "local",
    "command": ["node", "/path/to/server.js"],
    "enabled": true
  }
}
```

### Via Chat

```
> Add the filesystem MCP server for /home/user/projects
> Install MCP from https://github.com/example/my-mcp
```

---

## Configuration

### Config File

MCP servers are configured in `~/.config/atomcli/mcp.json`:

```json
{
  "memory-bank": {
    "type": "local",
    "command": ["npx", "-y", "github:alioshr/memory-bank-mcp"],
    "enabled": true
  },
  "filesystem": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
    "enabled": true
  },
  "sequential-thinking": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
    "enabled": true
  }
}
```

### Server Types

| Type    | Description                  | Example        |
| ------- | ---------------------------- | -------------- |
| `local` | Runs as subprocess via stdio | Most common    |
| `sse`   | HTTP Server-Sent Events      | Remote servers |

### Server Options

```json
{
  "my-server": {
    "type": "local",
    "command": ["npx", "-y", "package-name"],
    "args": ["--option", "value"],
    "env": {
      "API_KEY": "secret"
    },
    "enabled": true
  }
}
```

### Enable/Disable Servers

Set `"enabled": false` to disable a server without removing it:

```json
{
  "server-name": {
    "type": "local",
    "command": ["..."],
    "enabled": false
  }
}
```

---

## Creating Custom MCP Servers

### Basic Structure

An MCP server needs to:
1. Listen on stdio (or HTTP for SSE)
2. Implement the MCP protocol
3. Expose tools, resources, or prompts

### TypeScript Example

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "my-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Define a tool
server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "my_tool",
      description: "Does something useful",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Input parameter" }
        },
        required: ["input"]
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler("tools/call", async (request) => {
  if (request.params.name === "my_tool") {
    const result = doSomething(request.params.arguments.input);
    return { content: [{ type: "text", text: result }] };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Python Example

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server

app = Server("my-server")

@app.tool("my_tool")
async def my_tool(input: str) -> str:
    """Does something useful"""
    return f"Processed: {input}"

async def main():
    async with stdio_server() as (read, write):
        await app.run(read, write)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

### Package Structure

```
my-mcp-server/
├── package.json
├── src/
│   └── index.ts
├── README.md
└── tsconfig.json
```

### package.json

```json
{
  "name": "my-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "my-mcp-server": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

### Testing Your Server

```bash
# Run directly
npx ts-node src/index.ts

# Test with AtomCLI
atomcli mcp add my-server --command "node /path/to/server.js"
```

---

## Troubleshooting

### Server Not Starting

```bash
# Check server status
atomcli /status

# View logs
atomcli --print-logs
```

### Common Issues

| Issue                    | Solution                        |
| ------------------------ | ------------------------------- |
| "Command not found"      | Ensure npx/node is in PATH      |
| "Connection refused"     | Check server is running         |
| "Permission denied"      | Check file permissions          |
| Server exits immediately | Check for errors in server code |

### Debug Mode

Run AtomCLI with logging:

```bash
atomcli --print-logs
```

### Manual Server Test

Test server independently:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","id":1}' | npx my-server
```

---

## Related Documentation

- [Development Guide](./DEVELOPMENT.md) - Technical documentation
- [Providers Guide](./PROVIDERS.md) - AI provider setup
- [Skills Guide](./SKILLS-GUIDE.md) - Custom agent behaviors
