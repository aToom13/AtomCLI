import z from "zod"
import fs from "fs/promises"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "@/services/file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "@/services/project/instance"
import { Identifier } from "@/core/id/id"
import { assertExternalDirectory } from "./external-directory"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_BYTES = 50 * 1024
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * Validates file path to prevent path traversal attacks
 * Returns path info for external directory check
 */
function validateFilePath(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(Instance.directory, filePath)
  return path.normalize(absolutePath)
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().min(1).max(4096).describe("The path to the file to read"),
    offset: z.coerce.number().int().min(0).describe("The line number to start reading from (0-based)").optional(),
    limit: z.coerce.number().int().min(1).max(DEFAULT_READ_LIMIT).describe("The number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    const filepath = validateFilePath(params.filePath)
    const title = path.relative(Instance.worktree, filepath)

    await assertExternalDirectory(ctx, filepath)

    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      const dirEntries = await fs.readdir(dir).catch(() => [])
      const suggestions = dirEntries
        .filter(
          (entry) =>
            entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
        )
        .map((entry) => path.join(dir, entry))
        .slice(0, 3)

      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
      }

      throw new Error(`File not found: ${filepath}`)
    }

    const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml"
    const isPdf = file.type === "application/pdf"
    if (isImage || isPdf) {
      const stat = await file.stat()
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`${isImage ? "Image" : "PDF"} exceeds the 20 MiB attachment limit: ${filepath}`)
      }
      const mime = file.type
      const msg = `${isImage ? "Image" : "PDF"} read successfully`
      return {
        title,
        output: msg,
        metadata: {
          preview: msg,
          truncated: false,
        },
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime,
            url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
          },
        ],
      }
    }

    const isBinary = await isBinaryFile(filepath, file)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset ?? 0
    const { raw, totalLines, truncated, truncatedByBytes } = await readTextLines(file, offset, limit, ctx.abort)

    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
    })
    const preview = raw.slice(0, 20).join("\n")

    let output = "<file>\n"
    output += content.join("\n")

    const lastReadLine = offset + raw.length

    if (truncatedByBytes) {
      output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else if (truncated) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else {
      output += `\n\n(End of file - total ${totalLines ?? lastReadLine} lines)`
    }
    output += "\n</file>"

    // just warms the lsp client
    LSP.touchFile(filepath, false)
    FileTime.read(ctx.sessionID, filepath)

    return {
      title,
      output,
      metadata: {
        preview,
        truncated,
      },
    }
  },
})

async function isBinaryFile(filepath: string, file: Bun.BunFile): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  // binary check for common non-text extensions
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
    default:
      break
  }

  const stat = await file.stat()
  const fileSize = stat.size
  if (fileSize === 0) return false

  const bufferSize = Math.min(4096, fileSize)
  const buffer = await file.slice(0, bufferSize).arrayBuffer()
  if (buffer.byteLength === 0) return false
  const bytes = new Uint8Array(buffer.slice(0, bufferSize))

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  // If >30% non-printable characters, consider it binary
  return nonPrintableCount / bytes.length > 0.3
}

async function readTextLines(file: Bun.BunFile, offset: number, limit: number, signal: AbortSignal) {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  const raw: string[] = []
  let bytes = 0
  let lineIndex = 0
  let pending = ""
  let pendingTruncated = false
  let truncated = false
  let truncatedByBytes = false
  let reachedEnd = false
  let lastWasNewline = false

  const append = (fragment: string) => {
    const remaining = MAX_LINE_LENGTH + 1 - pending.length
    if (remaining > 0) pending += fragment.slice(0, remaining)
    if (fragment.length > Math.max(remaining, 0)) pendingTruncated = true
  }

  const consumeLine = () => {
    const current = lineIndex++
    if (current < offset) {
      pending = ""
      pendingTruncated = false
      return false
    }
    if (raw.length >= limit) {
      truncated = true
      return true
    }

    if (pending.endsWith("\r")) pending = pending.slice(0, -1)
    const line = pendingTruncated || pending.length > MAX_LINE_LENGTH ? `${pending.slice(0, MAX_LINE_LENGTH)}...` : pending
    const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
    if (bytes + size > MAX_BYTES) {
      truncated = true
      truncatedByBytes = true
      return true
    }

    raw.push(line)
    bytes += size
    pending = ""
    pendingTruncated = false
    return false
  }

  try {
    outer: while (true) {
      if (signal.aborted) throw signal.reason
      const { done, value } = await reader.read()
      if (done) {
        reachedEnd = true
        break
      }

      const text = decoder.decode(value, { stream: true })
      lastWasNewline = text.endsWith("\n")
      let start = 0
      while (true) {
        const newline = text.indexOf("\n", start)
        if (newline === -1) {
          append(text.slice(start))
          break
        }
        append(text.slice(start, newline))
        if (consumeLine()) break outer
        start = newline + 1
      }
    }

    if (reachedEnd) {
      append(decoder.decode())
      if (pending.length > 0 || lineIndex === 0 || lastWasNewline) consumeLine()
    }
  } finally {
    if (!reachedEnd) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  return {
    raw,
    totalLines: reachedEnd ? lineIndex : undefined,
    truncated,
    truncatedByBytes,
  }
}

// Alias for backward compatibility with cli/cmd imports
export { ReadTool as Read }
