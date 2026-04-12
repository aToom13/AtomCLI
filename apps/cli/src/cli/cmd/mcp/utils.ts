import { MCP } from "../../../mcp"
import { McpConfigured, McpEntry, McpRemote } from "../../mcp"

export function getAuthStatusIcon(status: MCP.AuthStatus): string {
    switch (status) {
        case "authenticated":
            return "✓"
        case "expired":
            return "⚠"
        case "not_authenticated":
            return "○"
    }
}

export function getAuthStatusText(status: MCP.AuthStatus): string {
    switch (status) {
        case "authenticated":
            return "authenticated"
        case "expired":
            return "expired"
        case "not_authenticated":
            return "not authenticated"
    }
}

export function isMcpConfigured(config: McpEntry): config is McpConfigured {
    return (config as any).command !== undefined
}

export function isMcpRemote(config: McpEntry): config is McpRemote {
    return (config as any).type === "remote"
}

export const MCP_REGISTRY: Record<string, { package: string; description: string; defaultArgs?: string[] }> = {
    "filesystem": {
        package: "@modelcontextprotocol/server-filesystem",
        description: "File system access",
        defaultArgs: [process.cwd()],
    },
    "memory": {
        package: "@modelcontextprotocol/server-memory",
        description: "Persistent memory storage",
    },
    "brave-search": {
        package: "@anthropic-ai/mcp-server-brave-search",
        description: "Brave web search",
    },
    "github": {
        package: "@modelcontextprotocol/server-github",
        description: "GitHub API access",
    },
    "slack": {
        package: "@modelcontextprotocol/server-slack",
        description: "Slack integration",
    },
    "sequential-thinking": {
        package: "@modelcontextprotocol/server-sequential-thinking",
        description: "Step-by-step reasoning",
    },
}
