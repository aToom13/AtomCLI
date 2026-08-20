import { Instance } from "@/services/project/instance"
import { Ripgrep } from "@/services/file/ripgrep"
import { ProjectDetector } from "./project-detector"
import { SemanticProjectMap } from "./project-map"

export namespace ContextManifest {
  interface State {
    expiresAt: number
    commands: Awaited<ReturnType<typeof ProjectDetector.detect>> | undefined
    tree: string
    files: string[]
  }

  const state = Instance.state<State>(() => ({ expiresAt: 0, commands: undefined, tree: "", files: [] }))

  async function listFiles(limit = 5_000) {
    const files: string[] = []
    for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
      files.push(file)
      if (files.length >= limit) break
    }
    return files
  }

  export function selectTree(tree: string, query: string, limit = 80) {
    const lines = tree.split("\n").filter(Boolean)
    if (lines.length <= limit) return lines.join("\n")
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? [])].slice(0, 12)
    if (terms.length === 0) return lines.slice(0, Math.min(limit, 40)).join("\n")
    const matched = lines.filter((line) => terms.some((term) => line.toLowerCase().includes(term)))
    const selected = matched.length > 0 ? matched : lines.slice(0, 40)
    return selected.slice(0, limit).join("\n")
  }

  export async function get(query = "") {
    const value = state()
    if (value.expiresAt <= Date.now()) {
      const [commands, tree, files] = await Promise.all([
        ProjectDetector.detect(Instance.directory),
        Instance.project.vcs === "git" ? Ripgrep.tree({ cwd: Instance.directory, limit: 500 }) : Promise.resolve(""),
        listFiles(),
      ])
      value.commands = commands
      value.tree = tree
      value.files = files
      value.expiresAt = Date.now() + 30_000
    }
    return {
      commands: value.commands!,
      tree: selectTree(value.tree, query),
      semantic: await SemanticProjectMap.get(query, value.files),
    }
  }
}
