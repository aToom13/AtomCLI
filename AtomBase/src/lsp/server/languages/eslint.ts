import { spawn } from "child_process"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { BunProc } from "../../../bun"
import { Instance } from "../../../project/instance"
import { Flag } from "../../../flag/flag"
import { Archive } from "../../../util/archive"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.eslint" })

export const ESLint: Info = {
    id: "eslint",
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    async spawn(root) {
        const eslint = await Bun.resolve("eslint", Instance.directory).catch(() => { })
        if (!eslint) return
        log.info("spawning eslint server")
        const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
        if (!(await Bun.file(serverPath).exists())) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("downloading and building VS Code ESLint server")
            const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip")
            if (!response.ok) return

            const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
            await Bun.file(zipPath).write(response)

            const ok = await Archive.extractZip(zipPath, Global.Path.bin)
                .then(() => true)
                .catch((error) => {
                    log.error("Failed to extract vscode-eslint archive", { error })
                    return false
                })
            if (!ok) return
            await fs.rm(zipPath, { force: true })

            const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
            const finalPath = path.join(Global.Path.bin, "vscode-eslint")

            const stats = await fs.stat(finalPath).catch(() => undefined)
            if (stats) {
                log.info("removing old eslint installation", { path: finalPath })
                await fs.rm(finalPath, { force: true, recursive: true })
            }
            await fs.rename(extractedPath, finalPath)

            const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
            await $`${npmCmd} install`.cwd(finalPath).quiet()
            await $`${npmCmd} run compile`.cwd(finalPath).quiet()

            log.info("installed VS Code ESLint server", { serverPath })
        }

        const proc = spawn(BunProc.which(), [serverPath, "--stdio"], {
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
