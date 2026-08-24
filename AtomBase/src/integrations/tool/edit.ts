// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { EditAnchor } from "./edit-anchor"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./edit.txt"
import { File } from "@/services/file"
import { FileEvent } from "@/services/file/event"
import { Bus } from "@/core/bus"
import { FileTime } from "@/services/file/time"
import { Filesystem } from "@/util/util/filesystem"
import { Instance } from "@/services/project/instance"
import { assertExternalDirectory } from "./external-directory"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_EDIT_OPERATIONS = 100
const MAX_EDIT_CONTENT_BYTES = 10 * 1024 * 1024
const MAX_EDIT_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_EDIT_FILE_BYTES = 10 * 1024 * 1024
const MAX_DIFF_BYTES = 200 * 1024
const MAX_EXACT_DIFF_INPUT_BYTES = 512 * 1024
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/
const LINE_ANCHOR_PATTERN = /^L[1-9]\d*:sha256:[a-f0-9]{64}$/

const AnchorFields = {
  startAnchor: z.string().regex(LINE_ANCHOR_PATTERN).optional().describe("Start anchor returned by the read tool"),
  endAnchor: z.string().regex(LINE_ANCHOR_PATTERN).optional().describe("End anchor returned by the read tool"),
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function limitDiff(diff: string): string {
  if (Buffer.byteLength(diff) <= MAX_DIFF_BYTES) return diff
  const head = Buffer.from(diff).subarray(0, MAX_DIFF_BYTES).toString("utf8")
  return `${head}\n\n... diff metadata truncated at ${MAX_DIFF_BYTES} bytes ...`
}

function lineCount(text: string) {
  if (!text) return 0
  let count = 1
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) count++
  }
  return count
}

export namespace EditDiff {
  export function create(filePath: string, contentOld: string, contentNew: string) {
    const oldBytes = Buffer.byteLength(contentOld)
    const newBytes = Buffer.byteLength(contentNew)
    if (oldBytes + newBytes <= MAX_EXACT_DIFF_INPUT_BYTES) {
      const raw = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )
      let additions = 0
      let deletions = 0
      for (const change of diffLines(contentOld, contentNew)) {
        if (change.added) additions += change.count || 0
        if (change.removed) deletions += change.count || 0
      }
      return { diff: limitDiff(raw), additions, deletions, preview: false }
    }

    const previewBudget = Math.floor((MAX_DIFF_BYTES - 1024) / 2)
    const oldPreview = Buffer.from(contentOld).subarray(0, previewBudget).toString("utf8").replace(/^/gm, "-")
    const newPreview = Buffer.from(contentNew).subarray(0, previewBudget).toString("utf8").replace(/^/gm, "+")
    const diff = limitDiff(
      [
        `--- ${filePath}`,
        `+++ ${filePath}`,
        `@@ bounded preview; full diff skipped (${oldBytes} -> ${newBytes} bytes) @@`,
        oldPreview,
        oldBytes > previewBudget ? "-... old content preview truncated ..." : "",
        newPreview,
        newBytes > previewBudget ? "+... new content preview truncated ..." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    return {
      diff,
      additions: lineCount(contentNew),
      deletions: lineCount(contentOld),
      preview: true,
    }
  }
}

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().min(1).max(4096).describe("The absolute path to the file to modify"),
    oldString: z
      .string()
      .max(MAX_EDIT_CONTENT_BYTES)
      .optional()
      .describe("The text to replace (required unless using operations)"),
    newString: z
      .string()
      .max(MAX_EDIT_CONTENT_BYTES)
      .optional()
      .describe("The text to replace it with (required unless using operations)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
    contentHash: z
      .string()
      .regex(CONTENT_HASH_PATTERN)
      .optional()
      .describe("Full content hash returned by the read tool; rejects the edit if the file changed"),
    ...AnchorFields,
    operations: z
      .array(
        z.object({
          oldString: z.string().max(MAX_EDIT_CONTENT_BYTES).describe("The text to replace"),
          newString: z.string().max(MAX_EDIT_CONTENT_BYTES).describe("The text to replace it with"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences (default false)"),
          ...AnchorFields,
        }),
      )
      .max(MAX_EDIT_OPERATIONS)
      .optional()
      .describe(
        "Array of edit operations to apply sequentially on the same file. Use instead of oldString/newString for multiple edits.",
      ),
  }),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    // Build operations list: either from `operations` array or from single oldString/newString
    const ops = params.operations
      ? params.operations
      : params.oldString !== undefined && params.newString !== undefined
        ? [
            {
              oldString: params.oldString,
              newString: params.newString,
              replaceAll: params.replaceAll,
              startAnchor: params.startAnchor,
              endAnchor: params.endAnchor,
            },
          ]
        : null

