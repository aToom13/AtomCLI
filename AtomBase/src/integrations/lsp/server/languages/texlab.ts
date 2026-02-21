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

const log = Log.create({ service: "lsp.server.texlab" })

export const TexLab: Info = {
    id: "texlab",
    extensions: [".tex", ".bib"],
    root: NearestRoot([".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"]),
    async spawn(root) {
        let bin = Bun.which("texlab", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })

        if (!bin) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("downloading texlab from GitHub releases")

            const response = await fetch("https://api.github.com/repos/latex-lsp/texlab/releases/latest")
            if (!response.ok) {
                log.error("Failed to fetch texlab release info")
                return
            }

            const release = (await response.json()) as {
                tag_name?: string
                assets?: { name?: string; browser_download_url?: string }[]
            }
            const version = release.tag_name?.replace("v", "")
            if (!version) {
                log.error("texlab release did not include a version tag")
                return
            }

            const platform = process.platform
            const arch = process.arch

            const texArch = arch === "arm64" ? "aarch64" : "x86_64"
            const texPlatform = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux"
            const ext = platform === "win32" ? "zip" : "tar.gz"
            const assetName = `texlab-${texArch}-${texPlatform}.${ext}`

            const assets = release.assets ?? []
            const asset = assets.find((a) => a.name === assetName)
            if (!asset?.browser_download_url) {
                log.error(`Could not find asset ${assetName} in texlab release`)
                return
            }

            const downloadResponse = await fetch(asset.browser_download_url)
            if (!downloadResponse.ok) {
                log.error("Failed to download texlab")
                return
            }

            const tempPath = path.join(Global.Path.bin, assetName)
            await Bun.file(tempPath).write(downloadResponse)

            if (ext === "zip") {
                const ok = await Archive.extractZip(tempPath, Global.Path.bin)
                    .then(() => true)
                    .catch((error) => {
                        log.error("Failed to extract texlab archive", { error })
                        return false
                    })
                if (!ok) return
            }
            if (ext === "tar.gz") {
                await $`tar -xzf ${tempPath}`.cwd(Global.Path.bin).quiet().nothrow()
            }

            await fs.rm(tempPath, { force: true })

            bin = path.join(Global.Path.bin, "texlab" + (platform === "win32" ? ".exe" : ""))

            if (!(await Bun.file(bin).exists())) {
                log.error("Failed to extract texlab binary")
                return
            }

            if (platform !== "win32") {
                await $`chmod +x ${bin}`.quiet().nothrow()
            }

            log.info("installed texlab", { bin })
        }

        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}
