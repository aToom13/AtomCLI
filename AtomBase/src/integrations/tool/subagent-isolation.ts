import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "@/services/project/instance"
import { Lock } from "@/util/util/lock"

const MAX_ISOLATED_FILES = 200
const MAX_PATCH_BYTES = 20 * 1024 * 1024

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export namespace SubAgentIsolation {
  export type Preview = {
    baseCommit: string
    resultTree: string
    changedFiles: string[]
    patch: string
    patchBytes: number
  }

  export type Applied = Omit<Preview, "patch"> & {
    applied: boolean
  }

  export type Workspace = {
    directory: string
    root: string
    parentRoot: string
    preview(): Promise<Preview>
    apply(owns?: string[]): Promise<Applied>
    dispose(): Promise<void>
  }

  export async function create(name: string): Promise<Workspace> {
    if (Instance.project.vcs !== "git") {
      throw new Error("Isolated write-capable sub-agents require a git worktree")
    }
    const parentRoot = path.resolve(Instance.worktree)
    const parentDirectory = path.resolve(Instance.directory)
    const relativeDirectory = path.relative(parentRoot, parentDirectory)
    if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
      throw new Error("Current directory is outside the project worktree")
    }
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-subagent-"))
    const workspaceRoot = path.join(tempRoot, "workspace")
    const indexFile = path.join(tempRoot, "baseline.index")
    let registered = false
    let disposed = false

    try {
      const base = await snapshot(parentRoot, indexFile)
      const head = await runGit(parentRoot, ["rev-parse", "HEAD"])
      assertSuccess(head, "read repository HEAD")
      const commit = await runGit(parentRoot, [
        "-c",
        "user.name=AtomCLI Subagent",
        "-c",
        "user.email=subagent@atomcli.local",
        "commit-tree",
        base.tree,
        "-p",
        head.stdout.trim(),
        "-m",
        `AtomCLI isolated baseline: ${safeName(name)}`,
      ])
      assertSuccess(commit, "create isolated baseline commit")
      using _lock = await Lock.write(`subagent-worktree:${parentRoot}`)
      const added = await runGit(parentRoot, ["worktree", "add", "--detach", workspaceRoot, commit.stdout.trim()])
      assertSuccess(added, "create isolated worktree")
      registered = true

      const baseCommit = commit.stdout.trim()
      const directory = path.join(workspaceRoot, relativeDirectory)
      const buildPreview = () => preview(workspaceRoot, baseCommit)

      return {
        directory,
        root: workspaceRoot,
        parentRoot,
        preview: buildPreview,
        async apply(owns = []) {
          const result = await buildPreview()
          assertOwnership(parentRoot, result.changedFiles, owns)
          if (result.changedFiles.length === 0) return withoutPatch(result, false)

          using _merge = await Lock.write(`subagent-merge:${parentRoot}`)
          const currentIndex = path.join(tempRoot, "current.index")
          const current = await snapshot(parentRoot, currentIndex)
          const conflicts = await changedBetween(parentRoot, baseCommit, current.tree, result.changedFiles)
          if (conflicts.length > 0) {
            throw new Error(`Isolated sub-agent merge conflict: parent changed ${conflicts.join(", ")}`)
          }

          const patchFile = path.join(tempRoot, "result.patch")
          await Bun.write(patchFile, result.patch)
          const checked = await runGit(parentRoot, ["apply", "--check", "--binary", patchFile])
          assertSuccess(checked, "validate isolated sub-agent patch")
          const applied = await runGit(parentRoot, ["apply", "--binary", patchFile])
          assertSuccess(applied, "apply isolated sub-agent patch")
          return withoutPatch(result, true)
        },
        async dispose() {
          if (disposed) return
          disposed = true
          await Instance.provide({ directory, fn: () => Instance.dispose() }).catch(() => {})
          if (registered) {
            using _lock = await Lock.write(`subagent-worktree:${parentRoot}`)
            await runGit(parentRoot, ["worktree", "remove", "--force", workspaceRoot])
            await runGit(parentRoot, ["worktree", "prune"])
          }
          await fs.rm(tempRoot, { recursive: true, force: true })
        },
      }
    } catch (error) {
      if (registered) await runGit(parentRoot, ["worktree", "remove", "--force", workspaceRoot]).catch(() => undefined)
      await fs.rm(tempRoot, { recursive: true, force: true })
      throw error
    }
  }

  async function preview(root: string, baseCommit: string): Promise<Preview> {
    const staged = await runGit(root, ["add", "-A", "--", "."])
    assertSuccess(staged, "stage isolated worktree result")
    const tree = await runGit(root, ["write-tree"])
    assertSuccess(tree, "create isolated result tree")
    const names = await runGit(root, ["diff", "--cached", "--name-only", "--no-renames", "-z", baseCommit, "--"])
    assertSuccess(names, "list isolated changes")
    const changedFiles = names.stdout.split("\0").filter(Boolean).sort()
    if (changedFiles.length > MAX_ISOLATED_FILES) {
      throw new Error(`Isolated sub-agent changed more than ${MAX_ISOLATED_FILES} files`)
    }
    const patch = await runGit(root, [
      "diff",
      "--cached",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-renames",
      baseCommit,
      "--",
    ])
    assertSuccess(patch, "build isolated sub-agent patch")
    const patchBytes = Buffer.byteLength(patch.stdout)
    if (patchBytes > MAX_PATCH_BYTES) {
      throw new Error(`Isolated sub-agent patch exceeds the ${MAX_PATCH_BYTES}-byte limit`)
    }
    return {
      baseCommit,
      resultTree: tree.stdout.trim(),
      changedFiles,
      patch: patch.stdout,
      patchBytes,
    }
  }

  async function snapshot(root: string, indexFile: string) {
    await fs.unlink(indexFile).catch(() => {})
    const env = { GIT_INDEX_FILE: indexFile }
    const read = await runGit(root, ["read-tree", "HEAD"], env)
    assertSuccess(read, "initialize isolated snapshot index")
    const add = await runGit(root, ["add", "-A", "--", "."], env)
    assertSuccess(add, "snapshot current worktree")
    const tree = await runGit(root, ["write-tree"], env)
    assertSuccess(tree, "write current worktree tree")
    return { tree: tree.stdout.trim() }
  }

  async function changedBetween(root: string, from: string, to: string, files: string[]) {
    if (files.length === 0) return []
    const result = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", from, to, "--", ...files])
    assertSuccess(result, "detect isolated merge conflicts")
    return result.stdout.split("\0").filter(Boolean).sort()
  }

  function assertOwnership(root: string, files: string[], owns: string[]) {
    if (owns.length === 0) return
    const prefixes = owns.map((claimed) => {
      const absolute = path.resolve(root, claimed)
      if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Invalid task ownership path outside worktree: ${claimed}`)
      }
      return path.relative(root, absolute).split(path.sep).join("/")
    })
    const outside = files.filter(
      (file) => !prefixes.some((prefix) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`)),
    )
    if (outside.length > 0) {
      throw new Error(`Isolated sub-agent edited files outside its owns boundary: ${outside.join(", ")}`)
    }
  }

  function withoutPatch(result: Preview, applied: boolean): Applied {
    return {
      baseCommit: result.baseCommit,
      resultTree: result.resultTree,
      changedFiles: result.changedFiles,
      patchBytes: result.patchBytes,
      applied,
    }
  }

  function safeName(value: string) {
    return value.replace(/[\r\n\0]/g, " ").slice(0, 120)
  }

  function assertSuccess(result: CommandResult, action: string) {
    if (result.exitCode === 0) return
    throw new Error(
      `Failed to ${action}: ${result.stderr.trim() || result.stdout.trim() || `git exited ${result.exitCode}`}`,
    )
  }

  async function runGit(cwd: string, args: string[], overrides: Record<string, string> = {}): Promise<CommandResult> {
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...overrides }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )
    const child = Bun.spawn(["git", ...args], {
      cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exitCode }
  }
}
