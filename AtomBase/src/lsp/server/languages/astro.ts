import { spawn } from "child_process"
import path from "path"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { BunProc } from "../../../bun"
import { Flag } from "../../../flag/flag"
import { Instance } from "../../../project/instance"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.astro" })

export const Astro: Info = {
    id: "astro",
    extensions: [".astro"],
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    async spawn(root) {
        const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => { })
        if (!tsserver) {
            log.info("typescript not found, required for Astro language server")
            return
        }
        const tsdk = path.dirname(tsserver)

        let binary = Bun.which("astro-ls")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "@astrojs", "language-server", "bin", "nodeServer.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "@astrojs/language-server"], {
                    cwd: Global.Path.bin,
                    env: {
                        ...process.env,
                        BUN_BE_BUN: "1",
                    },
                    stdout: "pipe",
                    stderr: "pipe",
                    stdin: "pipe",
                }).exited
            }
            binary = BunProc.which()
            args.push("run", js)
        }
        args.push("--stdio")
        const proc = spawn(binary, args, {
            cwd: root,
            env: {
                ...process.env,
                BUN_BE_BUN: "1",
            },
        })
        return {
            process: proc,
            initialization: {
                typescript: {
                    tsdk,
                },
            },
        }
    },
}
