import { Tool } from "./tool"
import z from "zod"
import { Question } from "../question"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { spawn } from "bun"

export const SysadminTool = Tool.define("sysadmin", {
    description: "Perform system administration tasks like updating the system. Uses saved password from .sysadmin_pass if available, or asks interactively.",
    parameters: z.object({
        command: z.enum(["upgrade"]).describe("The operation to perform"),
    }),
    execute: async ({ command }, ctx) => {
        try {
            const log = Log.create({ service: "tool:sysadmin" })

            if (command === "upgrade") {
                // ... (keep existing logic) ...
                // I need to copy the whole body or use a smaller replacement.
                // Coping content from previous step but wrapped.
                // Actually, replace_file_content is partial. I can start at line 14.

                // 1. Check for saved password
                const passFile = `${Global.Path.home}/.atomcli/.sysadmin_pass`
                let password = ""

                try {
                    const saved = await Bun.file(passFile).text()
                    if (saved.trim()) {
                        log.info("using saved sudo password")
                        password = saved.trim()
                    }
                } catch (e) {
                    // ignore missing file
                }

                // 2. Ask interactively if needed
                if (!password) {
                    const response = await Question.ask({
                        sessionID: ctx.agent ?? "sysadmin",
                        questions: [{
                            header: "Sudo",
                            question: "Sudo password required for system update",
                            type: "password",
                            placeholder: "Enter sudo password"
                        }]
                    })

                    const answer = response[0]?.[0]
                    if (!answer) {
                        return {
                            title: "System Update",
                            output: "Operation cancelled: No password provided.",
                            metadata: {}
                        }
                    }
                    password = answer
                }

                // 3. Execute update
                log.info("starting system upgrade")

                const cmd = `echo "${password}" | sudo -S apt update && echo "${password}" | sudo -S apt upgrade -y`

                const proc = spawn(["bash", "-c", cmd], {
                    stdout: "pipe",
                    stderr: "pipe"
                })

                const output = await new Response(proc.stdout).text()
                const error = await new Response(proc.stderr).text()

                await proc.exited

                if (proc.exitCode !== 0) {
                    let msg = `Update failed (Exit code: ${proc.exitCode}):\n${error}\n${output}`
                    if (error.includes("incorrect password")) {
                        msg = `Failed: Incorrect sudo password. (Exit code: ${proc.exitCode})\n${error}`
                    }
                    return {
                        title: "System Update",
                        output: msg,
                        metadata: { exitCode: proc.exitCode }
                    }
                }

                return {
                    title: "System Update",
                    output: `System update completed successfully:\n${output}`,
                    metadata: { exitCode: 0 }
                }
            }

            return {
                title: "System Update",
                output: "Unknown command",
                metadata: {}
            }
        } catch (e) {
            return {
                title: "System Update",
                output: `Error executing tool: ${e}`,
                metadata: { error: String(e) }
            }
        }
    },
})
