import path from "node:path"
import fs from "node:fs/promises"
import { Session } from "@/core/session"
import { Instance } from "@/services/project/instance"
import { TaskVerification } from "./task-verification"
import type { ExecutionCheckpoint } from "./checkpoint"

export namespace VerificationEvidence {
  export async function snapshot(root = Instance.worktree) {
    // ponytail: Git candidates only; non-Git work needs an explicit verification input manifest.
    let proc: Bun.Subprocess<"ignore", "pipe", "ignore">
    try {
      proc = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: root,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      })
    } catch {
      return undefined
    }
    const [output, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (exit !== 0) return undefined
    const files = output
      .split("\0")
      .filter(Boolean)
      .map((file) => path.resolve(root, file))
    for (const file of files) {
      try {
        await fs.access(file, fs.constants.R_OK)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined
      }
    }
    return TaskVerification.buildSnapshot(files, root, root)
  }

  export async function resolve(sessionID: string, checks: ExecutionCheckpoint.Result["checks"], since = 0) {
    const messages = await Session.messages({ sessionID })
    const current = checks?.length ? await snapshot() : undefined
    return Promise.all(
      (checks ?? []).map(async (check) => {
        const matches = messages
          .filter((message) => message.info.time.created >= since)
          .flatMap((message) => message.parts)
          .filter((part) => part.type === "tool" && part.callID === check.callID)
        const part = matches.length === 1 ? matches[0] : undefined
        const base = { name: check.name, callID: check.callID, scope: "whole_command" as const }
        if (!part || part.type !== "tool" || part.tool !== "bash" || part.state.status !== "completed")
          return { ...base, status: "BLOCKED" as const, reason: "No unique completed Bash call in this execution" }
        const meta = part.state.metadata
        if (meta.timedOut || meta.aborted || typeof meta.exit !== "number")
          return { ...base, status: "BLOCKED" as const, reason: "Command interrupted or exit code unavailable" }
        if (meta.exit !== 0) return { ...base, status: "FAIL" as const, reason: `Command exit ${meta.exit}` }
        if (meta.verificationSimple !== true || typeof meta.outputFingerprint !== "string")
          return {
            ...base,
            status: "BLOCKED" as const,
            reason: "No independent single-command evidence; split checks into separate calls",
          }
        const source = TaskVerification.BuildSnapshot.safeParse(meta.verificationSnapshot)
        if (
          !current ||
          !source.success ||
          source.data.workdir !== current.workdir ||
          source.data.digest !== current.digest
        )
          return { ...base, status: "BLOCKED" as const, reason: "Source snapshot missing or changed after command" }
        return { ...base, status: "PASS" as const, reason: `Exit 0; output SHA-256 ${meta.outputFingerprint}` }
      }),
    )
  }
}
