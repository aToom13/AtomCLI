import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { createRalphFlow } from "../../flow/ralph"
import { FlowRunner } from "../../flow/runner"
// import { Session } from "../../session"
import { FlowContext } from "../../flow/context"

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
            }),
    async handler(args) {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("Agent Flow")

                let flow
                const context = new FlowContext()

                if (args.name === "ralph" || args.loop) {
                    const instruction = args.loop || "Analyze and improve the project"
                    flow = createRalphFlow(instruction)
                    context.addStep("Initial Analysis", instruction)
                } else {
                    prompts.log.error("Only 'ralph' flow is currently supported.")
                    return
                }

                prompts.log.info(`Starting Flow: ${flow.name}`)

                // Create a dummy session for now, or hook into real one
                // In real app we would use Session.create()
                const session = {}

                const runner = new FlowRunner(flow, session, context)

                try {
                    await runner.run()
                    prompts.outro("Flow Completed Successfully")
                } catch (e) {
                    prompts.log.error(String(e))
                    prompts.outro("Flow Failed")
                }
            },
        })
    },
})
