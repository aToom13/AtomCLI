import z from "zod"
import { Tool } from "./tool"
import { Log } from "@/util/util/log"
import path from "path"
import { $ } from "bun"

const DESCRIPTION = `Self-maintenance tool for AtomCLI.

Allows the agent to rebuild and restart itself after code modifications.

**ACTIONS:**
- "build": Compile the project using bun run script/build.ts
- "restart": Restart the running process with the latest build
- "build_and_restart": Build first, then restart

**CAUTION:** This tool requires explicit user permission before each use.
These operations affect the running process and should be used carefully.`

export const SelfMaintenanceTool = Tool.define("self_maintenance", {
    description: DESCRIPTION,
    parameters: z.object({
        action: z.enum(["build", "restart", "build_and_restart"]).describe("The maintenance action to perform"),
    }),
    async execute(params, ctx): Promise<any> {
        const log = Log.create({ service: "self-maintenance" })

        // Always require explicit permission — no exceptions
        await ctx.ask({
            permission: "self_maintenance",
            patterns: [params.action],
            metadata: { action: params.action },
            always: [], // Never allow "always" for this tool
        })

        // Resolve project root (3 levels up from src/tool/)
        const projectRoot = path.resolve(import.meta.dir, "../../..")

        switch (params.action) {
            case "build": {
                return await runBuild(log, projectRoot)
            }

            case "restart": {
                return await runRestart(log)
            }

            case "build_and_restart": {
                const buildResult = await runBuild(log, projectRoot)
                if (buildResult.metadata.error) {
                    return buildResult // Don't restart if build failed
                }
                return await runRestart(log)
            }
        }
    },
})

async function runBuild(log: ReturnType<typeof Log.create>, projectRoot: string) {
    try {
        log.info("starting build", { projectRoot })

        const result = await $`bun run script/build.ts`
            .cwd(projectRoot)
            .quiet()
            .throws(false)

        const stdout = result.stdout.toString("utf-8")
        const stderr = result.stderr.toString("utf-8")

        if (result.exitCode !== 0) {
            log.error("build failed", { exitCode: result.exitCode, stderr })
            return {
                title: "Build Failed",
                output: `## Build Failed\n\n**Exit code:** ${result.exitCode}\n\n**stderr:**\n\`\`\`\n${stderr}\n\`\`\`\n\n**stdout:**\n\`\`\`\n${stdout}\n\`\`\``,
                metadata: { error: true, exitCode: result.exitCode },
            }
        }

        log.info("build successful")
        return {
            title: "Build Successful",
            output: `## Build Completed Successfully\n\n\`\`\`\n${stdout}\n\`\`\``,
            metadata: { error: false, exitCode: 0 },
        }
    } catch (e) {
        const msg = (e as Error).message
        log.error("build error", { error: msg })
        return {
            title: "Build Error",
            output: `## Build Error\n\n${msg}`,
            metadata: { error: true, exitCode: -1 },
        }
    }
}

async function runRestart(log: ReturnType<typeof Log.create>) {
    try {
        log.info("restarting process", { execPath: process.execPath, argv: process.argv })

        // Spawn a detached copy of the current process
        const subprocess = Bun.spawn([process.execPath, ...process.argv.slice(1)], {
            stdio: ["ignore", "ignore", "ignore"],
        })
        subprocess.unref()

        // Give the new process a moment to start
        await new Promise(resolve => setTimeout(resolve, 500))

        log.info("new process spawned, exiting current process")

        // Return success message before exiting
        // The process.exit(0) will terminate after the response is sent
        setTimeout(() => process.exit(0), 1000)

        return {
            title: "Restart Initiated",
            output: "## Restart Initiated\n\nA new process has been spawned. The current process will exit shortly.",
            metadata: { error: false, restarting: true },
        }
    } catch (e) {
        const msg = (e as Error).message
        log.error("restart error", { error: msg })
        return {
            title: "Restart Failed",
            output: `## Restart Failed\n\n${msg}`,
            metadata: { error: true, restarting: false },
        }
    }
}
