import fs from "fs/promises"
import path from "path"
import type { Dirent } from "fs"

export namespace FileSearch {
  export interface Entry {
    name: string
    path: string
    isDir: boolean
  }

  const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "dist", "node_modules", "release_assets"])

  export async function find(
    root: string,
    query: string,
    options: { maxResults?: number; maxDirectories?: number } = {},
  ): Promise<Entry[]> {
    const needle = query.trim().toLowerCase()
    if (!needle) return []

    const maxResults = options.maxResults ?? 75
    const maxDirectories = options.maxDirectories ?? 2_000
    const results: Entry[] = []
    const directories = [root]
    let visited = 0

    while (directories.length > 0 && results.length < maxResults && visited < maxDirectories) {
      const directory = directories.shift()!
      visited++

      let entries: Dirent[]
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break
        if (entry.name.startsWith(".") && entry.name !== ".atomcli") continue
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue

        const fullPath = path.join(directory, entry.name)
        const relativePath = path.relative(root, fullPath).toLowerCase()
        if (relativePath.includes(needle)) {
          results.push({ name: entry.name, path: fullPath, isDir: entry.isDirectory() })
        }
        if (entry.isDirectory()) directories.push(fullPath)
      }
    }

    return results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.path.localeCompare(b.path)
    })
  }
}
