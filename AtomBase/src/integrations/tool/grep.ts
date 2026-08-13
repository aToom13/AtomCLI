import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Ripgrep } from "@/services/file/ripgrep"
import DESCRIPTION from "./grep.txt"
import { Instance } from "@/services/project/instance"
import { assertExternalDirectory } from "./external-directory"

const MAX_RESULTS = 100
const MAX_LINE_LENGTH = 2_000
const MAX_PATTERN_LENGTH = 1_000
const MAX_CAPTURE_BYTES = 256 * 1024
const SEARCH_TIMEOUT_MS = 30_000

function validatePattern(pattern: string): void {
  if (!pattern.trim()) throw new Error("Pattern cannot be empty")
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Pattern too long (max ${MAX_PATTERN_LENGTH} characters)`)
  }

  const dangerousPatterns = [
    /\(\?![^)]*\*[^)]*\)/,
    /\(\?=[^)]*\*[^)]*\)/,
    /\(\?\<\![^)]*\*[^)]*\)/,
    /\(\?\<\=[^)]*\*[^)]*\)/,
    /\([^)]*\+[^)]*\+[^)]*\)/,
    /\([^)]*\*[^)]*\*[^)]*\)/,
    /\([^)]*\{[^}]*\}[^)]*\{[^}]*\}/,
  ]
  if (dangerousPatterns.some((candidate) => candidate.test(pattern))) {
    throw new Error("Pattern contains a potentially expensive nested quantifier or lookaround")
  }

  let depth = 0
  let maxDepth = 0
  for (const char of pattern) {
    if (char === "(") maxDepth = Math.max(maxDepth, ++depth)
    if (char === ")") depth--
  }
  if (maxDepth > 10) throw new Error("Pattern nesting too deep (max 10 levels)")
}

function resolveSearchPath(searchPath: string) {
  return path.normalize(path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath))
}

async function readBounded(stream: ReadableStream<Uint8Array>, maxLines: number, stop: () => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const lines: string[] = []
  let buffer = ""
  let bytes = 0
  let truncated = false

  try {
    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const remaining = MAX_CAPTURE_BYTES - bytes
      if (value.byteLength > remaining) {
        if (remaining > 0) buffer += decoder.decode(value.subarray(0, remaining), { stream: true })
        truncated = true
        stop()
      } else {
        buffer += decoder.decode(value, { stream: true })
      }
      bytes += Math.min(value.byteLength, Math.max(remaining, 0))

      const chunks = buffer.split(/\r?\n/)
      buffer = chunks.pop() ?? ""
      for (const line of chunks) {
        if (!line) continue
        if (lines.length >= maxLines) {
          truncated = true
          stop()
          break outer
        }
        lines.push(line)
      }
      if (truncated) break
    }

    if (!truncated) {
      buffer += decoder.decode()
      if (buffer) {
        if (lines.length < maxLines) lines.push(buffer)
        else truncated = true
      }
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  return { lines, truncated }
}

async function runRipgrep(command: string[], signal: AbortSignal) {
  const subprocess = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  const stop = () => {
    try {
      subprocess.kill()
    } catch {}
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    stop()
  }, SEARCH_TIMEOUT_MS)
  const abort = () => stop()
  signal.addEventListener("abort", abort, { once: true })

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readBounded(subprocess.stdout, MAX_RESULTS + 1, stop),
      readBounded(subprocess.stderr, 20, stop),
      subprocess.exited,
    ])
    if (signal.aborted) throw signal.reason
    if (timedOut) throw new Error(`Search timed out after ${SEARCH_TIMEOUT_MS / 1_000} seconds`)
    return {
      lines: stdout.lines.slice(0, MAX_RESULTS),
      truncated: stdout.truncated || stdout.lines.length > MAX_RESULTS,
      stderr: stderr.lines.join("\n"),
      exitCode,
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", abort)
  }
}

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().min(1).max(MAX_PATTERN_LENGTH).describe("The regex pattern to search for in file contents"),
    path: z.string().max(4096).optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().max(1_000).optional().describe('File pattern to include (for example, "*.ts")'),
    count: z.boolean().optional().describe("Return bounded per-file match counts instead of matching lines"),
  }),
  async execute(params, ctx) {
    validatePattern(params.pattern)

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: { pattern: params.pattern, path: params.path, include: params.include },
    })

    const searchPath = resolveSearchPath(params.path ?? Instance.directory)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })
    const rgPath = await Ripgrep.filepath()
    const args = [rgPath, "--hidden", "--glob=!.git/*", "--max-filesize=10M"]

    if (params.count) args.push("--count")
    else args.push("-nH", "--field-match-separator=|")
    if (params.include) args.push("--glob", params.include)
    args.push("--regexp", params.pattern, searchPath)

    const result = await runRipgrep(args, ctx.abort)
    if (result.exitCode === 1 && !result.truncated) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: params.count ? "No matches found" : "No files found",
      }
    }
    if (result.exitCode !== 0 && !result.truncated) throw new Error(`ripgrep failed: ${result.stderr}`)

    if (params.count) {
      let matchCount = 0
      const counts: string[] = []
      for (const line of result.lines) {
        const separator = line.lastIndexOf(":")
        if (separator === -1) continue
        const count = Number.parseInt(line.slice(separator + 1), 10)
        if (!Number.isFinite(count)) continue
        matchCount += count
        counts.push(`${line.slice(0, separator)}: ${count}`)
      }
      const prefix = result.truncated ? "At least" : "Total"
      const suffix = result.truncated ? "\n(Results are truncated; use a narrower path or include pattern.)" : ""
      return {
        title: params.pattern,
        metadata: { matches: matchCount, truncated: result.truncated },
        output: `${prefix}: ${matchCount} matches across ${counts.length} files\n${counts.join("\n")}${suffix}`,
      }
    }

    const matches = result.lines.flatMap((line) => {
      const [filePath, lineNumber, ...text] = line.split("|")
      if (!filePath || !lineNumber || text.length === 0) return []
      return [{ path: filePath, lineNumber, text: text.join("|") }]
    })
    if (matches.length === 0) {
      return { title: params.pattern, metadata: { matches: 0, truncated: false }, output: "No files found" }
    }

    const output = [`Found ${matches.length} matches`]
    let currentFile = ""
    for (const match of matches) {
      if (currentFile !== match.path) {
        if (currentFile) output.push("")
        currentFile = match.path
        output.push(`${match.path}:`)
      }
      const text = match.text.length > MAX_LINE_LENGTH ? `${match.text.slice(0, MAX_LINE_LENGTH)}...` : match.text
      output.push(`  Line ${match.lineNumber}: ${text}`)
    }
    if (result.truncated) output.push("", "(Results are truncated; use a narrower path, pattern, or include.)")

    return {
      title: params.pattern,
      metadata: { matches: matches.length, truncated: result.truncated },
      output: output.join("\n"),
    }
  },
})
