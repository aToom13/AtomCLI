import { type Tool, dynamicTool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { type Tool as MCPToolDef, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create({ service: "mcp:tools" })

// Convert MCP tool definition to AI SDK Tool type
export async function convertMcpTool(mcpTool: MCPToolDef, client: Client): Promise<Tool> {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
        ...(inputSchema as JSONSchema7),
        type: "object",
        properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
        additionalProperties: false,
    }
    const config = await Config.get()

    return dynamicTool({
        description: mcpTool.description ?? "",
        inputSchema: jsonSchema(schema),
        execute: async (args: unknown) => {
            return client.callTool(
                {
                    name: mcpTool.name,
                    arguments: args as Record<string, unknown>,
                },
                CallToolResultSchema,
                {
                    resetTimeoutOnProgress: true,
                    timeout: config.experimental?.mcp_timeout,
                },
            )
        },
    })
}

type PromptInfo = Awaited<ReturnType<Client["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<Client["listResources"]>>["resources"][number]

// Helper function to fetch prompts for a specific client
export async function fetchPromptsForClient(clientName: string, client: Client) {
    const prompts = await client.listPrompts().catch((e) => {
        log.error("failed to get prompts", { clientName, error: e.message })
        return undefined
    })

    if (!prompts) {
        return
    }

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        const key = sanitizedClientName + ":" + sanitizedPromptName

        commands[key] = { ...prompt, client: clientName }
    }
    return commands
}

export async function fetchResourcesForClient(clientName: string, client: Client) {
    const resources = await client.listResources().catch((e) => {
        log.error("failed to get resources", { clientName, error: e.message })
        return undefined
    })

    if (!resources) {
        return
    }

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        const key = sanitizedClientName + ":" + sanitizedResourceName

        commands[key] = { ...resource, client: clientName }
    }
    return commands
}

export type { PromptInfo, ResourceInfo }
