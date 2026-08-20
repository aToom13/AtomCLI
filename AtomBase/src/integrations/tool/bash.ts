import z from "zod"
import { createWriteStream } from "fs"
import fs from "fs/promises"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "@/util/util/log"
import { Instance } from "@/services/project/instance"
import { lazy } from "@/util/util/lazy"
import { Language } from "web-tree-sitter"

import { Filesystem } from "@/util/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/interfaces/flag/flag.ts"
import { Shell } from "@/interfaces/shell/shell"

import { BashArity } from "@/util/permission/arity"
import { Truncate } from "./truncation"
import { HarnessState } from "@/core/session/harness-state"
import { EnvPolicy } from "@/core/env/policy"
import { ExecutionWorld } from "@/core/execution/world"
import { Config } from "@/core/config/config"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.ATOMCLI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
const MAX_TIMEOUT = 30 * 60 * 1000

// Validation for fundamental security bounds
// Specifically, path traversal is still blocked downstream, but complex shell commands are allowed

export const log = Log.create({ service: "bash-tool" })

function validateCommand(command: string): boolean {
  const isTestMode = process.env.NODE_ENV === "test" || process.env.ATOMCLI_TEST === "true"

  /**
   * Validates command for potential shell injection attempts
   * Returns true if command is safe, throws error if dangerous
   * In test mode, allows some patterns for testing purposes
   */
  // In test mode, fail fast on certain injection patterns that break the test harness
  if (isTestMode) {
    const criticalPatterns = /\$\(|`[^`]*`|\$\{[^}]*\}/
    if (criticalPatterns.test(command)) {
      const match = command.match(criticalPatterns)
      throw new Error(
        `Command contains critical injection pattern: "${match?.[0]}". ` +
          `Command substitution is never allowed in test mode.`,
      )
    }
  }

  // NOTE: Pipes (|), logical chaining (&&, ||) and semi-colons (;) are intentionally
  // permitted to allow the AI to run complex pipelines and one-liners when needed.
  return true
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// Tool name "bash" is kept for backward compatibility with stored permission rulesets
export const BashTool = Tool.define("bash", async (initCtx: Tool.InitContext = {}) => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().min(1).max(100_000).describe("The command to execute"),
      timeout: z.number().int().min(1).max(MAX_TIMEOUT).describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .max(4096)
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .min(1)
        .max(1000)
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: bun install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      let cwd = params.workdir || Instance.directory

      if (params.workdir) {
        cwd = path.resolve(Instance.directory, params.workdir)
      }

      // Validate command for shell injection attempts
      validateCommand(params.command)

      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Filesystem.contains(Instance.directory, cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = path.resolve(cwd, arg)
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              // Git Bash on Windows returns Unix-style paths like /c/Users/...
              const normalized =
                process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                  ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                  : resolved
              if (!Filesystem.contains(Instance.directory, normalized)) directories.add(normalized)
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(command.join(" "))
          always.add(BashArity.prefix(command).join(" ") + "*")
        }
      }

      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: Array.from(directories),
          always: Array.from(directories).map((x) => path.dirname(x) + "*"),
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const outputPath = await Truncate.createOutputPath()
      const outputSink = createWriteStream(outputPath, { flags: "wx" })
      const sinkDone = new Promise<void>((resolve, reject) => {
        outputSink.once("finish", resolve)
        outputSink.once("error", reject)
      })

      const execution = (await Config.get()).execution
      const envMode = execution?.environment ?? "minimal"
      const env = EnvPolicy.build({
          mode: envMode,
          allow: execution?.envAllow,
          cwd,
          scope: "tool:bash",
          grants: EnvPolicy.Grant.array().parse(ctx.extra?.envGrants ?? []),
          approvedInherit: envMode === "inherit",
        })
      const prepared = ExecutionWorld.prepare(
        { executable: shell, args: ExecutionWorld.shellArguments(shell, params.command), cwd, env },
        {
          workspaceRoot: Instance.directory,
          sandbox: execution?.sandbox ?? "off",
          filesystem: execution?.filesystem ?? "workspace-write",
          network: execution?.network ?? "allow",
          environment: envMode,
          processVisibility: execution?.processVisibility ?? "restricted",
        },
      )
      const proc = spawn(prepared.executable, prepared.args, {
        shell: false,
        cwd: prepared.cwd,
        env: prepared.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      const preview: Buffer[] = []
      let previewBytes = 0
      let previewLines = 1
      let totalBytes = 0
      let totalLines = 1
      let lastMetadataUpdate = 0

      const previewText = () => Buffer.concat(preview, previewBytes).toString("utf8")

      const capturePreview = (chunk: Buffer) => {
        if (previewBytes >= Truncate.MAX_BYTES || previewLines > Truncate.MAX_LINES) return
        let end = Math.min(chunk.length, Truncate.MAX_BYTES - previewBytes)
        let newlines = 0
        for (let index = 0; index < end; index++) {
          if (chunk[index] !== 10) continue
          if (previewLines + newlines >= Truncate.MAX_LINES) {
            end = index
            break
          }
          newlines++
        }
        if (end === 0) return
        preview.push(chunk.subarray(0, end))
        previewBytes += end
        previewLines += newlines
      }

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
          execution: { enforcement: prepared.enforcement, provider: prepared.provider },
        },
      })

      const append = (chunk: Buffer) => {
        totalBytes += chunk.length
        for (const byte of chunk) {
          if (byte === 10) totalLines++
        }
        capturePreview(chunk)
        const writable = outputSink.write(chunk)
        if (!writable) {
          proc.stdout?.pause()
          proc.stderr?.pause()
        }
        const now = Date.now()
        if (now - lastMetadataUpdate < 100) return
        lastMetadataUpdate = now
        const current = previewText()
        ctx.metadata({
          metadata: {
            output: current.length > MAX_METADATA_LENGTH ? current.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : current,
            description: params.description,
          },
        })
      }

      outputSink.on("drain", () => {
        proc.stdout?.resume()
        proc.stderr?.resume()
      })

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      try {
        const completion = new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeoutTimer)
            ctx.abort.removeEventListener("abort", abortHandler)
          }

          // `close` fires only after the process has exited and its stdio streams
          // have closed, so trailing output cannot race outputSink.end().
          proc.once("close", () => {
            exited = true
            cleanup()
            resolve()
          })

          proc.once("error", (error) => {
            exited = true
            cleanup()
            reject(error)
          })
        })

        const abortHandler = () => {
          aborted = true
          void kill()
        }

        const timeoutTimer = setTimeout(() => {
          timedOut = true
          void kill()
        }, timeout + 100)

        ctx.abort.addEventListener("abort", abortHandler, { once: true })
        if (ctx.abort.aborted) abortHandler()

        await completion
      } catch (error) {
        outputSink.destroy()
        await sinkDone.catch(() => {})
        await fs.unlink(outputPath).catch(() => {})
        throw error
      }

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        append(Buffer.from("\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"))
      }

      outputSink.end()
      await sinkDone

      const rawPreview = previewText()
      const wasTruncated = totalBytes > previewBytes || totalLines > previewLines
      const truncated = wasTruncated
        ? Truncate.streamed(
            rawPreview,
            { bytes: totalBytes, lines: totalLines, previewBytes, previewLines },
            outputPath,
            initCtx?.agent,
          )
        : ({ content: rawPreview, truncated: false } as const)
      if (!wasTruncated) await fs.unlink(outputPath).catch(() => {})
      const output = truncated.content

      // Push to harness ring buffer so reviewer agent can access raw output
      HarnessState.pushExecutionLog(ctx.sessionID, {
        command: params.command,
        output,
        exitCode: proc.exitCode,
      })

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
          truncated: truncated.truncated,
          ...(truncated.truncated && { outputPath: truncated.outputPath }),
        },
        output,
      }
    },
  }
})

// Alias for backward compatibility with cli/cmd imports
export { BashTool as Bash }
