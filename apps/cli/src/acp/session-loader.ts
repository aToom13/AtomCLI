import type { AgentSideConnection, LoadSessionRequest } from "@agentclientprotocol/sdk"
import type { AtomcliClient } from "@atomcli/sdk/v2"
import { Provider } from "../provider/provider"
import { Agent as AgentModule } from "../agent/agent"
import { Config } from "@/config/config"
import { Log } from "../util/log"
import { defaultModel } from "./utils"
import type { ACPConfig } from "./types"

const log = Log.create({ service: "acp-session-loader" })

export async function loadSessionMode(
    params: LoadSessionRequest,
    config: ACPConfig,
    sdk: AtomcliClient,
    connection: AgentSideConnection,
) {
    const directory = params.cwd
    const model = await defaultModel(config, directory)
    const sessionId = params.sessionId

    const providers = await sdk.config.providers({ directory }).then((x) => x.data!.providers)
    const entries = providers.sort((a, b) => {
        const nameA = a.name.toLowerCase()
        const nameB = b.name.toLowerCase()
        if (nameA < nameB) return -1
        if (nameA > nameB) return 1
        return 0
    })
    const availableModels = entries.flatMap((provider) => {
        const models = Provider.sort(Object.values(provider.models))
        return models.map((model) => ({
            modelId: `${provider.id}/${model.id}`,
            name: `${provider.name}/${model.name}`,
        }))
    })

    const agents = await config.sdk.app
        .agents(
            {
                directory,
            },
            { throwOnError: true },
        )
        .then((resp) => resp.data!)

    const commands = await config.sdk.command
        .list(
            {
                directory,
            },
            { throwOnError: true },
        )
        .then((resp) => resp.data!)

    const availableCommands = commands.map((command) => ({
        name: command.name,
        description: command.description ?? "",
    }))
    const names = new Set(availableCommands.map((c) => c.name))
    if (!names.has("compact"))
        availableCommands.push({
            name: "compact",
            description: "compact the session",
        })

    const availableModes = agents
        .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
        .map((agent) => ({
            id: agent.name,
            name: agent.name,
            description: agent.description,
        }))

    const defaultAgentName = await AgentModule.defaultAgent()
    const currentModeId = availableModes.find((m) => m.name === defaultAgentName)?.id ?? availableModes[0].id

    const mcpServers: Record<string, Config.Mcp> = {}
    for (const server of params.mcpServers) {
        if ("type" in server) {
            mcpServers[server.name] = {
                url: server.url,
                headers: server.headers.reduce<Record<string, string>>((acc, { name, value }) => {
                    acc[name] = value
                    return acc
                }, {}),
                type: "remote",
            }
        } else {
            mcpServers[server.name] = {
                type: "local",
                command: [server.command, ...server.args],
                environment: server.env.reduce<Record<string, string>>((acc, { name, value }) => {
                    acc[name] = value
                    return acc
                }, {}),
            }
        }
    }

    await Promise.all(
        Object.entries(mcpServers).map(async ([key, mcp]) => {
            await sdk.mcp
                .add(
                    {
                        directory,
                        name: key,
                        config: mcp,
                    },
                    { throwOnError: true },
                )
                .catch((error) => {
                    log.error("failed to add mcp server", { name: key, error })
                })
        }),
    )

    setTimeout(() => {
        connection.sessionUpdate({
            sessionId,
            update: {
                sessionUpdate: "available_commands_update",
                availableCommands,
            },
        })
    }, 0)

    return {
        sessionId,
        models: {
            currentModelId: `${model.providerID}/${model.modelID}`,
            availableModels,
        },
        modes: {
            availableModes,
            currentModeId,
        },
        _meta: {},
    }
}
