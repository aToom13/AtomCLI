import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "@/util/util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "@/services/project/instance"
import { EnvPolicy } from "@/core/env/policy"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  export const PATCH_FILE_LIMIT = 1_000
  export const DIFF_FILE_LIMIT = 500
  export const DIFF_CONTENT_LIMIT = 512 * 1024
  const environment = (overrides?: Record<string, string>) =>
    EnvPolicy.build({ cwd: Instance.directory, scope: "snapshot", overrides })

  export async function track() {
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
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.env(environment()).quiet().cwd(Instance.directory).nothrow()
    const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .env(environment())
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
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
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      pending += decoder.decode(chunk, { stream: true })
      let separator = pending.indexOf("\0")
      while (separator !== -1) {
        const file = pending.slice(0, separator)
        pending = pending.slice(separator + 1)
        if (file) await onFile(file)
        separator = pending.indexOf("\0")
      }
    }
    pending += decoder.decode()
    if (pending) await onFile(pending)
    return { exitCode: await process.exited, stderr: await stderr }
  }

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.env(environment()).quiet().cwd(Instance.directory).nothrow()
    const after = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .env(environment())
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
      .then((value) => value.trim())
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
  }

  export async function restore(snapshot: string) {
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
  }

  export async function revert(patches: Patch[]) {
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
  }

  export async function diff(hash: string) {
    const git = gitdir()
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.env(environment()).quiet().cwd(Instance.directory).nothrow()
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
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
