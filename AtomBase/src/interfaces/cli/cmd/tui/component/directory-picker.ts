import fs from "fs"
import os from "os"
import path from "path"

export function normalizeDirectory(input: string, base = os.homedir()): string {
  const value = input.trim()
  return path.resolve(
    value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : base,
    value.startsWith("~") ? "." : value,
  )
}

export function directoryEntries(directory: string, root = os.homedir()): string[] {
  const current = path.resolve(directory)
  const home = path.resolve(root)
  const entries: string[] = []
  if (current !== home && current.startsWith(home + path.sep)) entries.push(path.dirname(current))
  try {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      entries.push(path.join(current, entry.name))
    }
  } catch {}
  return entries.sort((a, b) => a.localeCompare(b))
}

export function validateDirectory(input: string): string {
  const directory = normalizeDirectory(input)
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory())
    throw new Error(`Directory not found: ${directory}`)
  return fs.realpathSync(directory)
}
