import z from "zod"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE_LENGTH = 2000
const MAX_PATTERN_LENGTH = 1000 // Prevent excessively long patterns
const REGEX_TIMEOUT_MS = 30000 // 30 second timeout for regex operations

/**
 * Validates regex pattern for potential ReDoS attacks
 * - Limits pattern length
 * - Detects potentially dangerous patterns
 */
function validatePattern(pattern: string): void {
  if (!pattern || pattern.trim().length === 0) {
    throw new Error("Pattern cannot be empty")
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Pattern too long (max ${MAX_PATTERN_LENGTH} characters)`)
  }

  // Check for potentially catastrophic patterns (simplified ReDoS detection)
  // These patterns can cause exponential backtracking
  const dangerousPatterns = [
    /\(\?\![^)]*\*[^)]*\)/, // Negative lookahead with star
    /\(\?\=[^)]*\*[^)]*\)/, // Positive lookahead with star
    /\(\?\<\![^)]*\*[^)]*\)/, // Negative lookbehind with star
    /\(\?\<\=[^)]*\*[^)]*\)/, // Positive lookbehind with star
    /\([^)]*\+[^)]*\+[^)]*\)/, // Nested quantifiers
    /\([^)]*\*[^)]*\*[^)]*\)/, // Nested stars
    /\([^)]*\{[^}]*\}[^)]*\{[^}]*\}/, // Multiple brace quantifiers
  ]

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      throw new Error(
        `Pattern contains potentially dangerous construct that could cause performance issues. ` +
          `Avoid nested quantifiers, lookaheads with quantifiers, or excessively complex patterns.`,
      )
    }
  }

  // Check for reasonable nesting depth
  let depth = 0
  let maxDepth = 0
  for (const char of pattern) {
    if (char === "(") {
      depth++
      maxDepth = Math.max(maxDepth, depth)
    } else if (char === ")") {
      depth--
    }
  }

  if (maxDepth > 10) {
    throw new Error("Pattern nesting too deep (max 10 levels)")
  }
}

/**
 * Validates search path to prevent path traversal
 */
function validateSearchPath(searchPath: string): string {
  // Check for path traversal attempts
  if (searchPath.includes("..") || searchPath.includes("..\\")) {
    throw new Error(
      `Search path "${searchPath}" contains path traversal sequence "..". ` +
        `This is not allowed for security reasons.`,
    )
  }

  // Resolve to absolute path
  const absolutePath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)

  // Normalize the path
  const normalizedPath = path.normalize(absolutePath)

  // Ensure path is within allowed boundaries
  const allowedBase = path.resolve(Instance.worktree || Instance.directory)
  if (!normalizedPath.startsWith(allowedBase)) {
    throw new Error(
      `Search path "${searchPath}" is outside the allowed project boundaries. ` +
        `For security, searches can only be performed within the project directory.`,
    )
  }

  return normalizedPath
}

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    // Validate pattern for ReDoS protection
    validatePattern(params.pattern)

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    // Validate search path
    const searchPath = validateSearchPath(params.path ?? Instance.directory)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const args = ["-nH", "--hidden", "--follow", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const output = await new Response(proc.stdout).text()
    const errorOutput = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode === 1) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = output.trim().split(/\r?\n/)
    const matches = []

    for (const line of lines) {
      if (!line) continue

      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")

      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => null)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${finalMatches.length} matches`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
