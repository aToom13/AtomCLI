import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import type { Position, TextEdit, WorkspaceEdit } from "vscode-languageserver-types"
import { FileTime } from "@/services/file/time"
import { FileEvent } from "@/services/file/event"
import { Bus } from "@/core/bus"

const MAX_WORKSPACE_EDIT_FILES = 200
const MAX_WORKSPACE_EDIT_BYTES = 20 * 1024 * 1024

type FileState = {
  exists: boolean
  content: string
  mode?: number
}

type ResourceOperation =
  | { kind: "create"; path: string }
  | { kind: "rename"; oldPath: string; newPath: string; overwrite: boolean }
  | { kind: "delete"; path: string }

export namespace LSPWorkspaceEdit {
  export type AdditionalRename = {
    oldPath: string
    newPath: string
  }

  export type Authorization = {
    paths: string[]
    summary: string
    textEdits: number
    resourceOperations: number
  }

  export type Result = Authorization & {
    changedFiles: string[]
  }

  export async function apply(input: {
    edit: WorkspaceEdit
    sessionID: string
    additionalRenames?: AdditionalRename[]
    version?(filePath: string): number | undefined | Promise<number | undefined>
    authorize(input: Authorization): Promise<void>
  }): Promise<Result> {
    const originals = new Map<string, FileState>()
    const current = new Map<string, FileState>()
    const resources: ResourceOperation[] = []
    let textEditCount = 0

    const normalize = (filePath: string) => path.normalize(path.resolve(filePath))
    const fromUri = (uri: string) => {
      const parsed = new URL(uri)
      if (parsed.protocol !== "file:") throw new Error(`Workspace edit supports only file:// URIs: ${uri}`)
      return normalize(fileURLToPath(parsed))
    }
    const load = async (filePath: string) => {
      const target = normalize(filePath)
      const cached = current.get(target)
      if (cached) return cached
      const stat = await fs.lstat(target).catch(() => undefined)
      if (stat?.isDirectory()) throw new Error(`Workspace edit cannot modify directory content directly: ${target}`)
      if (stat?.isSymbolicLink()) throw new Error(`Workspace edit refuses symbolic-link targets: ${target}`)
      const state: FileState = stat
        ? { exists: true, content: await Bun.file(target).text(), mode: stat.mode }
        : { exists: false, content: "" }
      originals.set(target, { ...state })
      current.set(target, { ...state })
      return current.get(target)!
    }

    const applyTextDocument = async (uri: string, edits: TextEdit[], version?: number | null) => {
      const target = fromUri(uri)
      const state = await load(target)
      if (!state.exists) throw new Error(`Workspace edit targets a missing file: ${target}`)
      if (version !== undefined && version !== null) {
        const actual = await input.version?.(target)
        if (actual === undefined || actual !== version) {
          throw new Error(
            `Stale LSP workspace edit for ${target}: expected document version ${version}, current version ${actual ?? "unknown"}`,
          )
        }
      }
      state.content = applyTextEdits(state.content, edits, target)
      textEditCount += edits.length
    }

    if (input.edit.changes && input.edit.documentChanges) {
      throw new Error("Invalid LSP workspace edit: changes and documentChanges cannot be combined")
    }
    for (const [uri, edits] of Object.entries(input.edit.changes ?? {})) {
      await applyTextDocument(uri, edits)
    }
    for (const change of input.edit.documentChanges ?? []) {
      if ("textDocument" in change) {
        await applyTextDocument(change.textDocument.uri, change.edits as TextEdit[], change.textDocument.version)
        continue
      }
      if (change.kind === "create") {
        const target = fromUri(change.uri)
        const state = await load(target)
        if (state.exists && !change.options?.overwrite) {
          if (change.options?.ignoreIfExists) continue
          throw new Error(`Workspace edit create target already exists: ${target}`)
        }
        state.exists = true
        state.content = ""
        resources.push({ kind: "create", path: target })
        continue
      }
      if (change.kind === "rename") {
        await planRename(
          fromUri(change.oldUri),
          fromUri(change.newUri),
          !!change.options?.overwrite,
          !!change.options?.ignoreIfExists,
        )
        continue
      }
      if (change.kind === "delete") {
        const target = fromUri(change.uri)
        const state = await load(target)
        if (!state.exists) {
          if (change.options?.ignoreIfNotExists) continue
          throw new Error(`Workspace edit delete target does not exist: ${target}`)
        }
        state.exists = false
        resources.push({ kind: "delete", path: target })
      }
    }
    for (const rename of input.additionalRenames ?? []) {
      await planRename(normalize(rename.oldPath), normalize(rename.newPath), false, false)
    }

    async function planRename(oldPath: string, newPath: string, overwrite: boolean, ignoreIfExists: boolean) {
      if (oldPath === newPath) throw new Error("Workspace edit rename source and destination are identical")
      const source = await load(oldPath)
      const destination = await load(newPath)
      if (!source.exists) throw new Error(`Workspace edit rename source does not exist: ${oldPath}`)
      if (destination.exists && !overwrite) {
        if (ignoreIfExists) return
        throw new Error(`Workspace edit rename destination already exists: ${newPath}`)
      }
      destination.exists = true
      destination.content = source.content
      destination.mode = source.mode
      source.exists = false
      resources.push({ kind: "rename", oldPath, newPath, overwrite })
    }

    const paths = [...new Set([...originals.keys(), ...current.keys()])].sort()
    if (paths.length > MAX_WORKSPACE_EDIT_FILES) {
      throw new Error(`LSP workspace edit exceeds the ${MAX_WORKSPACE_EDIT_FILES}-file limit`)
    }
    const totalBytes = [...current.values()].reduce(
      (total, state) => total + (state.exists ? Buffer.byteLength(state.content) : 0),
      0,
    )
    if (totalBytes > MAX_WORKSPACE_EDIT_BYTES) {
      throw new Error(`LSP workspace edit exceeds the ${MAX_WORKSPACE_EDIT_BYTES}-byte limit`)
    }
    const changedFiles = paths.filter((filePath) => !sameState(originals.get(filePath)!, current.get(filePath)!))
    if (changedFiles.length === 0) throw new Error("LSP returned an empty workspace edit")
    const authorization: Authorization = {
      paths: changedFiles,
      summary: changedFiles
        .map((filePath) => {
          const before = originals.get(filePath)!
          const after = current.get(filePath)!
          const kind = !before.exists ? "A" : !after.exists ? "D" : "M"
          return `${kind} ${filePath} (${Buffer.byteLength(before.content)} -> ${Buffer.byteLength(after.content)} bytes)`
        })
        .join("\n"),
      textEdits: textEditCount,
      resourceOperations: resources.length,
    }

    return withLocks(paths, async () => {
      await assertUnchanged(originals)
      await input.authorize(authorization)
      await assertUnchanged(originals)
      try {
        for (const resource of resources) {
          if (resource.kind === "create") {
            await fs.mkdir(path.dirname(resource.path), { recursive: true })
            continue
          }
          if (resource.kind === "rename") {
            await fs.mkdir(path.dirname(resource.newPath), { recursive: true })
            if (resource.overwrite) await fs.unlink(resource.newPath).catch(() => {})
            await fs.rename(resource.oldPath, resource.newPath)
            continue
          }
          await fs.unlink(resource.path)
        }
        for (const filePath of changedFiles) {
          const desired = current.get(filePath)!
          if (!desired.exists) {
            await fs.unlink(filePath).catch(() => {})
            continue
          }
          await fs.mkdir(path.dirname(filePath), { recursive: true })
          await Bun.write(filePath, desired.content)
          if (desired.mode !== undefined) await fs.chmod(filePath, desired.mode)
        }
      } catch (error) {
        const rollbackErrors = await rollback(paths, originals)
        if (rollbackErrors.length > 0) {
          throw new Error(`LSP workspace edit failed and rollback was incomplete: ${rollbackErrors.join("; ")}`, {
            cause: error,
          })
        }
        throw new Error("LSP workspace edit failed; all file changes were rolled back", { cause: error })
      }
      for (const filePath of changedFiles) {
        await Bus.publish(FileEvent.Edited, { file: filePath })
        if (current.get(filePath)?.exists) FileTime.read(input.sessionID, filePath)
      }
      return { ...authorization, changedFiles }
    })
  }