    if (!ops || ops.length === 0) {
      throw new Error("Either (oldString + newString) or operations array is required")
    }

    const totalBytes = ops.reduce(
      (total, op) => total + Buffer.byteLength(op.oldString) + Buffer.byteLength(op.newString),
      0,
    )
    if (totalBytes > MAX_EDIT_TOTAL_BYTES) {
      throw new Error(`Combined edit content exceeds ${MAX_EDIT_TOTAL_BYTES} bytes`)
    }

    // Validate all operations
    for (const op of ops) {
      if (op.oldString === op.newString) {
        throw new Error("oldString and newString must be different")
      }
      if (!!op.startAnchor !== !!op.endAnchor) {
        throw new Error("startAnchor and endAnchor must be provided together")
      }
    }

    const filePath = path.resolve(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)

    return executeEdits(filePath, ops, params.contentHash, ctx)
  },
})

type EditOperation = {
  oldString: string
  newString: string
  replaceAll?: boolean
  startAnchor?: string
  endAnchor?: string
}

async function executeEdits(
  filePath: string,
  operations: EditOperation[],
  expectedHash: string | undefined,
  ctx: Tool.Context,
) {
  let diff = ""
  let contentOld = ""
  let contentNew = ""
  let summary = { diff: "", additions: 0, deletions: 0, preview: false }
  await FileTime.withLock(filePath, async () => {
    const file = Bun.file(filePath)
    const stats = await file.stat().catch((): undefined => undefined)
    if (stats?.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
    if (stats && stats.size > MAX_EDIT_FILE_BYTES) {
      throw new Error(`File ${filePath} exceeds the ${MAX_EDIT_FILE_BYTES} byte edit limit`)
    }
    if (!stats && operations[0].oldString !== "") throw new Error(`File ${filePath} not found`)

    contentOld = stats ? await file.text() : ""
    if (expectedHash) {
      if (!stats || EditAnchor.contentHash(contentOld) !== expectedHash) {
        throw new Error(`Stale edit: content changed for ${filePath}. Read the file again before editing`)
      }
    }
    if (stats && operations[0].oldString !== "") {
      if (!FileTime.get(ctx.sessionID, filePath)) {
        throw new Error(`You must read the file ${filePath} before overwriting it. Use the Read tool first`)
      }
      if (!expectedHash) await FileTime.assert(ctx.sessionID, filePath)
    }
    contentNew = contentOld
    // Apply every operation in memory before requesting permission or writing.
    // A failed match therefore leaves the original file untouched.
    for (const operation of operations) {
      if (operation.oldString === "") {
        contentNew = operation.newString
      } else if (operation.startAnchor && operation.endAnchor) {
        const range = EditAnchor.resolveRange(contentNew, operation.startAnchor, operation.endAnchor)
        const scoped = contentNew.slice(range.start, range.end)
        const replaced = replace(scoped, operation.oldString, operation.newString, operation.replaceAll)
        contentNew = contentNew.slice(0, range.start) + replaced + contentNew.slice(range.end)
      } else {
        contentNew = replace(contentNew, operation.oldString, operation.newString, operation.replaceAll)
      }
      if (Buffer.byteLength(contentNew) > MAX_EDIT_FILE_BYTES) {
        throw new Error(`Edited content exceeds the ${MAX_EDIT_FILE_BYTES} byte limit`)
      }
    }

    summary = EditDiff.create(filePath, contentOld, contentNew)
    diff = summary.diff
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filePath)],
      always: ["*"],
      metadata: {
        filepath: filePath,
        diff,
      },
    })

    const currentStats = await Bun.file(filePath)
      .stat()
      .catch((): undefined => undefined)
    const currentContent = currentStats ? await Bun.file(filePath).text() : ""
    if (!!currentStats !== !!stats || currentContent !== contentOld) {
      throw new Error(`Stale edit: content changed for ${filePath} while awaiting permission. No changes were written`)
    }

    await Bun.write(filePath, contentNew)
    await Bus.publish(FileEvent.Edited, {
      file: filePath,
    })
    FileTime.read(ctx.sessionID, filePath)
  })

  const additions = summary.additions
  const deletions = summary.deletions
  const metadataDiff = summary.diff

  ctx.metadata({
    metadata: {
      diff: metadataDiff,
      additions,
      deletions,
      diagnostics: {},
      diffPreview: summary.preview,
      contentHashBefore: EditAnchor.contentHash(contentOld),
      contentHashAfter: EditAnchor.contentHash(contentNew),
      ...(operations.length > 1 ? { operations: operations.length } : {}),
    },
  })

  let output = ""
  await LSP.touchFile(filePath, true)
  const diagnostics = await LSP.diagnostics()
  const normalizedFilePath = Filesystem.normalizePath(filePath)
  const issues = diagnostics[normalizedFilePath] ?? []
  const errors = issues.filter((item) => item.severity === 1)
  if (errors.length > 0) {
    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    const suffix =
      errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
    output += `\nThis file has errors, please fix\n<file_diagnostics>\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</file_diagnostics>\n`
  }

  return {
    metadata: {
      diagnostics: { [normalizedFilePath]: issues.slice(0, MAX_DIAGNOSTICS_PER_FILE) },
      diff: metadataDiff,
      additions,
      deletions,
      diffPreview: summary.preview,
      contentHashBefore: EditAnchor.contentHash(contentOld),
      contentHashAfter: EditAnchor.contentHash(contentNew),
      ...(operations.length > 1 ? { operations: operations.length } : {}),
    },
    title: `${path.relative(Instance.worktree, filePath)}`,
    output,
  }
}

