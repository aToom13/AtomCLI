import { cmd } from "../cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"

export const McpAddCommand = cmd({
    command: "add",
    describe: "add an MCP server",
    async handler() {
        UI.empty()
        prompts.intro("Add MCP server")

        const name = await prompts.text({
            message: "Enter MCP server name",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(name)) throw new UI.CancelledError()

        const type = await prompts.select({
            message: "Select MCP server type",
            options: [
                {
                    label: "Local",
                    value: "local",
                    hint: "Run a local command",
                },
                {
                    label: "Remote",
                    value: "remote",
                    hint: "Connect to a remote URL",
                },
            ],
        })
        if (prompts.isCancel(type)) throw new UI.CancelledError()

        if (type === "local") {
            const command = await prompts.text({
                message: "Enter command to run",
                placeholder: "e.g., atomcli x @modelcontextprotocol/server-filesystem",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(command)) throw new UI.CancelledError()

            prompts.log.info(`Local MCP server "${name}" configured with command: ${command}`)
            prompts.outro("MCP server added successfully")
            return
        }

        if (type === "remote") {
            const url = await prompts.text({
                message: "Enter MCP server URL",
                placeholder: "e.g., https://example.com/mcp",
                validate: (x) => {
                    if (!x) return "Required"
                    if (x.length === 0) return "Required"
                    const isValid = URL.canParse(x)
                    return isValid ? undefined : "Invalid URL"
                },
            })
            if (prompts.isCancel(url)) throw new UI.CancelledError()

            const useOAuth = await prompts.confirm({
                message: "Does this server require OAuth authentication?",
                initialValue: false,
            })
            if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()

            if (useOAuth) {
                const hasClientId = await prompts.confirm({
                    message: "Do you have a pre-registered client ID?",
                    initialValue: false,
                })
                if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()

                if (hasClientId) {
                    const clientId = await prompts.text({
                        message: "Enter client ID",
                        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
                    })
                    if (prompts.isCancel(clientId)) throw new UI.CancelledError()

                    const hasSecret = await prompts.confirm({
                        message: "Do you have a client secret?",
                        initialValue: false,
                    })
                    if (prompts.isCancel(hasSecret)) throw new UI.CancelledError()

                    let clientSecret: string | undefined
                    if (hasSecret) {
                        const secret = await prompts.password({
                            message: "Enter client secret",
                        })
                        if (prompts.isCancel(secret)) throw new UI.CancelledError()
                        clientSecret = secret
                    }

                    prompts.log.info(`Remote MCP server "${name}" configured with OAuth (client ID: ${clientId})`)
                    prompts.log.info("Add this to your mcp.json (in ~/.config/atomcli/mcp.json):")
                    prompts.log.info(`
  "${name}": {
    "type": "remote",
    "url": "${url}",
    "oauth": {
      "clientId": "${clientId}"${clientSecret ? `,\n        "clientSecret": "${clientSecret}"` : ""}
    }
  }`)
                } else {
                    prompts.log.info(`Remote MCP server "${name}" configured with OAuth (dynamic registration)`)
                    prompts.log.info("Add this to your mcp.json (in ~/.config/atomcli/mcp.json):")
                    prompts.log.info(`
  "${name}": {
    "type": "remote",
    "url": "${url}",
    "oauth": {}
  }`)
                }
            } else {
                const client = new Client({
                    name: "atomcli",
                    version: "1.0.0",
                })
                const transport = new StreamableHTTPClientTransport(new URL(url))
                await client.connect(transport)
                prompts.log.info(`Remote MCP server "${name}" configured with URL: ${url}`)
            }
        }

        prompts.outro("MCP server added successfully")
    },
})
