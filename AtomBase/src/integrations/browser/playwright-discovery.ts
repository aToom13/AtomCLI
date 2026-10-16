import os from "os"
import path from "path"
import { Global } from "@/core/global"

declare const ATOMCLI_PLAYWRIGHT_VERSION: string | undefined

export async function resolveBundledPlaywrightVersion(): Promise<string | null> {
  if (typeof ATOMCLI_PLAYWRIGHT_VERSION !== "undefined") return ATOMCLI_PLAYWRIGHT_VERSION
  const pkg = await import("playwright/package.json").catch(() => null)
  return pkg?.default?.version ?? pkg?.version ?? null
}

export function playwrightCandidates() {
  const candidates = [
    process.env.ATOMCLI_PLAYWRIGHT_PATH,
    "playwright",
    process.env.ATOMCLI_CONFIG_DIR
      ? path.join(process.env.ATOMCLI_CONFIG_DIR, "playwright", "node_modules", "playwright")
      : undefined,
    path.join(Global.Path.root, "playwright", "node_modules", "playwright"),
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "atomcli",
      "playwright",
      "node_modules",
      "playwright",
    ),
  ].filter((value): value is string => !!value)

  let directory = process.cwd()
  for (let depth = 0; depth < 8; depth++) {
    candidates.push(path.join(directory, "node_modules", "playwright"))
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return [...new Set(candidates)]
}
