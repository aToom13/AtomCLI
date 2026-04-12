import type { Hunk, UpdateFileChunk, ApplyPatchArgs } from "./types"
import { MaybeApplyPatch } from "./types"

function parsePatchHeader(
    lines: string[],
    startIdx: number,
): { filePath: string; movePath?: string; nextIdx: number } | null {
    const line = lines[startIdx]

    if (line.startsWith("*** Add File:")) {
        const filePath = line.split(":", 2)[1]?.trim()
        return filePath ? { filePath, nextIdx: startIdx + 1 } : null
    }

    if (line.startsWith("*** Delete File:")) {
        const filePath = line.split(":", 2)[1]?.trim()
        return filePath ? { filePath, nextIdx: startIdx + 1 } : null
    }

    if (line.startsWith("*** Update File:")) {
        const filePath = line.split(":", 2)[1]?.trim()
        let movePath: string | undefined
        let nextIdx = startIdx + 1

        // Check for move directive
        if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
            movePath = lines[nextIdx].split(":", 2)[1]?.trim()
            nextIdx++
        }

        return filePath ? { filePath, movePath, nextIdx } : null
    }

    return null
}

function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
    const chunks: UpdateFileChunk[] = []
    let i = startIdx

    while (i < lines.length && !lines[i].startsWith("***")) {
        if (lines[i].startsWith("@@")) {
            // Parse context line
            const contextLine = lines[i].substring(2).trim()
            i++

            const oldLines: string[] = []
            const newLines: string[] = []
            let isEndOfFile = false

            // Parse change lines
            while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
                const changeLine = lines[i]

                if (changeLine === "*** End of File") {
                    isEndOfFile = true
                    i++
                    break
                }

                if (changeLine.startsWith(" ")) {
                    // Keep line - appears in both old and new
                    const content = changeLine.substring(1)
                    oldLines.push(content)
                    newLines.push(content)
                } else if (changeLine.startsWith("-")) {
                    // Remove line - only in old
                    oldLines.push(changeLine.substring(1))
                } else if (changeLine.startsWith("+")) {
                    // Add line - only in new
                    newLines.push(changeLine.substring(1))
                }

                i++
            }

            chunks.push({
                old_lines: oldLines,
                new_lines: newLines,
                change_context: contextLine || undefined,
                is_end_of_file: isEndOfFile || undefined,
            })
        } else {
            i++
        }
    }

    return { chunks, nextIdx: i }
}

function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
    let content = ""
    let i = startIdx

    while (i < lines.length && !lines[i].startsWith("***")) {
        if (lines[i].startsWith("+")) {
            content += lines[i].substring(1) + "\n"
        }
        i++
    }

    // Remove trailing newline
    if (content.endsWith("\n")) {
        content = content.slice(0, -1)
    }

    return { content, nextIdx: i }
}

export function parsePatch(patchText: string): { hunks: Hunk[] } {
    const lines = patchText.split("\n")
    const hunks: Hunk[] = []
    let i = 0

    // Look for Begin/End patch markers
    const beginMarker = "*** Begin Patch"
    const endMarker = "*** End Patch"

    const beginIdx = lines.findIndex((line) => line.trim() === beginMarker)
    const endIdx = lines.findIndex((line) => line.trim() === endMarker)

    if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
        throw new Error("Invalid patch format: missing Begin/End markers")
    }

    // Parse content between markers
    i = beginIdx + 1

    while (i < endIdx) {
        const header = parsePatchHeader(lines, i)
        if (!header) {
            i++
            continue
        }

        if (lines[i].startsWith("*** Add File:")) {
            const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
            hunks.push({
                type: "add",
                path: header.filePath,
                contents: content,
            })
            i = nextIdx
        } else if (lines[i].startsWith("*** Delete File:")) {
            hunks.push({
                type: "delete",
                path: header.filePath,
            })
            i = header.nextIdx
        } else if (lines[i].startsWith("*** Update File:")) {
            const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
            hunks.push({
                type: "update",
                path: header.filePath,
                move_path: header.movePath,
                chunks,
            })
            i = nextIdx
        } else {
            i++
        }
    }

    return { hunks }
}

export function maybeParseApplyPatch(
    argv: string[],
):
    | { type: MaybeApplyPatch.Body; args: ApplyPatchArgs }
    | { type: MaybeApplyPatch.PatchParseError; error: Error }
    | { type: MaybeApplyPatch.NotApplyPatch } {
    const APPLY_PATCH_COMMANDS = ["apply_patch", "applypatch"]

    // Direct invocation: apply_patch <patch>
    if (argv.length === 2 && APPLY_PATCH_COMMANDS.includes(argv[0])) {
        try {
            const { hunks } = parsePatch(argv[1])
            return {
                type: MaybeApplyPatch.Body,
                args: {
                    patch: argv[1],
                    hunks,
                },
            }
        } catch (error) {
            return {
                type: MaybeApplyPatch.PatchParseError,
                error: error as Error,
            }
        }
    }

    // Bash heredoc form: bash -lc 'apply_patch <<"EOF" ...'
    if (argv.length === 3 && argv[0] === "bash" && argv[1] === "-lc") {
        // Simple extraction - in real implementation would need proper bash parsing
        const script = argv[2]
        const heredocMatch = script.match(/apply_patch\s*<<['"](\w+)['"]\s*\n([\s\S]*?)\n\1/)

        if (heredocMatch) {
            const patchContent = heredocMatch[2]
            try {
                const { hunks } = parsePatch(patchContent)
                return {
                    type: MaybeApplyPatch.Body,
                    args: {
                        patch: patchContent,
                        hunks,
                    },
                }
            } catch (error) {
                return {
                    type: MaybeApplyPatch.PatchParseError,
                    error: error as Error,
                }
            }
        }
    }

    return { type: MaybeApplyPatch.NotApplyPatch }
}