  function applyTextEdits(content: string, edits: TextEdit[], filePath: string) {
    const resolved = edits.map((edit, index) => {
      const start = positionOffset(content, edit.range.start, filePath)
      const end = positionOffset(content, edit.range.end, filePath)
      if (start > end) throw new Error(`Invalid LSP text edit range in ${filePath} at edit ${index}`)
      return { start, end, newText: edit.newText, index }
    })
    resolved.sort((a, b) => b.start - a.start || b.end - a.end)
    for (let index = 1; index < resolved.length; index++) {
      const previous = resolved[index - 1]
      const current = resolved[index]
      if (current.end > previous.start || current.start === previous.start) {
        throw new Error(`Overlapping LSP text edits in ${filePath} at edits ${current.index} and ${previous.index}`)
      }
    }
    let output = content
    for (const edit of resolved) {
      output = output.slice(0, edit.start) + edit.newText + output.slice(edit.end)
    }
    return output
  }

  function positionOffset(content: string, position: Position, filePath: string) {
    if (
      !Number.isInteger(position.line) ||
      !Number.isInteger(position.character) ||
      position.line < 0 ||
      position.character < 0
    ) {
      throw new Error(`Invalid LSP position for ${filePath}`)
    }
    const lines = content.split("\n")
    const line = lines[position.line]
    if (line === undefined) throw new Error(`LSP line ${position.line} is outside ${filePath}`)
    const lineLength = line.endsWith("\r") ? line.length - 1 : line.length
    if (position.character > lineLength) {
      throw new Error(`LSP character ${position.character} is outside line ${position.line} in ${filePath}`)
    }
    let offset = 0
    for (let index = 0; index < position.line; index++) offset += lines[index].length + 1
    return offset + position.character
  }

