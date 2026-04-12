import { z } from "zod"
import path from "path"
import { spawn } from "child_process"
import { ulid } from "ulid"
import { Identifier } from "../../id/id"
import { defer } from "../../util/defer"
import { Session } from ".."
import { SessionRevert } from "../revert"
import { Agent } from "../../agent/agent"
import { MessageV2 } from "../message-v2"
import { Shell } from "../../shell/shell"
import { Instance } from "../../project/instance"
import { start, cancel } from "./state"
import { lastModel } from "./messages"

export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    model: z
        .object({
            providerID: z.string(),
            modelID: z.string(),
        })
        .optional(),
    command: z.string(),
})

export type ShellInput = z.infer<typeof ShellInput>

export async function shell(input: ShellInput) {
    const abort = start(input.sessionID)
    if (!abort) {
        throw new Session.BusyError(input.sessionID)
    }
    using _ = defer(() => cancel(input.sessionID))

    const session = await Session.get(input.sessionID)
    if (session.revert) {
        SessionRevert.cleanup(session)
    }
    const agent = await Agent.get(input.agent)
    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        time: {
            created: Date.now(),
        },
        role: "user",
        agent: input.agent,
        model: {
            providerID: model.providerID,
            modelID: model.modelID,
        },
    }
    await Session.updateMessage(userMsg)
    const userPart: MessageV2.Part = {
        type: "text",
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID: input.sessionID,
        text: "The following tool was executed by the user",
        synthetic: true,
    }
    await Session.updatePart(userPart)

    const msg: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        parentID: userMsg.id,
        mode: input.agent,
        agent: input.agent,
        cost: 0,
        path: {
            cwd: Instance.directory,
            root: Instance.worktree,
        },
        time: {
            created: Date.now(),
        },
        role: "assistant",
        tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
        },
        modelID: model.modelID,
        providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: MessageV2.Part = {
        type: "tool",
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: input.sessionID,
        tool: "bash",
        callID: ulid(),
        state: {
            status: "running",
            time: {
                start: Date.now(),
            },
            input: {
                command: input.command,
            },
        },
    }
    await Session.updatePart(part)
    const preferredShell = Shell.preferred()
    const shellName = (
        process.platform === "win32" ? path.win32.basename(preferredShell, ".exe") : path.basename(preferredShell)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
        nu: {
            args: ["-c", input.command],
        },
        fish: {
            args: ["-c", input.command],
        },
        zsh: {
            args: [
                "-c",
                "-l",
                `
          [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
          [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
          eval ${JSON.stringify(input.command)}
        `,
            ],
        },
        bash: {
            args: [
                "-c",
                "-l",
                `
          shopt -s expand_aliases
          [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
          eval ${JSON.stringify(input.command)}
        `,
            ],
        },
        // Windows cmd
        cmd: {
            args: ["/c", input.command],
        },
        // Windows PowerShell
        powershell: {
            args: ["-NoProfile", "-Command", input.command],
        },
        pwsh: {
            args: ["-NoProfile", "-Command", input.command],
        },
        // Fallback: any shell that doesn't match those above
        //  - No -l, for max compatibility
        "": {
            args: ["-c", `${input.command}`],
        },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const proc = spawn(preferredShell, args, {
        cwd: Instance.directory,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            TERM: "dumb",
        },
    })

    let output = ""

    proc.stdout?.on("data", (chunk) => {
        output += chunk.toString()
        if (part.state.status === "running") {
            part.state.metadata = {
                output: output,
                description: "",
            }
            Session.updatePart(part)
        }
    })

    proc.stderr?.on("data", (chunk) => {
        output += chunk.toString()
        if (part.state.status === "running") {
            part.state.metadata = {
                output: output,
                description: "",
            }
            Session.updatePart(part)
        }
    })

    await new Promise<void>((resolve, reject) => {
        proc.on("close", (code) => {
            resolve()
        })
        proc.on("error", (err) => {
            reject(err)
        })
    })

    await Session.updatePart({
        ...part,
        state: {
            ...part.state,
            status: "completed",
            output,
            time: {
                ...part.state.time,
                end: Date.now(),
            },
        },
    })
}
