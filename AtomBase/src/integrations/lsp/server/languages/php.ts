import { spawn } from "child_process"
import path from "path"
import { Global } from "@/core/global"
import { BunProc } from "@/util/bun"
import { Flag } from "@/interfaces/flag/flag"
import { NearestRoot } from "../common"
import type { Info } from "../types"

export const PHPIntelephense: Info = {
    id: "php intelephense",
    extensions: [".php"],
    root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
    async spawn(root) {
        let binary = Bun.which("intelephense")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "intelephense", "lib", "intelephense.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "intelephense"], {
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
                telemetry: {
                    enabled: false,
                },
            },
        }
    },
}
