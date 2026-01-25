import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { NamedError } from "@atomcli/util/error"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"

declare global {
  const ATOMCLI_VERSION: string
  const ATOMCLI_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = Awaited<ReturnType<typeof method>>

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export async function method() {
    if (process.execPath.includes(path.join(".atomcli", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    try {
      // Check if we are running from source in a git repo
      let appRoot = path.resolve(import.meta.dir, "../../..")
      let isGit = (await $`git rev-parse --is-inside-work-tree`.cwd(appRoot).quiet().nothrow()).exitCode === 0

      // If not found via import.meta (e.g. active binary), try process.execPath
      // Binary is usually at dist/atomcli-linux-x64/bin/atomcli
      // Root is 3 levels up from bin folder: bin -> platform -> dist -> root
      if (!isGit) {
        const execDir = path.dirname(process.execPath)
        const candidate = path.resolve(execDir, "../../..")
        if ((await $`git rev-parse --is-inside-work-tree`.cwd(candidate).quiet().nothrow()).exitCode === 0) {
          appRoot = candidate
          isGit = true
        }
      }

      if (isGit) {
        return "git"
      }
    } catch { }

    const checks = [
      {
        name: "npm" as const,
        command: () => $`npm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).quiet().text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).quiet().text(),
      },
      {
        name: "brew" as const,
        command: () => $`brew list --formula atomcli`.throws(false).quiet().text(),
      },
    ]

    checks.sort((a, b) => {
      const aMatches = exec.includes(a.name)
      const bMatches = exec.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    for (const check of checks) {
      const output = await check.command()
      if (output.includes(check.name === "brew" ? "atomcli" : "atomcli-ai")) {
        return check.name
      }
    }

    return "unknown"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula anomalyco/tap/atomcli`.throws(false).quiet().text()
    if (tapFormula.includes("atomcli")) return "anomalyco/tap/atomcli"
    const coreFormula = await $`brew list --formula atomcli`.throws(false).quiet().text()
    if (coreFormula.includes("atomcli")) return "atomcli"
    return "atomcli"
  }

  export async function upgrade(method: Method, target: string) {
    let cmd
    switch (method) {
      case "git": {
        let appRoot = path.resolve(import.meta.dir, "../../..")
        // Re-resolve appRoot if necessary (same logic as detection)
        if ((await $`git rev-parse --is-inside-work-tree`.cwd(appRoot).quiet().nothrow()).exitCode !== 0) {
          const execDir = path.dirname(process.execPath)
          const candidate = path.resolve(execDir, "../../..")
          if ((await $`git rev-parse --is-inside-work-tree`.cwd(candidate).quiet().nothrow()).exitCode === 0) {
            appRoot = candidate
          }
        }

        // Just pull and let dev server restart or user restart.
        // We might want to install dependencies too.
        cmd = $`git pull && bun install && bun run build`.cwd(appRoot)
        break
      }
      case "curl":
        cmd = $`curl -fsSL https://atomcli.ai/install | bash`.env({
          ...process.env,
          VERSION: target,
        })
        break
      case "npm":
        cmd = $`npm install -g atomcli-ai@${target}`
        break
      case "pnpm":
        cmd = $`pnpm install -g atomcli-ai@${target}`
        break
      case "bun":
        cmd = $`bun install -g atomcli-ai@${target}`
        break
      case "brew": {
        const formula = await getBrewFormula()
        cmd = $`brew install ${formula}`.env({
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        })
        break
      }
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    const result = await cmd.quiet().throws(false)
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    if (result.exitCode !== 0)
      throw new UpgradeFailedError({
        stderr: result.stderr.toString("utf8"),
      })
    await $`${process.execPath} --version`.nothrow().quiet().text()
  }

  export const VERSION = typeof ATOMCLI_VERSION === "string" ? ATOMCLI_VERSION : "local"
  export const CHANNEL = typeof ATOMCLI_CHANNEL === "string" ? ATOMCLI_CHANNEL : "local"
  export const USER_AGENT = `atomcli/${CHANNEL}/${VERSION}/${Flag.ATOMCLI_CLIENT}`

  export async function latest(installMethod?: Method) {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula === "atomcli") {
        return fetch("https://formulae.brew.sh/api/formula/atomcli.json")
          .then((res) => {
            if (!res.ok) throw new Error(res.statusText)
            return res.json()
          })
          .then((data: any) => data.versions.stable)
      }
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
      const registry = await iife(async () => {
        const r = (await $`npm config get registry`.quiet().nothrow().text()).trim()
        const reg = r || "https://registry.npmjs.org"
        return reg.endsWith("/") ? reg.slice(0, -1) : reg
      })
      const channel = CHANNEL
      return fetch(`${registry}/atomcli-ai/${channel}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    return fetch("https://api.github.com/repos/anomalyco/atomcli/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }
}
