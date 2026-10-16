import path from "path"
import fs from "fs"
import z from "zod"
import { Instance } from "@/services/project/instance"
import { Identifier } from "@/core/id/id"
import type { Tool } from "../tool"

function contains(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function canonicalPath(target: string) {
  let current = target
  const suffix: string[] = []
  while (true) {
    try {
      const real = fs.realpathSync(current)
      return path.join(real, ...suffix.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      // A dangling link is not a new path; fail closed instead of resolving its parent.
      if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
        throw new Error(`Task ownership path has a dangling symlink: ${target}`)
      const parent = path.dirname(current)
      if (parent === current) return target
      suffix.push(path.basename(current))
      current = parent
    }
  }
}

function assertLiteralClaim(claimed: string) {
  if (/[?*\[]/.test(claimed)) {
    throw new Error(
      `Task ownership paths are literal prefixes, not glob patterns: ${claimed}. List each exact file or use a shared literal prefix.`,
    )
  }
}

/**
 * A session can run outside its project's VCS worktree (for example `/tmp`).
 * In that case the session directory is the workspace boundary. When it is
 * inside a project, retain the project worktree boundary.
 */
export function activeOwnershipRoot() {
  const directory = path.resolve(Instance.directory)
  const worktree = path.resolve(Instance.worktree)
  return Instance.project.vcs === "git" && contains(worktree, directory) ? worktree : directory
}

export function normalizeOwnership(claimed: string, worktree = activeOwnershipRoot()) {
  assertLiteralClaim(claimed)
  return normalizePath(claimed, worktree)
}

function normalizePath(claimed: string, worktree: string) {
  if (claimed.includes("\0")) throw new Error("Task ownership paths cannot contain NUL bytes")
  const root = path.resolve(worktree)
  const absolute = path.resolve(root, claimed)
  if (!contains(root, absolute)) {
    throw new Error(
      `Task ownership path is outside the active workspace (${root}): ${claimed}. Use owns paths within this workspace; do not switch projects to bypass this boundary.`,
    )
  }
  if (!contains(canonicalPath(root), canonicalPath(absolute))) {
    throw new Error(`Task ownership path leaves the workspace through a symlink: ${claimed}`)
  }
  return path.relative(root, absolute).split(path.sep).join("/")
}

export function canonicalOwnership(claimed: string, root = activeOwnershipRoot()) {
  normalizeOwnership(claimed, root)
  return path
    .relative(canonicalPath(root), canonicalPath(path.resolve(root, claimed)))
    .split(path.sep)
    .join("/")
}

export function ownershipOverlaps(left: string, right: string) {
  return left === "" || right === "" || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

export namespace WorkflowOwnership {
  export const Scope = z.object({ root: z.string(), owns: z.array(z.string()).min(1) })
  export type Scope = z.infer<typeof Scope>

  export async function scope(sessionID: string): Promise<Scope | undefined> {
    if (!Identifier.schema("session").safeParse(sessionID).success) return
    const { Session } = await import("@/core/session")
    const { Storage } = await import("@/core/storage/storage")
    const session = await Session.get(sessionID).catch((error) => {
      if (error instanceof Storage.NotFoundError) return undefined
      throw error
    })
    if (!session?.metadata?.workflowOwnership) return
    return Scope.parse(session.metadata.workflowOwnership)
  }

  export function assertPath(scope: Scope, file: string) {
    const supplied = normalizePath(file, scope.root)
    const resolved = normalizePath(canonicalPath(path.resolve(scope.root, file)), canonicalPath(scope.root))
    for (const normalized of [supplied, resolved]) {
      if (!scope.owns.some((owned) => owned === "" || normalized === owned || normalized.startsWith(`${owned}/`)))
        throw new Error(`Write path is outside task ownership: ${file}`)
    }
  }

  export function permissionTarget(file: string, permission: string) {
    const real = canonicalPath(path.resolve(Instance.directory, file))
    return permission === "read" ? real : path.relative(Instance.worktree, real)
  }

  export async function guard(tool: string, args: any, ctx: Tool.Context, writes: boolean) {
    if (!writes || tool === "bash") return
    const owned = await scope(ctx.sessionID)
    if (!owned) return
    if (!["write", "edit"].includes(tool))
      throw new Error(`Owned shared-workspace tasks must write with edit/write; ${tool} cannot enforce file ownership`)
    assertPath(owned, path.resolve(Instance.directory, args.filePath))
    return owned
  }
}
