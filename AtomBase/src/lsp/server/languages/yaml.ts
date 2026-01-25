import { spawn } from "child_process"
import path from "path"
import { Global } from "../../../global"
import { BunProc } from "../../../bun"
import { Flag } from "../../../flag/flag"
import { NearestRoot } from "../common"
import type { Info } from "../types"

export const YamlLS: Info = {
    id: "yaml-ls",
    extensions: [".yaml", ".yml"],
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    async spawn(root) {
        let binary = Bun.which("yaml-language-server")
        const args: string[] = []
        if (!binary) {
            const js = path.join(
                Global.Path.bin,
                "node_modules",
                "yaml-language-server",
                "out",
                "server",
                "src",
                "server.js",
            )
            const exists = await Bun.file(js).exists()
            if (!exists) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "yaml-language-server"], {
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
        }
    },
}
