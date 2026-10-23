import { $ } from "bun"
import { Database } from "bun:sqlite"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { Log } from "@/util/util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "@/services/project/instance"
import { EnvPolicy } from "@/core/env/policy"
import { Storage } from "@/core/storage/storage"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  export const PATCH_FILE_LIMIT = 1_000
  export const DIFF_FILE_LIMIT = 500
  export const DIFF_CONTENT_LIMIT = 512 * 1024
  const environment = (overrides?: Record<string, string>) =>
    EnvPolicy.build({
      cwd: Instance.directory,
      scope: "snapshot",
      overrides: {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "gc.auto",
        GIT_CONFIG_VALUE_0: "0",
        GIT_CONFIG_KEY_1: "maintenance.auto",
        GIT_CONFIG_VALUE_1: "false",
        ...overrides,
      },
    })

  // SQLite releases the OS lock on crash. Busy acquisition yields instead of
  // blocking Bun's event loop while another snapshot operation awaits Git.
  async function locked<T>(projectID: string, body: () => Promise<T>): Promise<T> {
    if (!/^(global|budget|[a-f0-9]{40,64})$/.test(projectID)) throw new Error("Invalid snapshot project ID")
    const directory = path.join(Global.Path.data, "snapshot-locks")
    await fs.mkdir(directory, { recursive: true })
    const db = new Database(path.join(directory, `${projectID}.sqlite`), { create: true })
    const deadline = Date.now() + 30_000
    try {
      while (true) {
        try {
          db.run("BEGIN IMMEDIATE")
          break
        } catch (error) {
          if ((error as { code?: string }).code !== "SQLITE_BUSY" || Date.now() >= deadline) throw error
          await Bun.sleep(25)
        }
      }
      try {
        return await body()
      } finally {
        db.run("ROLLBACK")
      }
    } finally {
      db.close()
    }
  }

  async function pin(hash: string) {
    if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error("Snapshot tree creation failed")
    const ref = `refs/atomcli/recent/${Math.floor(Date.now() / 86_400_000)}/${hash}`
    await $`git --git-dir ${gitdir()} update-ref ${ref} ${hash}`.env(environment()).quiet()
  }

  const MAX_TREE_BYTES = 64 * 1024 * 1024
  const MAX_TREE_FILES = 10_000
  const RUNTIME_DIRECTORIES = new Set([".git", ".atomcli", ".claude", "node_modules", ".cache", ".dart_tool", ".venv"])

  async function stage() {
    // Cross-project admission: two writers cannot both spend the same budget.
    return locked("budget", async () => {
      const config = (await Config.get()).retention
      const limit = (config?.snapshot_mib ?? 1024) * 1024 * 1024
      const fileLimit = (config?.snapshot_file_mib ?? 2) * 1024 * 1024
      const root = path.join(Global.Path.data, "snapshot")
      let used = 0
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^(global|[a-f0-9]{40,64})$/.test(entry.name)) continue
        const output = await $`git --git-dir ${path.join(root, entry.name)} count-objects -v`
          .env(environment())
          .quiet()
          .text()
        for (const line of output.split("\n")) {
          const size = /^(?:size|size-pack): (\d+)$/.exec(line)
          if (size) used += Number(size[1]) * 1024
        }
      }
      const skip = (reason: string) => {
        log.warn("snapshot capture skipped; existing rollback retained", { reason, used, limit })
        return false
      }
      if (used >= limit) return skip("global snapshot budget reached")
      const output = await $`git --literal-pathspecs ls-files --cached --others --exclude-standard -z`
        .env(environment())
        .cwd(Instance.worktree)
        .quiet()
        .text()
      const files: string[] = []
      let bytes = 0
      const staging = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-snapshot-"))
      try {
        for (const file of new Set(output.split("\0").filter(Boolean))) {
          if (file.split("/").some((part) => RUNTIME_DIRECTORIES.has(part))) continue
          const target = path.resolve(Instance.worktree, file)
          const relative = path.relative(Instance.worktree, target)
          if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(file))
            throw new Error("Unsafe snapshot path")
          const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error
          })
          if (!stat || (!stat.isFile() && !stat.isSymbolicLink()) || stat.size > fileLimit) continue
          if (bytes + stat.size > MAX_TREE_BYTES || files.length >= MAX_TREE_FILES)
            return skip("snapshot tree limit reached")
          const staged = path.join(staging, file)
          await fs.mkdir(path.dirname(staged), { recursive: true })
          if (stat.isSymbolicLink()) {
            const link = await fs.readlink(target)
            await fs.symlink(link, staged)
            bytes += Buffer.byteLength(link)
          } else {
            const handle = await fs.open(target, "r")
            let content: ArrayBuffer
            try {
              content = await Bun.file(handle.fd)
                .slice(0, fileLimit + 1)
                .arrayBuffer()
            } finally {
              await handle.close()
            }
            if (content.byteLength > fileLimit) continue // A growing file cannot escape admission.
            await Bun.write(staged, content)
            await fs.chmod(staged, stat.mode & 0o777)
            bytes += content.byteLength
          }
          files.push(file)
          if (bytes > MAX_TREE_BYTES || files.length > MAX_TREE_FILES) return skip("snapshot tree limit reached")
        }
        // Reserve raw bytes plus loose-object/index overhead before Git writes.
        // ponytail: conservative admission may stop early; content-aware accounting can reclaim headroom later.
        if (used + bytes + files.length * 8192 + 65536 > limit) return skip("insufficient snapshot budget")
        const git = gitdir()
        await $`git --git-dir ${git} read-tree --empty`.env(environment()).quiet()
        if (files.length) {
          const child = Bun.spawn(
            [
              "git",
              "--literal-pathspecs",
              `--git-dir=${git}`,
              `--work-tree=${staging}`,
              "add",
              "--force", // Selection already honors the real repository index/ignores, including tracked ignored files.
              "--pathspec-from-file=-",
              "--pathspec-file-nul",
            ],
            {
              cwd: staging,
              env: environment({ GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull }),
              stdin: new Blob([files.join("\0") + "\0"]),
              stdout: "pipe",
              stderr: "pipe",
            },
          )
          const [, error, exit] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ])
          if (exit !== 0) throw new Error(`Snapshot staging failed (${exit}): ${error}`)
        }
      } finally {
        await fs.rm(staging, { recursive: true, force: true })
      }
      return true
    })
  }

  export async function track() {
    return locked(Instance.project.id, async () => {
      if (Instance.project.vcs !== "git") return
      const cfg = await Config.get()
      if (cfg.snapshot === false) return
      const git = gitdir()
      if (await fs.mkdir(git, { recursive: true })) {
        await $`git init`
          .env(environment({ GIT_DIR: git, GIT_WORK_TREE: Instance.worktree }))
          .quiet()
          .nothrow()
        // Configure git to not convert line endings on Windows
        await $`git --git-dir ${git} config core.autocrlf false`.env(environment()).quiet().nothrow()
        log.info("initialized")
      }
      if (!(await stage())) return
      const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
        .env(environment())
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()
      log.info("tracking", { hash, cwd: Instance.directory, git })
      await pin(hash.trim())
      return hash.trim()
    })
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
    after: z.string().optional(),
    total: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
  })
  export type Patch = z.infer<typeof Patch>

  async function scanChangedFiles(
    from: string,
    to: string,
    onFile: (file: string) => void | Promise<void>,
  ): Promise<{ exitCode: number; stderr: string }> {
    const git = gitdir()
    const process = Bun.spawn(
      [
        "git",
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.quotepath=false",
        `--git-dir=${git}`,
        `--work-tree=${Instance.worktree}`,
        "diff",
        "--no-ext-diff",
        "--name-only",
        "-z",
        from,
        to,
        "--",
        ".",
      ],
      {
        cwd: Instance.directory,
        env: environment(),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const stderr = new Response(process.stderr).text()
    const decoder = new TextDecoder()
    let pending = ""
    const reader = process.stdout.getReader()
    // `onFile` does filesystem work and can throw. Without this guard the git
    // child is orphaned holding an undrained stdout and stderr pipe, which is the
    // classic two-pipe deadlock, and the stderr promise is abandoned un-awaited.
    let completed = false
    try {
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        pending += decoder.decode(chunk, { stream: true })
        let separator = pending.indexOf("\0")
        while (separator !== -1) {
          // Git's `-z` output is NUL-delimited; never let delimiter bytes reach filesystem APIs.
          const file = pending.slice(0, separator).replace(/\0/g, "")
          pending = pending.slice(separator + 1)
          if (file) await onFile(file)
          separator = pending.indexOf("\0")
        }
      }
      pending += decoder.decode()
      if (pending) await onFile(pending.replace(/\0/g, ""))
      completed = true
    } finally {
      if (!completed) process.kill()
      reader.releaseLock()
    }
    return { exitCode: await process.exited, stderr: await stderr }
  }

  export async function patch(hash: string): Promise<Patch> {
    return locked(Instance.project.id, async () => {
      const git = gitdir()
      if (!(await stage())) return { hash, files: [] }
      const after = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
        .env(environment())
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()
        .then((value) => value.trim())
      await pin(after)
      const files: string[] = []
      let total = 0
      const result = await scanChangedFiles(hash, after, (file) => {
        total++
        if (files.length < PATCH_FILE_LIMIT) files.push(path.join(Instance.worktree, file))
      })

      // If git diff fails, return empty patch
      if (result.exitCode !== 0) {
        log.warn("failed to get diff", { hash, exitCode: result.exitCode, stderr: result.stderr })
        return { hash, files: [] }
      }

      return {
        hash,
        after,
        files,
        total,
        truncated: total > files.length || undefined,
      }
    })
  }

  export async function restore(snapshot: string) {
    return locked(Instance.project.id, async () => {
      log.info("restore", { commit: snapshot })
      const git = gitdir()
      const result =
        await $`git --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
          .env(environment())
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()

      if (result.exitCode !== 0) {
        log.error("failed to restore snapshot", {
          snapshot,
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
      }
    })
  }

  export async function revert(patches: Patch[]) {
    return locked(Instance.project.id, async () => {
      const git = gitdir()
      const restore = async (item: Patch, file: string) => {
        const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
          .env(environment())
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .env(environment())
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
      }

      // Apply patches newest-to-oldest. Repeated files naturally end at the state
      // preceding the earliest reverted patch without retaining an unbounded Set.
      for (const item of patches.toReversed()) {
        if (item.truncated) {
          if (!item.after) throw new Error(`Cannot revert truncated snapshot ${item.hash}: post-change tree is missing`)
          const result = await scanChangedFiles(item.hash, item.after, (file) =>
            restore(item, path.join(Instance.worktree, file)),
          )
          if (result.exitCode !== 0) {
            throw new Error(
              `Cannot revert truncated snapshot ${item.hash}: changed-file scan failed (${result.exitCode}) ${result.stderr}`,
            )
          }
          continue
        }
        for (const file of item.files) {
          await restore(item, file)
        }
      }
    })
  }

  export async function diff(hash: string) {
    return locked(Instance.project.id, async () => {
      const git = gitdir()
      if (!(await stage())) return ""
      const result =
        await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
          .env(environment())
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()

      if (result.exitCode !== 0) {
        log.warn("failed to get diff", {
          hash,
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
        return ""
      }

      return result.text().trim()
    })
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      truncated: z.boolean().optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(
    from: string,
    to: string,
    options: { fileLimit?: number; contentLimit?: number } = {},
  ): Promise<FileDiff[]> {
    return locked(Instance.project.id, async () => {
      const git = gitdir()
      const result: FileDiff[] = []
      const fileLimit = Math.max(0, options.fileLimit ?? DIFF_FILE_LIMIT)
      const contentLimit = Math.max(0, options.contentLimit ?? DIFF_CONTENT_LIMIT)
      const readContent = async (hash: string, file: string) => {
        const spec = `${hash}:${file}`
        const size = await $`git --git-dir ${git} cat-file -s ${spec}`
          .env(environment())
          .quiet()
          .nothrow()
          .text()
          .then((value) => Number(value.trim()))
        if (!Number.isFinite(size)) return { text: "", truncated: false }
        if (size > contentLimit) return { text: "", truncated: true }
        const text = await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${spec}`
          .env(environment())
          .quiet()
          .nothrow()
          .text()
        return { text, truncated: false }
      }
      for await (const line of $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
        .env(environment())
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .lines()) {
        if (!line) continue
        if (result.length >= fileLimit) continue
        const [additions, deletions, file] = line.split("\t")
        const isBinaryFile = additions === "-" && deletions === "-"
        const before = isBinaryFile ? { text: "", truncated: false } : await readContent(from, file)
        const after = isBinaryFile ? { text: "", truncated: false } : await readContent(to, file)
        const added = isBinaryFile ? 0 : parseInt(additions)
        const deleted = isBinaryFile ? 0 : parseInt(deletions)
        result.push({
          file,
          before: before.text,
          after: after.text,
          additions: Number.isFinite(added) ? added : 0,
          deletions: Number.isFinite(deleted) ? deleted : 0,
          truncated: before.truncated || after.truncated || undefined,
        })
      }
      return result
    })
  }

  export async function collectGarbage(options: { dryRun: boolean; olderThan: number; projectID?: string }) {
    if (!Number.isFinite(options.olderThan) || options.olderThan > Date.now() - 3_600_000) {
      throw new Error("Snapshot GC requires at least one hour of orphan grace")
    }
    const projectID = options.projectID ?? Instance.project.id
    return locked(projectID, async () => {
      const git = gitdir(projectID)
      const stat = await fs.lstat(git).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
      })
      if (!stat) return { present: false, retainedTrees: 0, expiredPins: 0, applied: false }
      if (!stat.isDirectory()) throw new Error("Snapshot repository must not be a symlink")
      const ledgerFile = path.join(Global.Path.data, "execution-ledger.sqlite")
      if (await Bun.file(ledgerFile).exists()) {
        const ledger = new Database(ledgerFile, { readonly: true })
        try {
          const unfinished = ledger
            .query<{ present: number }, [string]>(
              `SELECT 1 AS present FROM execution e WHERE project_id = ? AND deleted_at IS NULL
             AND (lifecycle != 'terminal' OR EXISTS (
               SELECT 1 FROM execution_work w WHERE w.execution_id = e.id AND w.state IN ('draining', 'unknown')
             )) LIMIT 1`,
            )
            .get(projectID)
          if (unfinished) throw new Error("Snapshot GC postponed: unfinished or uncertain project execution")
        } finally {
          ledger.close()
        }
      }
      // Import every retained legacy root BEFORE allowing Git to prune anything.
      for (const relative of ["objects", "objects/pack", "refs"]) {
        const entry = await fs.lstat(path.join(git, relative)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error
        })
        if (entry && !entry.isDirectory()) throw new Error("Snapshot internal directories must not be symlinks")
      }
      const roots = await Storage.snapshotRoots(projectID)
      const refs = await $`git --git-dir ${git} for-each-ref --format='%(refname)' refs/atomcli/`
        .env(environment())
        .quiet()
        .text()
      const expired = refs
        .trim()
        .split("\n")
        .filter((ref) => {
          const recent = /^refs\/atomcli\/recent\/(\d+)\/[a-f0-9]{40,64}$/.exec(ref)
          if (recent) return (Number(recent[1]) + 1) * 86_400_000 < options.olderThan
          const retained = /^refs\/atomcli\/retained\/([a-f0-9]{40,64})$/.exec(ref)
          return retained && !roots.has(retained[1])
        })
      const result = { present: true, retainedTrees: roots.size, expiredPins: expired.length, applied: false }
      // Even preview validates every root. A missing object blocks the whole cleanup.
      if (roots.size) {
        const checker = Bun.spawn(["git", "--git-dir", git, "cat-file", "--batch-check"], {
          env: environment(),
          stdin: new Blob([[...roots].join("\n") + "\n"]),
          stdout: "pipe",
          stderr: "pipe",
        })
        const [output, errors, exit] = await Promise.all([
          new Response(checker.stdout).text(),
          new Response(checker.stderr).text(),
          checker.exited,
        ])
        if (
          exit !== 0 ||
          output
            .trim()
            .split("\n")
            .some((line) => !/^[a-f0-9]{40,64} tree \d+$/.test(line))
        ) {
          throw new Error(`Retained snapshot trees cannot be verified; cleanup refused (${exit}): ${errors}`)
        }
      }
      if (options.dryRun) return result
      const commands = [
        ...[...roots].map((hash) => `update refs/atomcli/retained/${hash} ${hash}`),
        ...expired.map((ref) => `delete ${ref}`),
      ]
      if (commands.length) {
        const updater = Bun.spawn(["git", "--git-dir", git, "update-ref", "--stdin"], {
          env: environment(),
          stdin: new Blob(["start\n" + commands.join("\n") + "\nprepare\ncommit\n"]),
          stdout: "pipe",
          stderr: "pipe",
        })
        const [, error, exit] = await Promise.all([
          new Response(updater.stdout).text(),
          new Response(updater.stderr).text(),
          updater.exited,
        ])
        if (exit !== 0) throw new Error(`Snapshot root publication failed (${exit}): ${error}`)
      }
      const cutoff = new Date(options.olderThan).toISOString()
      await $`git --git-dir ${git} -c gc.autoDetach=false gc --prune=${cutoff}`.env(environment()).quiet()
      return { ...result, applied: true }
    })
  }

  function gitdir(projectID = Instance.project.id) {
    return path.join(Global.Path.data, "snapshot", projectID)
  }
}
