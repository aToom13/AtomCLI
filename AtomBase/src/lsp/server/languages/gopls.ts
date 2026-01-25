import { spawn } from "child_process"
import path from "path"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { Flag } from "../../../flag/flag"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.gopls" })

export const Gopls: Info = {
    id: "gopls",
    root: async (file) => {
        const work = await NearestRoot(["go.work"])(file)
        if (work) return work
        return NearestRoot(["go.mod", "go.sum"])(file)
    },
    extensions: [".go"],
    async spawn(root) {
        let bin = Bun.which("gopls", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            if (!Bun.which("go")) return
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return

            log.info("installing gopls")
            const proc = Bun.spawn({
                cmd: ["go", "install", "golang.org/x/tools/gopls@latest"],
                env: { ...process.env, GOBIN: Global.Path.bin },
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install gopls")
                return
            }
            bin = path.join(Global.Path.bin, "gopls" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed gopls`, {
                bin,
            })
        }
        return {
            process: spawn(bin!, {
                cwd: root,
            }),
        }
    },
}
