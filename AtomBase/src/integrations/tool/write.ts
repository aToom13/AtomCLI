import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { EditAnchor } from "./edit-anchor"
import { LSP } from "../lsp"
import DESCRIPTION from "./write.txt"
import { Bus } from "@/core/bus"
import { FileEvent } from "@/services/file/event"
import { FileTime } from "@/services/file/time"
import { Filesystem } from "@/util/util/filesystem"
import { Instance } from "@/services/project/instance"
import { EditDiff } from "./edit"
import { ReadTool } from "./read"
import { assertExternalDirectory } from "./external-directory"
import { ToolRuntime } from "./runtime"
import { withTimeout } from "@/util/util/timeout"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5
const MAX_WRITE_BYTES = 10 * 1024 * 1024
const LSP_DIAGNOSTICS_TIMEOUT_MS = 2_000
const MAX_WRITE_SNAPSHOT_BYTES = 8 * 1024

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  effects: {
    workspace: "write",
    external: "none",
    reversible: true,
    destructive: false,
    privileged: false,
  },
  parameters: z.object({
    content: z.string().max(MAX_WRITE_BYTES).describe("The content to write to the file"),
    filePath: z
      .string()
      .min(1)
      .max(4096)
      .describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    if (Buffer.byteLength(params.content) > MAX_WRITE_BYTES) {
      throw new Error(`Write content exceeds the ${MAX_WRITE_BYTES} byte limit`)
    }
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    let exists = false
    let writeAttempted = false
    let writeApplied = false
    try {
      await FileTime.withLock(filepath, async () => {
        const file = Bun.file(filepath)
        const stats = await file.stat().catch(() => undefined)
        exists = !!stats
        if (stats?.isDirectory()) throw new Error(`Path is a directory, not a file: ${filepath}`)
        if (stats && stats.size > MAX_WRITE_BYTES) {
          throw new Error(`Existing file exceeds the ${MAX_WRITE_BYTES} byte write limit`)
        }

        if (exists) {
          try {
            await FileTime.assert(ctx.sessionID, filepath)
          } catch (error) {
            // ponytail: Auto-read only small files; require explicit full inspection for larger overwrites.
            if (stats.size > MAX_WRITE_SNAPSHOT_BYTES) throw error
            const snapshot = await (await ReadTool.init()).execute({ filePath: filepath }, ctx)
            throw new Error(
              `File was not written. Read snapshot supplied below; review it before retrying.\n${snapshot.output}\ncontentHash: ${snapshot.metadata.contentHash ?? "unavailable"}`,
            )
          }
        }

        const contentOld = exists ? await file.text() : ""
        const executionID = ctx.extra?.execution?.executionID as string | undefined
        const knownHash = executionID ? EditAnchor.knownHash(executionID, filepath) : undefined
        if (exists && knownHash && knownHash !== EditAnchor.contentHash(contentOld))
          throw new Error(`Stale write: content changed for ${filepath}. Read it again before writing`)

        const diff = EditDiff.create(filepath, contentOld, params.content).diff
        await ctx.ask({
          permission: "edit",
          patterns: [path.relative(Instance.worktree, filepath)],
          always: ["*"],
          metadata: {
            filepath,
            diff,
          },
        })

        // The permission prompt blocks on a human, so the file can change while
        // it is open. Re-validate before writing; otherwise the approved diff is
        // not the diff that lands and the concurrent edit is silently lost.
        const currentStats = await file.stat().catch((): undefined => undefined)
        const currentContent = currentStats ? await file.text() : ""
        if (!!currentStats !== exists || currentContent !== contentOld) {
          throw new Error(
            `Stale write: content changed for ${filepath} while awaiting permission. No changes were written`,
          )
        }

        try {
          writeAttempted = true
          await Bun.write(filepath, params.content)
          writeApplied = true
          if (executionID) EditAnchor.trackWrite(executionID, filepath, contentOld, params.content)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code
          if (["EACCES", "EPERM", "EROFS", "ENOENT"].includes(code ?? "")) {
            throw new ToolRuntime.NotAppliedError(error)
          }
          throw error
        }
        if (exists) {
          await Bus.publish(FileEvent.Edited, { file: filepath })
        } else {
          await Bus.publish(FileEvent.Created, { paths: [filepath] })
        }
        FileTime.read(ctx.sessionID, filepath)
      })
    } catch (error) {
      if (error instanceof ToolRuntime.NotAppliedError || error instanceof ToolRuntime.AppliedError) throw error
      if (writeApplied) throw new ToolRuntime.AppliedError("write", error)
      if (!writeAttempted) throw new ToolRuntime.NotAppliedError(error)
      throw error
    }

    try {
      let output = ""
      const diagnostics = await withTimeout(
        LSP.touchFile(filepath, true).then(() => LSP.diagnostics()),
        LSP_DIAGNOSTICS_TIMEOUT_MS,
      ).catch(() => ({}))
      const normalizedFilepath = Filesystem.normalizePath(filepath)
      let projectDiagnosticsCount = 0
      for (const [file, issues] of Object.entries(diagnostics)) {
        const errors = issues.filter((item) => item.severity === 1)
        if (errors.length === 0) continue
        const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
        const suffix =
          errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
        if (file === normalizedFilepath) {
          output += `\nThis file has errors, please fix\n<file_diagnostics>\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</file_diagnostics>\n`
          continue
        }
        if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
        projectDiagnosticsCount++
        output += `\n<project_diagnostics>\n${file}\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</project_diagnostics>\n`
      }

      return {
        title: path.relative(Instance.worktree, filepath),
        metadata: {
          diagnostics: {
            [normalizedFilepath]: (diagnostics[normalizedFilepath] ?? []).slice(0, MAX_DIAGNOSTICS_PER_FILE),
          },
          filepath,
          exists: exists,
        },
        output,
      }
    } catch (error) {
      throw new ToolRuntime.AppliedError("write", error)
    }
  },
})

// Alias for backward compatibility with cli/cmd imports
export { WriteTool as Write }
