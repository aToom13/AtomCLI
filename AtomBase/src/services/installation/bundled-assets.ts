import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"

export namespace BundledAssets {
  export async function copy(sourceRoot: string, destinationRoot: string) {
    const root = await fs.realpath(sourceRoot)
    const files = await $`git ls-files -z -- .atomcli .claude`.cwd(root).quiet().text()
    for (const file of files.split("\0").filter(Boolean)) {
      const source = path.join(root, file)
      const resolved = await fs.realpath(source).catch((error) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (!resolved) continue
      if (resolved !== source) throw new Error(`Bundled asset must not use symlinks: ${file}`)
      const destination = path.join(destinationRoot, file)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(source, destination)
    }
  }
}
