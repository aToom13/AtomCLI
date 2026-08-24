import { LSPProcess } from "@/integrations/lsp/process"
const spawn = LSPProcess.spawn
import { Log } from "@/util/util/log"
import { Instance } from "@/services/project/instance"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.typescript" })

export const Typescript: Info = {
  id: "typescript",
  root: NearestRoot(
    ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
    ["deno.json", "deno.jsonc"],
  ),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  async spawn(root) {
    const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() =>
      Bun.resolve("typescript/lib/tsserver.js", import.meta.dir).catch(() => undefined),
    )
    const languageServer = await Bun.resolve("typescript-language-server/lib/cli.mjs", Instance.directory).catch(() =>
      Bun.resolve("typescript-language-server/lib/cli.mjs", import.meta.dir).catch(() => undefined),
    )
    const node = Bun.which("node")
    log.info("typescript server", { tsserver, languageServer, node })
    if (!tsserver || !languageServer || !node) return
    const proc = spawn(node, [languageServer, "--stdio"], {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    return {
      process: proc,
      initialization: {
        tsserver: {
          fallbackPath: tsserver,
        },
        preferences: {
          providePrefixAndSuffixTextForRename: true,
          allowRenameOfImportPath: true,
          includePackageJsonAutoImports: "auto",
        },
      },
    }
  },
}
