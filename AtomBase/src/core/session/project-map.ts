import path from "path"
import { Instance } from "@/services/project/instance"

export namespace SemanticProjectMap {
  export interface Entry {
    path: string
    symbols: string[]
    imports: string[]
    isTest: boolean
  }

  interface State {
    filesHash: string
    entries: Map<string, Entry>
    signatures: Map<string, string>
    expiresAt: number
  }

  const MAX_FILES = 240
  const MAX_CACHED_FILES = 600
  const MAX_FILE_BYTES = 32_000
  const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|swift|vue|svelte)$/i
  const state = Instance.state<State>(() => ({
    filesHash: "",
    entries: new Map(),
    signatures: new Map(),
    expiresAt: 0,
  }))

  function hash(files: string[]) {
    return new Bun.CryptoHasher("sha1").update(files.join("\n")).digest("hex")
  }

  export function parse(filePath: string, content: string): Entry {
    const symbols = [
      ...content.matchAll(
        /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace|const)\s+([A-Za-z_$][\w$]*)/g,
      ),
    ]
      .map((match) => match[1])
      .slice(0, 24)
    const imports = [...content.matchAll(/(?:from\s+|require\s*\(\s*)["']([^"']+)["']/g)]
      .map((match) => match[1])
      .slice(0, 24)
    return {
      path: filePath,
      symbols: [...new Set(symbols)],
      imports: [...new Set(imports)],
      isTest: /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\./i.test(filePath),
    }
  }

  function candidates(files: string[], query: string) {
    const queryTerms = terms(query)
    const source = files.filter((item) => SOURCE.test(item))
    const matched = source.filter((item) => queryTerms.some((term) => item.toLowerCase().includes(term)))
    return [...new Set([...matched, ...source])].slice(0, MAX_FILES)
  }

  async function build(paths: string[]) {
    const entries = await Promise.all(
      paths.map(async (relative) => {
        const file = Bun.file(path.join(Instance.directory, relative))
        if (!(await file.exists()) || file.size > MAX_FILE_BYTES) return undefined
        return parse(relative, await file.text().catch(() => ""))
      }),
    )
    return entries.filter((entry): entry is Entry => !!entry)
  }

  function terms(query: string) {
    return [...new Set(query.toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? [])].slice(0, 20)
  }

  export function select(entries: Entry[], query: string, limit = 24) {
    const queryTerms = terms(query)
    return entries
      .map((entry) => {
        const pathText = entry.path.toLowerCase()
        const symbolText = entry.symbols.join(" ").toLowerCase()
        const importText = entry.imports.join(" ").toLowerCase()
        let score = 0
        for (const term of queryTerms) {
          if (pathText.includes(term)) score += 5
          if (symbolText.includes(term)) score += 4
          if (importText.includes(term)) score += 2
        }
        if (entry.isTest && /test|verify|doğrula/.test(query.toLowerCase())) score += 3
        return { entry, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
      .slice(0, limit)
      .map(({ entry }) => entry)
  }

  export function render(entries: Entry[]) {
    if (entries.length === 0) return "(no semantic matches)"
    return entries
      .map((entry) => {
        const details = [
          entry.symbols.length ? `symbols=${entry.symbols.slice(0, 8).join(",")}` : "",
          entry.imports.length ? `imports=${entry.imports.slice(0, 5).join(",")}` : "",
          entry.isTest ? "test" : "",
        ]
          .filter(Boolean)
          .join("; ")
        return `${entry.path}${details ? ` (${details})` : ""}`
      })
      .join("\n")
  }

  export async function get(query: string, files: string[]) {
    const value = state()
    const filesHash = hash(files)
    if (value.filesHash !== filesHash || value.expiresAt <= Date.now()) {
      value.entries.clear()
      value.signatures.clear()
      value.filesHash = filesHash
      value.expiresAt = Date.now() + 30_000
    }
    const wanted = candidates(files, query)
    const signature = (file: string) => {
      const source = Bun.file(path.join(Instance.directory, file))
      return `${source.size}:${source.lastModified}`
    }
    const missing = wanted.filter((file) => !value.entries.has(file) || value.signatures.get(file) !== signature(file))
    for (const file of missing) value.entries.delete(file)
    for (const entry of await build(missing)) {
      value.entries.set(entry.path, entry)
      value.signatures.set(entry.path, signature(entry.path))
    }
    while (value.entries.size > MAX_CACHED_FILES) {
      const oldest = value.entries.keys().next().value
      if (!oldest) break
      value.entries.delete(oldest)
      value.signatures.delete(oldest)
    }
    return render(select([...value.entries.values()], query))
  }
}
