import path from "path"
import { spawn } from "child_process"
import z from "zod"
import { ulid } from "ulid"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { SessionRevert } from "../revert"
import { Session } from ".."
import { Agent } from "@/integrations/agent/agent"
import { EnvPolicy } from "@/core/env/policy"
import { Instance } from "@/services/project/instance"
import { Shell } from "@/interfaces/shell/shell"
import { appendOutput as appendOutputChunk, OUTPUT_UPDATE_INTERVAL_MS } from "./shell"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "session.prompt.shell" })

export namespace ShellCommand {
  export const Input = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    agent: z.string(),
    model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
    command: z.string(),
  })
  export type Input = z.infer<typeof Input>

  type Context = {
    start(sessionID: string): AbortController | undefined
    finish(sessionID: string, owner: AbortController): void
    lastModel(sessionID: string): Promise<{ providerID: string; modelID: string }>
  }

  export async function run(input: Input, ctx: Context) {
    const owner = ctx.start(input.sessionID)
    if (!owner) throw new Session.BusyError(input.sessionID)
    const abort = owner.signal
    try {
      const session = await Session.get(input.sessionID)
      if (session.revert) SessionRevert.cleanup(session)
      const agent = await Agent.get(input.agent)
      const model = input.model ?? agent.model ?? (await ctx.lastModel(input.sessionID))
      const userMsg: MessageV2.User = {
        id: input.messageID ?? Identifier.ascending("message"),
        sessionID: input.sessionID,
        time: { created: Date.now() },
        role: "user",
        agent: input.agent,
        model: { providerID: model.providerID, modelID: model.modelID },
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
        agent: input.agent,
        cost: 0,
        path: { cwd: Instance.directory, root: Instance.worktree },
        time: { created: Date.now() },
        role: "assistant",
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: model.modelID,
        providerID: model.providerID,
      }
      await Session.updateMessage(msg)
      const part: MessageV2.ToolPart = {
        type: "tool",
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: input.sessionID,
        tool: "bash",
        callID: ulid(),
        state: { status: "running", time: { start: Date.now() }, input: { command: input.command } },
      }
      await Session.updatePart(part)

      const shell = Shell.preferred()
      const shellName = (
        process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
      ).toLowerCase()
      const invocations: Record<string, { args: string[] }> = {
        nu: { args: ["-c", input.command] },
        fish: { args: ["-c", input.command] },
        zsh: {
          args: [
            "-c",
            "-l",
            `[[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true\n[[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true\neval ${JSON.stringify(input.command)}`,
          ],
        },
        bash: {
          args: [
            "-c",
            "-l",
            `shopt -s expand_aliases\n[[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true\neval ${JSON.stringify(input.command)}`,
          ],
        },
        cmd: { args: ["/c", input.command] },
        powershell: { args: ["-NoProfile", "-Command", input.command] },
        pwsh: { args: ["-NoProfile", "-Command", input.command] },
        "": { args: ["-c", input.command] },
      }
      const proc = spawn(shell, (invocations[shellName] ?? invocations[""]).args, {
        cwd: Instance.directory,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: EnvPolicy.build({ cwd: Instance.directory, scope: "session:shell", overrides: { TERM: "dumb" } }),
      })

      let output = ""
      let outputUpdateTimer: ReturnType<typeof setTimeout> | undefined
      let outputUpdate = Promise.resolve()
      const flushOutput = () => {
        outputUpdateTimer = undefined
        const snapshot = output
        outputUpdate = outputUpdate
          .then(async () => {
            if (part.state.status !== "running") return
            part.state.metadata = { output: snapshot, description: "" }
            await Session.updatePart(part)
          })
          .catch((error) => log.warn("failed to publish batched shell output", { sessionID: input.sessionID, error }))
      }
      const appendOutput = (chunk: unknown) => {
        output = appendOutputChunk(output, String(chunk))
        if (!outputUpdateTimer) outputUpdateTimer = setTimeout(flushOutput, OUTPUT_UPDATE_INTERVAL_MS)
      }
      proc.stdout?.on("data", appendOutput)
      proc.stderr?.on("data", appendOutput)

      let aborted = false
      let exited = false
      const kill = () => Shell.killTree(proc, { exited: () => exited })
      if (abort.aborted) {
        aborted = true
        await kill()
      }
      const abortHandler = () => {
        aborted = true
        void kill()
      }
      abort.addEventListener("abort", abortHandler, { once: true })
      await new Promise<void>((resolve) => {
        proc.on("close", () => {
          exited = true
          abort.removeEventListener("abort", abortHandler)
          resolve()
        })
      })
      if (outputUpdateTimer) clearTimeout(outputUpdateTimer)
      outputUpdateTimer = undefined
      await outputUpdate
      if (aborted)
        output = appendOutputChunk(
          output,
          "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n"),
        )
      msg.time.completed = Date.now()
      await Session.updateMessage(msg)
      if (part.state.status === "running") {
        part.state = {
          status: "completed",
          time: { ...part.state.time, end: Date.now() },
          input: part.state.input,
          title: "",
          metadata: { output, description: "" },
          output,
        }
        await Session.updatePart(part)
      }
      return { info: msg, parts: [part] }
    } finally {
      ctx.finish(input.sessionID, owner)
    }
  }
}
