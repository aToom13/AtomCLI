import { spawn } from "child_process"
import path from "path"
import { Global } from "@/core/global"
import { Log } from "@/util/util/log"
import { Flag } from "@/interfaces/flag/flag"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.fsharp" })

export const FSharp: Info = {
    id: "fsharp",
    root: NearestRoot([".sln", ".fsproj", "global.json"]),
    extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
    async spawn(root) {
        let bin = Bun.which("fsautocomplete", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            if (!Bun.which("dotnet")) {
                log.error(".NET SDK is required to install fsautocomplete")
                return
            }

            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("installing fsautocomplete via dotnet tool")
            const proc = Bun.spawn({
                cmd: ["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin],
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install fsautocomplete")
                return
            }

            bin = path.join(Global.Path.bin, "fsautocomplete" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed fsautocomplete`, { bin })
        }

        return {
            process: spawn(bin!, {
                cwd: root,
            }),
        }
    },
}
