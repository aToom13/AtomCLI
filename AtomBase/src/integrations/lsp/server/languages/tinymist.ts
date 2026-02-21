import { spawn } from "child_process"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Global } from "@/core/global"
import { Log } from "@/util/util/log"
import { Flag } from "@/interfaces/flag/flag"
import { Archive } from "@/util/util/archive"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.tinymist" })

export const Tinymist: Info = {
    id: "tinymist",
    extensions: [".typ", ".typc"],
    root: NearestRoot(["typst.toml"]),
    async spawn(root) {
        let bin = Bun.which("tinymist", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })

        if (!bin) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("downloading tinymist from GitHub releases")

            const response = await fetch("https://api.github.com/repos/Myriad-Dreamin/tinymist/releases/latest")
            if (!response.ok) {
                log.error("Failed to fetch tinymist release info")
                return
            }

            const release = (await response.json()) as {
                tag_name?: string
                assets?: { name?: string; browser_download_url?: string }[]
            }

            const platform = process.platform
            const arch = process.arch

            const tinymistArch = arch === "arm64" ? "aarch64" : "x86_64"
            let tinymistPlatform: string
            let ext: string

            if (platform === "darwin") {
                tinymistPlatform = "apple-darwin"
                ext = "tar.gz"
            } else if (platform === "win32") {
                tinymistPlatform = "pc-windows-msvc"
                ext = "zip"
            } else {
                tinymistPlatform = "unknown-linux-gnu"
                ext = "tar.gz"
            }

            const assetName = `tinymist-${tinymistArch}-${tinymistPlatform}.${ext}`

            const assets = release.assets ?? []
            const asset = assets.find((a) => a.name === assetName)
            if (!asset?.browser_download_url) {
                log.error(`Could not find asset ${assetName} in tinymist release`)
                return
            }

            const downloadResponse = await fetch(asset.browser_download_url)
            if (!downloadResponse.ok) {
                log.error("Failed to download tinymist")
                return
            }

            const tempPath = path.join(Global.Path.bin, assetName)
            await Bun.file(tempPath).write(downloadResponse)

            if (ext === "zip") {
                const ok = await Archive.extractZip(tempPath, Global.Path.bin)
                    .then(() => true)
                    .catch((error) => {
                        log.error("Failed to extract tinymist archive", { error })
                        return false
                    })
                if (!ok) return
            } else {
                await $`tar -xzf ${tempPath} --strip-components=1`.cwd(Global.Path.bin).quiet().nothrow()
            }

            await fs.rm(tempPath, { force: true })

            bin = path.join(Global.Path.bin, "tinymist" + (platform === "win32" ? ".exe" : ""))

            if (!(await Bun.file(bin).exists())) {
                log.error("Failed to extract tinymist binary")
                return
            }

            if (platform !== "win32") {
                await $`chmod +x ${bin}`.quiet().nothrow()
            }

            log.info("installed tinymist", { bin })
        }

        return {
            process: spawn(bin, { cwd: root }),
        }
    },
}
