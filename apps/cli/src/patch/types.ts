import z from "zod"

// Schema definitions
export const PatchSchema = z.object({
    patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

export type PatchParams = z.infer<typeof PatchSchema>

// Core types matching the Rust implementation
export interface ApplyPatchArgs {
    patch: string
    hunks: Hunk[]
    workdir?: string
}

export type Hunk =
    | { type: "add"; path: string; contents: string }
    | { type: "delete"; path: string }
    | { type: "update"; path: string; move_path?: string; chunks: UpdateFileChunk[] }

export interface UpdateFileChunk {
    old_lines: string[]
    new_lines: string[]
    change_context?: string
    is_end_of_file?: boolean
}

export interface ApplyPatchAction {
    changes: Map<string, ApplyPatchFileChange>
    patch: string
    cwd: string
}

export type ApplyPatchFileChange =
    | { type: "add"; content: string }
    | { type: "delete"; content: string }
    | { type: "update"; unified_diff: string; move_path?: string; new_content: string }

export interface AffectedPaths {
    added: string[]
    modified: string[]
    deleted: string[]
}

export enum ApplyPatchError {
    ParseError = "ParseError",
    IoError = "IoError",
    ComputeReplacements = "ComputeReplacements",
    ImplicitInvocation = "ImplicitInvocation",
}

export enum MaybeApplyPatch {
    Body = "Body",
    ShellParseError = "ShellParseError",
    PatchParseError = "PatchParseError",
    NotApplyPatch = "NotApplyPatch",
}

export enum MaybeApplyPatchVerified {
    Body = "Body",
    ShellParseError = "ShellParseError",
    CorrectnessError = "CorrectnessError",
    NotApplyPatch = "NotApplyPatch",
}