  function sameState(left: FileState, right: FileState) {
    return left.exists === right.exists && left.content === right.content
  }

  async function assertUnchanged(originals: Map<string, FileState>) {
    for (const [filePath, expected] of originals) {
      const stat = await fs.lstat(filePath).catch(() => undefined)
      if (stat?.isSymbolicLink() || stat?.isDirectory()) {
        throw new Error(`Stale LSP workspace edit: target type changed for ${filePath}`)
      }
      const exists = !!stat
      const content = exists ? await Bun.file(filePath).text() : ""
      if (exists !== expected.exists || content !== expected.content) {
        throw new Error(`Stale LSP workspace edit: ${filePath} changed before apply`)
      }
    }
  }

  async function withLocks<T>(paths: string[], callback: () => Promise<T>, index = 0): Promise<T> {
    if (index >= paths.length) return callback()
    return FileTime.withLock(paths[index], () => withLocks(paths, callback, index + 1))
  }

  async function rollback(paths: string[], originals: Map<string, FileState>) {
    const errors: string[] = []
    for (const filePath of [...paths].reverse()) {
      try {
        const original = originals.get(filePath)!
        const stat = await fs.lstat(filePath).catch(() => undefined)
        if (stat && !stat.isDirectory()) await fs.unlink(filePath)
        if (original.exists) {
          await fs.mkdir(path.dirname(filePath), { recursive: true })
          await Bun.write(filePath, original.content)
          if (original.mode !== undefined) await fs.chmod(filePath, original.mode)
        }
      } catch (error) {
        errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return errors
  }
}