export interface EditContext {
  content: string
  contentLines: string[]
  find: string
  findLines: string[]
}

export type Replacer = (ctx: EditContext) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

/**
 * Levenshtein distance algorithm implementation
 */
function levenshtein(a: string, b: string): number {
  // Handle empty strings
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }

  // Single-row DP: only need previous row values
  const len = b.length
  const row = new Array<number>(len + 1)
  for (let j = 0; j <= len; j++) row[j] = j

  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= len; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const val = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = row[j]
      row[j] = val
    }
  }
  return row[len]
}

export const SimpleReplacer: Replacer = function* ({ find }) {
  yield find
}

export const LineTrimmedReplacer: Replacer = function* ({
  content,
  contentLines: originalLines,
  findLines: searchLines,
}) {
  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* ({
  content,
  contentLines: originalLines,
  findLines: searchLines,
}) {
  if (searchLines.length < 3) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }

    // Look for the matching last line after this first line
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j })
        break // Only match the first occurrence of the last line
      }
    }
  }

  // Return immediately if no candidates
  if (candidates.length === 0) {
    return
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck

        // Exit early when threshold is reached
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break
        }
      }
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity /= linesToCheck // Average similarity
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* ({ content, contentLines: lines, find }) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  // Handle single line matches
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      // Only check for substring matches if the full line doesn't match
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        // Find the actual substring in the original line that matches
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch (e) {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  // Handle multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* ({ content, find }) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* ({ content, find }) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  // Try direct match with unescaped find string
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* ({ content, find }) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* ({ content, find }) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

export const ContextAwareReplacer: Replacer = function* ({
  content,
  contentLines: originalLines,
  findLines: searchLines,
}) {
  if (searchLines.length < 3) {
    // Need at least 3 lines to have meaningful context
    return
  }

  // Remove trailing empty line if present
  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  // Extract first and last lines as context anchors
  const firstLine = searchLines[0].trim()
  const lastLine = searchLines[searchLines.length - 1].trim()

  // Find blocks that start and end with the context anchors
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLine) continue

    // Look for the matching last line
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLine) {
        // Found a potential context block
        const blockLines = originalLines.slice(i, j + 1)
        const block = blockLines.join("\n")

        // Check if the middle content has reasonable similarity
        // (simple heuristic: at least 50% of non-empty lines should match when trimmed)
        if (blockLines.length === searchLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const searchLine = searchLines[k].trim()

            if (blockLine.length > 0 || searchLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === searchLine) {
                matchingLines++
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break // Only match the first occurrence
          }
        }
        break
      }
    }
  }
}

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("oldString and newString must be different")
  }

  let notFound = true

  const contentLines = content.split("\n")
  const findLines = oldString.split("\n")
  const ctx: EditContext = {
    content,
    contentLines,
    find: oldString,
    findLines,
  }

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(ctx)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (replaceAll) {
        return content.replaceAll(search, newString)
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  if (notFound) {
    throw new Error("oldString not found in content")
  }
  throw new Error(
    "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.",
  )
}

// Alias for backward compatibility with cli/cmd imports
export { EditTool as Edit }
