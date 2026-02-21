import { spawn } from "child_process"
import path from "path"
import { Global } from "@/core/global"
import { Log } from "@/util/util/log"
import { Flag } from "@/interfaces/flag/flag"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.rubocop" })

export const Rubocop: Info = {
    id: "ruby-lsp",
    root: NearestRoot(["Gemfile"]),
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    async spawn(root) {
        let bin = Bun.which("rubocop", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            const ruby = Bun.which("ruby")
            const gem = Bun.which("gem")
            if (!ruby || !gem) {
                log.info("Ruby not found, please install Ruby first")
                return
            }
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("installing rubocop")
            const proc = Bun.spawn({
                cmd: ["gem", "install", "rubocop", "--bindir", Global.Path.bin],
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install rubocop")
                return
            }
            bin = path.join(Global.Path.bin, "rubocop" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed rubocop`, {
                bin,
            })
        }
        return {
            process: spawn(bin!, ["--lsp"], {
                cwd: root,
            }),
        }
    },
}
