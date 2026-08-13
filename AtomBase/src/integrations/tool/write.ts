import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import DESCRIPTION from "./write.txt"
import { Bus } from "@/core/bus"
import { File } from "@/services/file"
import { FileEvent } from "@/services/file/event"
import { FileTime } from "@/services/file/time"
import { Filesystem } from "@/util/util/filesystem"
import { Instance } from "@/services/project/instance"
import { EditDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5
const MAX_WRITE_BYTES = 10 * 1024 * 1024

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().max(MAX_WRITE_BYTES).describe("The content to write to the file"),
    filePath: z.string().min(1).max(4096).describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    if (Buffer.byteLength(params.content) > MAX_WRITE_BYTES) {
      throw new Error(`Write content exceeds the ${MAX_WRITE_BYTES} byte limit`)
    }
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    let exists = false
    await FileTime.withLock(filepath, async () => {
      const file = Bun.file(filepath)
      const stats = await file.stat().catch(() => undefined)
      exists = !!stats
      if (stats?.isDirectory()) throw new Error(`Path is a directory, not a file: ${filepath}`)
      if (stats && stats.size > MAX_WRITE_BYTES) {
        throw new Error(`Existing file exceeds the ${MAX_WRITE_BYTES} byte write limit`)
      }

      // Fail fast if file exists but hasn't been read
      if (exists) await FileTime.assert(ctx.sessionID, filepath)

      const contentOld = exists ? await file.text() : ""

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

      await Bun.write(filepath, params.content)
      if (exists) {
        await Bus.publish(FileEvent.Edited, { file: filepath })
      } else {
        await Bus.publish(FileEvent.Created, { paths: [filepath] })
      }
      FileTime.read(ctx.sessionID, filepath)
    })

    let output = ""
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
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
  },
})

// Alias for backward compatibility with cli/cmd imports
export { WriteTool as Write }
