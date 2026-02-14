import { Tool } from "./tool"
import z from "zod"
import { Question } from "../question"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Crypto } from "@/util/crypto"
import { spawn } from "bun"

export const SysadminTool = Tool.define("sysadmin", {
    description: "Perform system administration tasks like updating the system. Uses saved password from .sysadmin_pass if available, or asks interactively.",
    parameters: z.object({
        command: z.enum(["upgrade"]).describe("The operation to perform"),
    }),
    execute: async ({ command }, ctx) => {
        const log = Log.create({ service: "tool:sysadmin" })

        try {
            if (command === "upgrade") {
                // 1. Check for saved password
                const passFile = `${Global.Path.home}/.atomcli/.sysadmin_pass`
                let password = ""

                try {
                    const saved = await Bun.file(passFile).text()
                    if (saved.trim()) {
                        log.info("using saved sudo password")
                        // Decrypt password (handles both encrypted and legacy plaintext)
                        password = await Crypto.decrypt(saved.trim())
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
                            metadata: { exitCode: -1 as number | null },
                        }
                    }
                    password = answer
                }

                // 3. Execute update — pipe password via stdin to prevent command injection
                log.info("starting system upgrade")

                const proc = spawn(["sudo", "-S", "bash", "-c", "apt update && apt upgrade -y"], {
                    stdin: "pipe",
                    stdout: "pipe",
                    stderr: "pipe",
                })

                // Safely pipe password to sudo stdin (no shell interpolation)
                proc.stdin.write(password + "\n")
                proc.stdin.end()

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
                        metadata: { exitCode: proc.exitCode as number | null },
                    }
                }

                return {
                    title: "System Update",
                    output: `System update completed successfully:\n${output}`,
                    metadata: { exitCode: 0 as number | null },
                }
            }

            return {
                title: "System Update",
                output: "Unknown command",
                metadata: { exitCode: -1 as number | null },
            }
        } catch (e) {
            return {
                title: "System Update",
                output: `Error executing tool: ${e}`,
                metadata: { exitCode: -1 as number | null },
            }
        }
    },
})
