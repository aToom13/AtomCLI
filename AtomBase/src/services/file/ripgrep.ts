// Ripgrep utility functions
import path from "path"
import { Global } from "@/core/global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@atomcli/util/error"
import { lazy } from "@/util/util/lazy"
import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"
import { Log } from "@/util/util/log"
import { EnvPolicy } from "@/core/env/policy"

export namespace Ripgrep {
  const log = Log.create({ service: "ripgrep" })
  const Stats = z.object({
    elapsed: z.object({
      secs: z.number(),
      nanos: z.number(),
      human: z.string(),
    }),
    searches: z.number(),
    searches_with_match: z.number(),
    bytes_searched: z.number(),
    bytes_printed: z.number(),
    matched_lines: z.number(),
    matches: z.number(),
  })

  const Begin = z.object({
    type: z.literal("begin"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
    }),
  })

  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      lines: z.object({
        text: z.string(),
      }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(
        z.object({
          match: z.object({
            text: z.string(),
          }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  })

  const End = z.object({
    type: z.literal("end"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      binary_offset: z.number().nullable(),
      stats: Stats,
    }),
  })

  const Summary = z.object({
    type: z.literal("summary"),
    data: z.object({
      elapsed_total: z.object({
        human: z.string(),
        nanos: z.number(),
        secs: z.number(),
      }),
      stats: Stats,
    }),
  })

  const Result = z.union([Begin, Match, End, Summary])

  export type Result = z.infer<typeof Result>
  export type Match = z.infer<typeof Match>
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>
  const VERSION = "15.2.0"
  const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
  const PLATFORM = {
    "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-linux": {
      platform: "aarch64-unknown-linux-musl",
      extension: "tar.gz",
    },
    "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
    "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
  } as const

  async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
    const declaredSize = Number(response.headers.get("content-length") ?? 0)
    if (declaredSize > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`)
    if (!response.body) return new Uint8Array()

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          throw new Error(`Download exceeds ${maxBytes} bytes`)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const result = new Uint8Array(new ArrayBuffer(total))
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  export const ExtractionFailedError = NamedError.create(
    "RipgrepExtractionFailedError",
    z.object({
      filepath: z.string(),
      stderr: z.string(),
    }),
  )

  export const UnsupportedPlatformError = NamedError.create(
    "RipgrepUnsupportedPlatformError",
    z.object({
      platform: z.string(),
      hint: z.string().optional(),
    }),
  )

  export const DownloadFailedError = NamedError.create(
    "RipgrepDownloadFailedError",
    z.object({
      url: z.string(),
      status: z.number(),
    }),
  )

  const state = lazy(async () => {
    let filepath = Bun.which("rg")
    if (filepath) return { filepath }
    filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
      const config = PLATFORM[platformKey]
      if (!config) {
        throw new UnsupportedPlatformError({
          platform: platformKey,
          hint: process.platform === "freebsd" ? "Install ripgrep with: pkg install ripgrep" : undefined,
        })
      }

      const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
      const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      let buffer: Uint8Array<ArrayBuffer>
      try {
        const [response, checksumResponse] = await Promise.all([
          fetch(url, { signal: controller.signal }),
          fetch(`${url}.sha256`, { signal: controller.signal }),
        ])
        if (!response.ok) throw new DownloadFailedError({ url, status: response.status })
        if (!checksumResponse.ok) throw new DownloadFailedError({ url: `${url}.sha256`, status: checksumResponse.status })

        buffer = await readBounded(response, MAX_ARCHIVE_BYTES)
        const checksumBytes = await readBounded(checksumResponse, 4 * 1024)
        const expectedChecksum = new TextDecoder().decode(checksumBytes).trim().split(/\s+/, 1)[0]?.toLowerCase()
        const actualChecksum = new Bun.CryptoHasher("sha256").update(buffer).digest("hex")
        if (!expectedChecksum || actualChecksum !== expectedChecksum) {
          throw new Error(`Checksum mismatch for ${filename}`)
        }
      } finally {
        clearTimeout(timeout)
      }

      const archivePath = path.join(Global.Path.bin, filename)
      await Bun.write(archivePath, buffer)
      try {
        if (config.extension === "tar.gz") {
          const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

          if (platformKey.endsWith("-darwin")) args.push("--include=*/rg")
          if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/rg")

          const proc = Bun.spawn(args, {
            cwd: Global.Path.bin,
            env: EnvPolicy.build({ cwd: Global.Path.bin, scope: "ripgrep:extract" }),
            stderr: "pipe",
            stdout: "pipe",
          })
          await proc.exited
          if (proc.exitCode !== 0)
            throw new ExtractionFailedError({
              filepath,
              stderr: await Bun.readableStreamToText(proc.stderr),
            })
        }
        if (config.extension === "zip") {
          const zipFileReader = new ZipReader(new BlobReader(new Blob([buffer])))
          try {
            const entries = await zipFileReader.getEntries()
            const rgEntry = entries.find((entry) => entry.filename.endsWith("rg.exe"))
            if (!rgEntry) {
              throw new ExtractionFailedError({ filepath: archivePath, stderr: "rg.exe not found in zip archive" })
            }
            if (!("getData" in rgEntry)) {
              throw new ExtractionFailedError({ filepath: archivePath, stderr: "rg.exe entry is a directory" })
            }

            const rgBlob = await rgEntry.getData(new BlobWriter())
            if (!rgBlob) {
              throw new ExtractionFailedError({ filepath: archivePath, stderr: "Failed to extract rg.exe" })
            }
            await Bun.write(filepath, await rgBlob.arrayBuffer())
          } finally {
            await zipFileReader.close()
          }
        }
        if (!(await Bun.file(filepath).exists())) {
          throw new ExtractionFailedError({
            filepath,
            stderr: "Archive did not contain the expected ripgrep executable",
          })
        }
      } finally {
        await fs.unlink(archivePath).catch(() => {})
      }
      if (!platformKey.endsWith("-win32")) await fs.chmod(filepath, 0o755)
    }

    return {
      filepath,
    }
  })

  export async function filepath() {
    const { filepath } = await state()
    return filepath
  }

  // Symlink traversal needs a finite default. Plain rg traversal does not follow
  // symlinks, so imposing the same default there would hide deep project files.
  const DEFAULT_MAX_DEPTH = 5

  // Default timeout for file listing operations (ms)
  const FILES_TIMEOUT_MS = 30_000

  export async function* files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    timeout?: number
    signal?: AbortSignal
  }) {
    const args = [await filepath(), "--files", "--glob=!.git/*"]
    if (input.follow === true) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")

    // Apply depth limit: prevents infinite symlink loops (e.g., .venv/bin/python → /usr/lib/...)
    // Agent can drill deeper by calling the tool with a specific subdirectory as cwd
    const depth = input.maxDepth ?? (input.follow === true ? DEFAULT_MAX_DEPTH : undefined)
    if (depth !== undefined) args.push(`--max-depth=${depth}`)

    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    // Bun.spawn should throw this, but it incorrectly reports that the executable does not exist.
    // See https://github.com/oven-sh/bun/issues/24012
    if (!(await fs.stat(input.cwd).catch(() => undefined))?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    const proc = Bun.spawn(args, {
      cwd: input.cwd,
      env: EnvPolicy.build({ cwd: input.cwd, scope: "ripgrep:files" }),
      stdout: "pipe",
      stderr: "ignore",
      maxBuffer: 1024 * 1024 * 20,
    })

    // Timeout: kill process if it runs too long (prevents zombie rg processes)
    const timeout = input.timeout ?? FILES_TIMEOUT_MS
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      log.warn("ripgrep files timeout, killing process", { cwd: input.cwd, timeout })
      try {
        proc.kill()
      } catch {
        /* already exited */
      }
    }, timeout)
    // Prevent this timer from holding the event loop open after all work is done.
    // The finally block always calls clearTimeout(timer), so this is safe.
    timer.unref()
    const abort = () => {
      try {
        proc.kill()
      } catch {}
    }
    input.signal?.addEventListener("abort", abort, { once: true })

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        if (input.signal?.aborted) throw input.signal.reason
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // Handle both Unix (\n) and Windows (\r\n) line endings
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line) yield line
        }
      }

      if (input.signal?.aborted) throw input.signal.reason
      if (timedOut) throw new Error(`File listing timed out after ${timeout} ms`)
      if (buffer) yield buffer
    } finally {
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", abort)
      reader.releaseLock()
      // Kill the process if it's still running to prevent zombie processes
      // This happens when the iterator is abandoned early (e.g., break in for await)
      try {
        proc.kill()
      } catch {
        // Process may have already exited
      }
      await proc.exited
    }
  }

  export async function tree(input: { cwd: string; limit?: number }) {
    log.info("tree", input)
    const limit = input.limit ?? 50
    const scanLimit = Math.min(Math.max(limit * 20, 1_000), 10_000)
    const files: string[] = []
    for await (const file of Ripgrep.files({ cwd: input.cwd })) {
      files.push(file)
      if (files.length >= scanLimit) break
    }
    interface Node {
      path: string[]
      children: Node[]
      childMap: Map<string, Node>
    }

    function getPath(node: Node, parts: string[], create: boolean) {
      if (parts.length === 0) return node
      let current = node
      for (const part of parts) {
        let existing = current.childMap.get(part)
        if (!existing) {
          if (!create) return
          existing = {
            path: current.path.concat(part),
            children: [],
            childMap: new Map(),
          }
          current.children.push(existing)
          current.childMap.set(part, existing)
        }
        current = existing
      }
      return current
    }

    const root: Node = {
      path: [],
      children: [],
      childMap: new Map(),
    }
    for (const file of files) {
      if (file.includes(".atomcli")) continue
      const parts = file.split(path.sep)
      getPath(root, parts, true)
    }

    function sort(node: Node) {
      node.children.sort((a, b) => {
        if (!a.children.length && b.children.length) return 1
        if (!b.children.length && a.children.length) return -1
        return a.path.at(-1)!.localeCompare(b.path.at(-1)!)
      })
      for (const child of node.children) {
        sort(child)
      }
    }
    sort(root)

    let current = [root]
    const result: Node = {
      path: [],
      children: [],
      childMap: new Map(),
    }

    let processed = 0
    while (current.length > 0) {
      const next = []
      for (const node of current) {
        if (node.children.length) next.push(...node.children)
      }
      const max = Math.max(...current.map((x) => x.children.length))
      for (let i = 0; i < max && processed < limit; i++) {
        for (const node of current) {
          const child = node.children[i]
          if (!child) continue
          getPath(result, child.path, true)
          processed++
          if (processed >= limit) break
        }
      }
      if (processed >= limit) {
        for (const node of [...current, ...next]) {
          const compare = getPath(result, node.path, false)
          if (!compare) continue
          if (compare?.children.length !== node.children.length) {
            const diff = node.children.length - compare.children.length
            compare.children.push({
              path: compare.path.concat(`[${diff} truncated]`),
              children: [],
              childMap: new Map(),
            })
          }
        }
        break
      }
      current = next
    }

    const lines: string[] = []

    function render(node: Node, depth: number) {
      const indent = "\t".repeat(depth)
      lines.push(indent + node.path.at(-1) + (node.children.length ? "/" : ""))
      for (const child of node.children) {
        render(child, depth + 1)
      }
    }
    result.children.map((x) => render(x, 0))

    return lines.join("\n")
  }

  export async function search(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
    signal?: AbortSignal
  }) {
    const rgPath = await filepath()
    const args = ["--json", "--hidden", "--glob=!.git/*", "--max-filesize=10M"]
    if (input.follow === true) args.push("--follow")

    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    args.push("--")
    args.push(input.pattern)

    const proc = Bun.spawn({
      cmd: [rgPath, ...args],
      cwd: input.cwd,
      env: EnvPolicy.build({ cwd: input.cwd, scope: "ripgrep:search" }),
      stdout: "pipe",
      stderr: "ignore",
    })
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1_000)
    const results: any[] = []
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const stop = () => {
      try {
        proc.kill()
      } catch {}
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, 30_000)
    const abort = () => stop()
    input.signal?.addEventListener("abort", abort, { once: true })

    try {
      outer: while (true) {
        if (input.signal?.aborted) throw input.signal.reason
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 1024 * 1024) {
          stop()
          break
        }

        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line) continue
          try {
            const parsed = JSON.parse(line)
            if (parsed.type !== "match") continue
            results.push(parsed.data)
            if (results.length >= limit) {
              stop()
              break outer
            }
          } catch {
            // Ignore a malformed record without retaining the rest of stdout.
          }
        }
      }
      if (input.signal?.aborted) throw input.signal.reason
      if (timedOut) throw new Error("Search timed out after 30000 ms")
    } finally {
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", abort)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      stop()
      await proc.exited
    }
    return results
  }
}
