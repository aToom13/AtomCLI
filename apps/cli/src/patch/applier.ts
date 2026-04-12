import * as path from "path"
import * as fs from "fs/promises"
import { Log } from "../util/log"
import type {
    AffectedPaths,
    ApplyPatchAction,
    ApplyPatchFileChange,
    Hunk,
} from "./types"
import {
    ApplyPatchError,
    MaybeApplyPatch,
    MaybeApplyPatchVerified,
} from "./types"
import { parsePatch, maybeParseApplyPatch } from "./parser"
import { deriveNewContentsFromChunks } from "./logic"

const log = Log.create({ service: "patch" })

// Apply hunks to filesystem
export async function applyHunksToFiles(hunks: Hunk[]): Promise<AffectedPaths> {
    if (hunks.length === 0) {
        throw new Error("No files were modified.")
    }

    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    for (const hunk of hunks) {
        switch (hunk.type) {
            case "add":
                // Create parent directories
                const addDir = path.dirname(hunk.path)
                if (addDir !== "." && addDir !== "/") {
                    await fs.mkdir(addDir, { recursive: true })
                }

                await fs.writeFile(hunk.path, hunk.contents, "utf-8")
                added.push(hunk.path)
                log.info(`Added file: ${hunk.path}`)
                break

            case "delete":
                await fs.unlink(hunk.path)
                deleted.push(hunk.path)
                log.info(`Deleted file: ${hunk.path}`)
                break

            case "update":
                const fileUpdate = deriveNewContentsFromChunks(hunk.path, hunk.chunks)

                if (hunk.move_path) {
                    // Handle file move
                    const moveDir = path.dirname(hunk.move_path)
                    if (moveDir !== "." && moveDir !== "/") {
                        await fs.mkdir(moveDir, { recursive: true })
                    }

                    await fs.writeFile(hunk.move_path, fileUpdate.content, "utf-8")
                    await fs.unlink(hunk.path)
                    modified.push(hunk.move_path)
                    log.info(`Moved file: ${hunk.path} -> ${hunk.move_path}`)
                } else {
                    // Regular update
                    await fs.writeFile(hunk.path, fileUpdate.content, "utf-8")
                    modified.push(hunk.path)
                    log.info(`Updated file: ${hunk.path}`)
                }
                break
        }
    }

    return { added, modified, deleted }
}

// Main patch application function
export async function applyPatch(patchText: string): Promise<AffectedPaths> {
    const { hunks } = parsePatch(patchText)
    return applyHunksToFiles(hunks)
}

// Async version of maybeParseApplyPatchVerified
export async function maybeParseApplyPatchVerified(
    argv: string[],
    cwd: string,
): Promise<
    | { type: MaybeApplyPatchVerified.Body; action: ApplyPatchAction }
    | { type: MaybeApplyPatchVerified.CorrectnessError; error: Error }
    | { type: MaybeApplyPatchVerified.NotApplyPatch }
> {
    // Detect implicit patch invocation (raw patch without apply_patch command)
    if (argv.length === 1) {
        try {
            parsePatch(argv[0])
            return {
                type: MaybeApplyPatchVerified.CorrectnessError,
                error: new Error(ApplyPatchError.ImplicitInvocation),
            }
        } catch {
            // Not a patch, continue
        }
    }

    const result = maybeParseApplyPatch(argv)

    switch (result.type) {
        case MaybeApplyPatch.Body:
            const { args } = result
            const effectiveCwd = args.workdir ? path.resolve(cwd, args.workdir) : cwd
            const changes = new Map<string, ApplyPatchFileChange>()

            for (const hunk of args.hunks) {
                const resolvedPath = path.resolve(
                    effectiveCwd,
                    hunk.type === "update" && hunk.move_path ? hunk.move_path : hunk.path,
                )

                switch (hunk.type) {
                    case "add":
                        changes.set(resolvedPath, {
                            type: "add",
                            content: hunk.contents,
                        })
                        break

                    case "delete":
                        // For delete, we need to read the current content
                        const deletePath = path.resolve(effectiveCwd, hunk.path)
                        try {
                            const content = await fs.readFile(deletePath, "utf-8")
                            changes.set(resolvedPath, {
                                type: "delete",
                                content,
                            })
                        } catch (error) {
                            return {
                                type: MaybeApplyPatchVerified.CorrectnessError,
                                error: new Error(`Failed to read file for deletion: ${deletePath}`),
                            }
                        }
                        break

                    case "update":
                        const updatePath = path.resolve(effectiveCwd, hunk.path)
                        try {
                            const fileUpdate = deriveNewContentsFromChunks(updatePath, hunk.chunks)
                            changes.set(resolvedPath, {
                                type: "update",
                                unified_diff: fileUpdate.unified_diff,
                                move_path: hunk.move_path ? path.resolve(effectiveCwd, hunk.move_path) : undefined,
                                new_content: fileUpdate.content,
                            })
                        } catch (error) {
                            return {
                                type: MaybeApplyPatchVerified.CorrectnessError,
                                error: error as Error,
                            }
                        }
                        break
                }
            }

            return {
                type: MaybeApplyPatchVerified.Body,
                action: {
                    changes,
                    patch: args.patch,
                    cwd: effectiveCwd,
                },
            }

        case MaybeApplyPatch.PatchParseError:
            return {
                type: MaybeApplyPatchVerified.CorrectnessError,
                error: result.error,
            }

        case MaybeApplyPatch.NotApplyPatch:
            return { type: MaybeApplyPatchVerified.NotApplyPatch }
    }
}
