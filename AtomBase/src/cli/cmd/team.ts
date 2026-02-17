import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import path from "path"
import { Server } from "../../server/server"
import { Session } from "../../session"
import { Instance } from "../../project/instance"
import { upgrade } from "../upgrade"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

export const TeamCommand = cmd({
    command: "team [task..]",
    describe: "start an Agent Teams session with collaborative agents",
    builder: (yargs: Argv) => {
        return withNetworkOptions(yargs)
            .positional("task", {
                describe: "the task for the agent team to work on",
                type: "string",
                array: true,
                default: [],
            })
            .option("model", {
                type: "string",
                alias: ["m"],
                describe: "model to use in the format of provider/model",
            })
    },
    handler: async (args) => {
        const task = [...args.task, ...(args["--"] || [])]
            .map((arg) => (typeof arg === "string" && arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
            .join(" ")

        if (task.trim().length === 0) {
            UI.error("You must provide a task for the team")
            process.exit(1)
        }

        await bootstrap(process.cwd(), async () => {
            // Same pattern as spawn.ts: start server, spawn TUI
            upgrade()
            const opts = await resolveNetworkOptions(args)
            const server = Server.listen(opts)

            const bin = process.execPath
            const cmd: string[] = []
            let cwd = process.cwd()
            if (bin.endsWith("bun")) {
                cmd.push(
                    process.execPath,
                    "run",
                    "--conditions",
                    "browser",
                    new URL("../../index.ts", import.meta.url).pathname,
                )
                cwd = new URL("../../../", import.meta.url).pathname
            } else cmd.push(process.execPath)
            cmd.push("attach", server.url.toString(), "--dir", process.cwd())

            // Activate team mode on the session after server starts
            // The server needs a moment to bootstrap
            await new Promise((r) => setTimeout(r, 500))

            // Create session with team metadata
            try {
                const session = await Session.create({
                    title: `🤖 Team: ${task.slice(0, 50)}${task.length > 50 ? "..." : ""}`,
                })
                await Session.update(session.id, (draft) => {
                    draft.metadata = {
                        ...draft.metadata,
                        team: {
                            active: true,
                            task,
                            activatedAt: Date.now(),
                        },
                    }
                })
                // Pass session ID to the TUI so it opens directly
                cmd.push("--session", session.id)
            } catch (e) {
                // Log error if session creation fails
                UI.error(`Failed to create team session: ${e instanceof Error ? e.message : String(e)}`)
            }

            const proc = Bun.spawn({
                cmd,
                cwd,
                stdout: "inherit",
                stderr: "inherit",
                stdin: "inherit",
                env: {
                    ...process.env,
                    BUN_OPTIONS: "",
                },
            })
            await proc.exited
            await Instance.disposeAll()
            await server.stop(true)
        })
    },
})
