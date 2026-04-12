import type { UpdateFileChunk } from "./types"
import * as fs from "fs"

// File content manipulation
interface ApplyPatchFileUpdate {
    unified_diff: string
    content: string
}

export function deriveNewContentsFromChunks(filePath: string, chunks: UpdateFileChunk[]): ApplyPatchFileUpdate {
    // Read original file content
    let originalContent: string
    try {
        originalContent = fs.readFileSync(filePath, "utf-8")
    } catch (error) {
        throw new Error(`Failed to read file ${filePath}: ${error}`)
    }

    let originalLines = originalContent.split("\n")

    // Drop trailing empty element for consistent line counting
    if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
        originalLines.pop()
    }

    const replacements = computeReplacements(originalLines, filePath, chunks)
    let newLines = applyReplacements(originalLines, replacements)

    // Ensure trailing newline
    if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
        newLines.push("")
    }

    const newContent = newLines.join("\n")

    // Generate unified diff
    const unifiedDiff = generateUnifiedDiff(originalContent, newContent)

    return {
        unified_diff: unifiedDiff,
        content: newContent,
    }
}

function computeReplacements(
    originalLines: string[],
    filePath: string,
    chunks: UpdateFileChunk[],
): Array<[number, number, string[]]> {
    const replacements: Array<[number, number, string[]]> = []
    let lineIndex = 0

    for (const chunk of chunks) {
        // Handle context-based seeking
        if (chunk.change_context) {
            const contextIdx = seekSequence(originalLines, [chunk.change_context], lineIndex)
            if (contextIdx === -1) {
                throw new Error(`Failed to find context '${chunk.change_context}' in ${filePath}`)
            }
            lineIndex = contextIdx + 1
        }

        // Handle pure addition (no old lines)
        if (chunk.old_lines.length === 0) {
            const insertionIdx =
                originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
                    ? originalLines.length - 1
                    : originalLines.length
            replacements.push([insertionIdx, 0, chunk.new_lines])
            continue
        }

        // Try to match old lines in the file
        let pattern = chunk.old_lines
        let newSlice = chunk.new_lines
        let found = seekSequence(originalLines, pattern, lineIndex)

        // Retry without trailing empty line if not found
        if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
            pattern = pattern.slice(0, -1)
            if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
                newSlice = newSlice.slice(0, -1)
            }
            found = seekSequence(originalLines, pattern, lineIndex)
        }

        if (found !== -1) {
            replacements.push([found, pattern.length, newSlice])
            lineIndex = found + pattern.length
        } else {
            throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.old_lines.join("\n")}`)
        }
    }

    // Sort replacements by index to apply in order
    replacements.sort((a, b) => a[0] - b[0])

    return replacements
}

function applyReplacements(lines: string[], replacements: Array<[number, number, string[]]>): string[] {
    // Apply replacements in reverse order to avoid index shifting
    const result = [...lines]

    for (let i = replacements.length - 1; i >= 0; i--) {
        const [startIdx, oldLen, newSegment] = replacements[i]

        // Remove old lines
        result.splice(startIdx, oldLen)

        // Insert new lines
        for (let j = 0; j < newSegment.length; j++) {
            result.splice(startIdx + j, 0, newSegment[j])
        }
    }

    return result
}

function seekSequence(lines: string[], pattern: string[], startIndex: number): number {
    if (pattern.length === 0) return -1

    // Simple substring search implementation
    for (let i = startIndex; i <= lines.length - pattern.length; i++) {
        let matches = true

        for (let j = 0; j < pattern.length; j++) {
            if (lines[i + j] !== pattern[j]) {
                matches = false
                break
            }
        }

        if (matches) {
            return i
        }
    }

    return -1
}

function generateUnifiedDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split("\n")
    const newLines = newContent.split("\n")

    // Simple diff generation - in a real implementation you'd use a proper diff algorithm
    let diff = "@@ -1 +1 @@\n"

    // Find changes (simplified approach)
    const maxLen = Math.max(oldLines.length, newLines.length)
    let hasChanges = false

    for (let i = 0; i < maxLen; i++) {
        const oldLine = oldLines[i] || ""
        const newLine = newLines[i] || ""

        if (oldLine !== newLine) {
            if (oldLine) diff += `-${oldLine}\n`
            if (newLine) diff += `+${newLine}\n`
            hasChanges = true
        } else if (oldLine) {
            diff += ` ${oldLine}\n`
        }
    }

    return hasChanges ? diff : ""
}
