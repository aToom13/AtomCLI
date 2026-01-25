import { Config } from "../../../config/config"
import { MCP } from "../../../mcp"

// Type aliases
export type McpEntry = NonNullable<Config.Info["mcp"]>[string]
export type McpConfigured = Config.Mcp
export type McpRemote = Extract<McpConfigured, { type: "remote" }>

// Type guards
export function isMcpConfigured(config: McpEntry): config is McpConfigured {
    return typeof config === "object" && config !== null && "type" in config
}

export function isMcpRemote(config: McpEntry): config is McpRemote {
    return isMcpConfigured(config) && config.type === "remote"
}

// Status helpers
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
