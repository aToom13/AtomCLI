import { realpathSync } from "fs"
import { exists } from "fs/promises"
import { dirname, join, relative } from "path"

export namespace Filesystem {
  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */

  // LRU cache for normalizePath (Windows only, max 1000 entries)
  const normalizeCache = new Map<string, string>()
  const MAX_NORMALIZE_CACHE = 1000

  export function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    const cached = normalizeCache.get(p)
    if (cached !== undefined) return cached
    try {
      const result = realpathSync.native(p)
      if (normalizeCache.size >= MAX_NORMALIZE_CACHE) {
        const firstKey = normalizeCache.keys().next().value
        if (firstKey) normalizeCache.delete(firstKey)
      }
      normalizeCache.set(p, result)
      return result
    } catch {
      return p
    }
  }

  // LRU cache for contains() results (max 500 entries)
  const containsCache = new Map<string, boolean>()
  const MAX_CONTAINS_CACHE = 500

  export function overlaps(a: string, b: string) {
    const relA = relative(a, b)
    const relB = relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    // Windows cross-drive check
    if (process.platform === "win32") {
      const parentRoot = require("path").parse(parent).root.toLowerCase()
      const childRoot = require("path").parse(child).root.toLowerCase()
      if (parentRoot !== childRoot) return false
    }

    // Cache key for contains check
    const cacheKey = parent + "\0" + child
    const cached = containsCache.get(cacheKey)
    if (cached !== undefined) return cached

    // Resolve symlinks to canonical paths to prevent symlink escape
    try {
      const realParent = realpathSync(parent)
      const realChild = realpathSync(child)
      const result = !relative(realParent, realChild).startsWith("..")
      if (containsCache.size >= MAX_CONTAINS_CACHE) {
        const firstKey = containsCache.keys().next().value
        if (firstKey) containsCache.delete(firstKey)
      }
      containsCache.set(cacheKey, result)
      return result
    } catch {
      // Path doesn't exist yet (e.g., new file creation) — fall back to
      // resolving the parent directory and checking lexically
      try {
        const realParent = realpathSync(parent)
        const childDir = dirname(child)
        const realChildDir = realpathSync(childDir)
        const childName = child.slice(childDir.length)
        const result = !relative(realParent, realChildDir + childName).startsWith("..")
        if (containsCache.size >= MAX_CONTAINS_CACHE) {
          const firstKey = containsCache.keys().next().value
          if (firstKey) containsCache.delete(firstKey)
        }
        containsCache.set(cacheKey, result)
        return result
      } catch {
        // Neither path exists — fall back to pure lexical check
        const result = !relative(parent, child).startsWith("..")
        if (containsCache.size >= MAX_CONTAINS_CACHE) {
          const firstKey = containsCache.keys().next().value
          if (firstKey) containsCache.delete(firstKey)
        }
        containsCache.set(cacheKey, result)
        return result
      }
    }
  }

  /**
   * Clear all filesystem caches. Call this when filesystem changes are detected
   * (e.g., on FileEvent.Changed/Created/Deleted) to prevent stale cache entries.
   */
  export function clearCaches(): void {
    normalizeCache.clear()
    containsCache.clear()
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search).catch(() => false)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search).catch(() => false)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({
          cwd: current,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          result.push(match)
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
