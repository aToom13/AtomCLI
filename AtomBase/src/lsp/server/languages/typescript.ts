import { spawn } from "child_process"
import { Log } from "../../../util/log"
import { BunProc } from "../../../bun"
import { Instance } from "../../../project/instance"
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
        const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => { })
        log.info("typescript server", { tsserver })
        if (!tsserver) return
        const proc = spawn(BunProc.which(), ["x", "typescript-language-server", "--stdio"], {
            cwd: root,
            env: {
                ...process.env,
                TSS_DEBUG: "1000",
            },
            stdio: ["pipe", "pipe", "pipe"],
        })

        return {
            process: proc,
            initialization: {
                preferences: {
                    providePrefixAndSuffixTextForRename: true,
                    allowRenameOfImportPath: true,
                    includePackageJsonAutoImports: "auto",
                },
            },
        }
    },
}
