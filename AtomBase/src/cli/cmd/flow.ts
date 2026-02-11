import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { createAtomcliClient } from "@atomcli/sdk/v2"
import { Server } from "../../server/server"
import { createRalphFlow } from "../../flow/ralph"
import { FlowRunner } from "../../flow/runner"
import { FlowContext } from "../../flow/context"
import { EOL } from "os"

export const FlowCommand = cmd({
    command: "flow",
    describe: "manage and run agent flows",
    builder: (yargs) =>
        yargs
            .command(FlowRunCommand)
            .demandCommand(),
    async handler() { },
})

export const FlowRunCommand = cmd({
    command: "run [name]",
    describe: "run a flow",
    builder: (yargs) =>
        yargs
            .positional("name", {
                type: "string",
                describe: "flow name (or 'ralph' for auto-dev loop)",
            })
            .option("loop", {
                type: "string",
                describe: "Initial instruction for ralph loop",
            })
            .option("port", {
                type: "number",
                describe: "port for the local server",
            }),
    async handler(args) {
        const instruction = args.loop || "Analyze and improve the project"

        if (args.name !== "ralph" && !args.loop) {
            UI.error("Only 'ralph' flow is currently supported. Use: atomcli flow run ralph")
            process.exit(1)
        }

        UI.empty()
        prompts.intro("Agent Flow — Ralph Auto-Dev Loop")
        prompts.log.info(`Instruction: ${instruction}`)

        await bootstrap(process.cwd(), async () => {
            const server = Server.listen({ port: args.port ?? 0, hostname: "127.0.0.1" })
            const sdk = createAtomcliClient({ baseUrl: `http://${server.hostname}:${server.port}` })

            // Create a session for the flow
            const result = await sdk.session.create({
                title: `Flow: ${instruction.slice(0, 50)}${instruction.length > 50 ? "..." : ""}`,
            })
            const sessionID = result.data?.id

            if (!sessionID) {
                server.stop()
                UI.error("Failed to create session")
                process.exit(1)
            }

            prompts.log.info(`Session: ${sessionID}`)

            // Create the flow
            const flow = createRalphFlow(instruction)
            const context = new FlowContext()

            // Create runner with SDK connection
            const runner = new FlowRunner(flow, context, { sdk, sessionID })

            try {
                await runner.run()
                UI.println()
                prompts.outro("Flow Completed Successfully")
            } catch (e) {
                UI.println()
                prompts.log.error(String(e))
                prompts.outro("Flow Failed")
            } finally {
                server.stop()
            }
        })
    },
})
