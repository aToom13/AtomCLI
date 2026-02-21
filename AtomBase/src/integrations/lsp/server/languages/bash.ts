import { spawn } from "child_process"
import path from "path"
import { Global } from "@/core/global"
import { BunProc } from "@/util/bun"
import { Flag } from "@/interfaces/flag/flag"
import { Instance } from "@/services/project/instance"
import { NearestRoot } from "../common"
import type { Info } from "../types"

export const BashLS: Info = {
    id: "bash",
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    root: async () => Instance.directory,
    async spawn(root) {
        let binary = Bun.which("bash-language-server")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "bash-language-server", "out", "cli.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "bash-language-server"], {
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
        args.push("start")
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
