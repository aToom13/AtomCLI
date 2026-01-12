import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import { Global } from "../global"
import { Config } from "../config/config"
import { MCP } from "../mcp"

const parameters = z.object({
    name: z.string().describe("Name/identifier for the MCP server (e.g., 'filesystem', 'memory', 'github')"),
    command: z
        .array(z.string())
        .describe("Command array to start the MCP server (e.g., ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/path'])"),
    type: z.enum(["local", "remote"]).default("local").describe("Server type: 'local' for command-based, 'remote' for URL-based"),
    url: z.string().optional().describe("URL for remote MCP servers (required if type is 'remote')"),
    enabled: z.boolean().default(true).describe("Whether to enable the server immediately"),
})

// Well-known MCP servers registry
const MCP_REGISTRY: Record<string, { package: string; description: string; args?: string[] }> = {
    filesystem: {
        package: "@modelcontextprotocol/server-filesystem",
        description: "File system access",
    },
    memory: {
        package: "github:alioshr/memory-bank-mcp",
        description: "Persistent memory storage",
    },
    "sequential-thinking": {
        package: "@modelcontextprotocol/server-sequential-thinking",
        description: "Step-by-step reasoning",
    },
    github: {
        package: "@modelcontextprotocol/server-github",
        description: "GitHub API access",
    },
    postgres: {
        package: "@modelcontextprotocol/server-postgres",
        description: "PostgreSQL database access",
    },
    sqlite: {
        package: "@modelcontextprotocol/server-sqlite",
        description: "SQLite database access",
    },
    puppeteer: {
        package: "@modelcontextprotocol/server-puppeteer",
        description: "Browser automation",
    },
    brave: {
        package: "@anthropic/mcp-server-brave-search",
        description: "Brave search API",
    },
}

export const McpAddTool = Tool.define("mcpadd", {
    description: [
        "Add and configure a new MCP (Model Context Protocol) server.",
        "Use this when the user wants to add MCP capabilities.",
        "",
        "Well-known servers (just provide name):",
        ...Object.entries(MCP_REGISTRY).map(([name, info]) => `  - ${name}: ${info.description}`),
        "",
        "Or provide custom command for other servers.",
    ].join("\n"),
    parameters,
    async execute(params, ctx) {
        await ctx.ask({
            permission: "mcpadd",
            patterns: [params.name],
            always: ["*"],
            metadata: { name: params.name },
        })

        // Check if it's a well-known server
        const registry = MCP_REGISTRY[params.name.toLowerCase()]
        let command = params.command

        if (registry && (!command || command.length === 0)) {
            command = ["npx", "-y", registry.package, ...(registry.args || [])]
        }

        if (params.type === "local" && (!command || command.length === 0)) {
            throw new Error("Command is required for local MCP servers")
        }

        if (params.type === "remote" && !params.url) {
            throw new Error("URL is required for remote MCP servers")
        }

        // Read current config
        const configPath = path.join(Global.Path.home, ".atomcli", "atomcli.json")
        let config: any = {}

        try {
            const content = await fs.readFile(configPath, "utf-8")
            config = JSON.parse(content)
        } catch {
            // Config doesn't exist, create new
        }

        // Add MCP configuration
        if (!config.mcp) config.mcp = {}

        if (params.type === "local") {
            config.mcp[params.name] = {
                type: "local",
                command,
                enabled: params.enabled,
            }
        } else {
            config.mcp[params.name] = {
                type: "remote",
                url: params.url,
                enabled: params.enabled,
            }
        }

        // Write config
        await fs.mkdir(path.dirname(configPath), { recursive: true })
        await fs.writeFile(configPath, JSON.stringify(config, null, 2))

        // Try to connect if enabled
        let connectionStatus = "Not connected (restart AtomCLI to connect)"
        if (params.enabled) {
            try {
                await MCP.add(params.name, config.mcp[params.name])
                connectionStatus = "Connected successfully!"
            } catch (error) {
                connectionStatus = `Connection failed: ${error instanceof Error ? error.message : String(error)}`
            }
        }

        return {
            title: `Added MCP: ${params.name}`,
            output: [
                `✓ MCP server "${params.name}" configured!`,
                ``,
                `Type: ${params.type}`,
                params.type === "local" ? `Command: ${command?.join(" ")}` : `URL: ${params.url}`,
                `Enabled: ${params.enabled}`,
                `Status: ${connectionStatus}`,
                ``,
                `Config saved to: ~/.atomcli/atomcli.json`,
            ].join("\n"),
            metadata: {
                name: params.name,
                type: params.type,
                command,
                url: params.url,
                enabled: params.enabled,
            },
        }
    },
})
