import { spawn } from "child_process"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { Flag } from "../../../flag/flag"
import { Archive } from "../../../util/archive"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.elixir-ls" })

export const ElixirLS: Info = {
    id: "elixir-ls",
    extensions: [".ex", ".exs"],
    root: NearestRoot(["mix.exs", "mix.lock"]),
    async spawn(root) {
        let binary = Bun.which("elixir-ls")
        if (!binary) {
            const elixirLsPath = path.join(Global.Path.bin, "elixir-ls")
            binary = path.join(
                Global.Path.bin,
                "elixir-ls-master",
                "release",
                process.platform === "win32" ? "language_server.bat" : "language_server.sh",
            )

            if (!(await Bun.file(binary).exists())) {
                const elixir = Bun.which("elixir")
                if (!elixir) {
                    log.error("elixir is required to run elixir-ls")
                    return
                }

                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                log.info("downloading elixir-ls from GitHub releases")

                const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip")
                if (!response.ok) return
                const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
                await Bun.file(zipPath).write(response)

                const ok = await Archive.extractZip(zipPath, Global.Path.bin)
                    .then(() => true)
                    .catch((error) => {
                        log.error("Failed to extract elixir-ls archive", { error })
                        return false
                    })
                if (!ok) return

                await fs.rm(zipPath, {
                    force: true,
                    recursive: true,
                })

                await $`mix deps.get && mix compile && mix elixir_ls.release2 -o release`
                    .quiet()
                    .cwd(path.join(Global.Path.bin, "elixir-ls-master"))
                    .env({ MIX_ENV: "prod", ...process.env })

                log.info(`installed elixir-ls`, {
                    path: elixirLsPath,
                })
            }
        }

        return {
            process: spawn(binary, {
                cwd: root,
            }),
        }
    },
}
