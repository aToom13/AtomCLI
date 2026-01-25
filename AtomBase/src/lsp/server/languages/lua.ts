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

const log = Log.create({ service: "lsp.server.lua" })

export const LuaLS: Info = {
    id: "lua-ls",
    root: NearestRoot([
        ".luarc.json",
        ".luarc.jsonc",
        ".luacheckrc",
        ".stylua.toml",
        "stylua.toml",
        "selene.toml",
        "selene.yml",
    ]),
    extensions: [".lua"],
    async spawn(root) {
        let bin = Bun.which("lua-language-server", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })

        if (!bin) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("downloading lua-language-server from GitHub releases")

            const releaseResponse = await fetch("https://api.github.com/repos/LuaLS/lua-language-server/releases/latest")
            if (!releaseResponse.ok) {
                log.error("Failed to fetch lua-language-server release info")
                return
            }

            const release = await releaseResponse.json()

            const platform = process.platform
            const arch = process.arch
            let assetName = ""

            let lualsArch: string = arch
            if (arch === "arm64") lualsArch = "arm64"
            else if (arch === "x64") lualsArch = "x64"
            else if (arch === "ia32") lualsArch = "ia32"

            let lualsPlatform: string = platform
            if (platform === "darwin") lualsPlatform = "darwin"
            else if (platform === "linux") lualsPlatform = "linux"
            else if (platform === "win32") lualsPlatform = "win32"

            const ext = platform === "win32" ? "zip" : "tar.gz"

            assetName = `lua-language-server-${release.tag_name}-${lualsPlatform}-${lualsArch}.${ext}`

            const supportedCombos = [
                "darwin-arm64.tar.gz",
                "darwin-x64.tar.gz",
                "linux-x64.tar.gz",
                "linux-arm64.tar.gz",
                "win32-x64.zip",
                "win32-ia32.zip",
            ]

            const assetSuffix = `${lualsPlatform}-${lualsArch}.${ext}`
            if (!supportedCombos.includes(assetSuffix)) {
                log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
                return
            }

            const asset = release.assets.find((a: any) => a.name === assetName)
            if (!asset) {
                log.error(`Could not find asset ${assetName} in latest lua-language-server release`)
                return
            }

            const downloadUrl = asset.browser_download_url
            const downloadResponse = await fetch(downloadUrl)
            if (!downloadResponse.ok) {
                log.error("Failed to download lua-language-server")
                return
            }

            const tempPath = path.join(Global.Path.bin, assetName)
            await Bun.file(tempPath).write(downloadResponse)

            // Unlike zls which is a single self-contained binary,
            // lua-language-server needs supporting files (meta/, locale/, etc.)
            // Extract entire archive to dedicated directory to preserve all files
            const installDir = path.join(Global.Path.bin, `lua-language-server-${lualsArch}-${lualsPlatform}`)

            // Remove old installation if exists
            const stats = await fs.stat(installDir).catch(() => undefined)
            if (stats) {
                await fs.rm(installDir, { force: true, recursive: true })
            }

            await fs.mkdir(installDir, { recursive: true })

            if (ext === "zip") {
                const ok = await Archive.extractZip(tempPath, installDir)
                    .then(() => true)
                    .catch((error) => {
                        log.error("Failed to extract lua-language-server archive", { error })
                        return false
                    })
                if (!ok) return
            } else {
                const ok = await $`tar -xzf ${tempPath} -C ${installDir}`
                    .quiet()
                    .then(() => true)
                    .catch((error) => {
                        log.error("Failed to extract lua-language-server archive", { error })
                        return false
                    })
                if (!ok) return
            }

            await fs.rm(tempPath, { force: true })

            // Binary is located in bin/ subdirectory within the extracted archive
            bin = path.join(installDir, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))

            if (!(await Bun.file(bin).exists())) {
                log.error("Failed to extract lua-language-server binary")
                return
            }

            if (platform !== "win32") {
                const ok = await $`chmod +x ${bin}`.quiet().catch((error) => {
                    log.error("Failed to set executable permission for lua-language-server binary", {
                        error,
                    })
                })
                if (!ok) return
            }

            log.info(`installed lua-language-server`, { bin })
        }

        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}
