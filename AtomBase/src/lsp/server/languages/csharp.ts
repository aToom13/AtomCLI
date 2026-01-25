import { spawn } from "child_process"
import path from "path"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { Flag } from "../../../flag/flag"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.csharp" })

export const CSharp: Info = {
    id: "csharp",
    root: NearestRoot([".sln", ".csproj", "global.json"]),
    extensions: [".cs"],
    async spawn(root) {
        let bin = Bun.which("csharp-ls", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            if (!Bun.which("dotnet")) {
                log.error(".NET SDK is required to install csharp-ls")
                return
            }

            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("installing csharp-ls via dotnet tool")
            const proc = Bun.spawn({
                cmd: ["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin],
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install csharp-ls")
                return
            }

            bin = path.join(Global.Path.bin, "csharp-ls" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed csharp-ls`, { bin })
        }

        return {
            process: spawn(bin!, {
                cwd: root,
            }),
        }
    },
}
