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

const log = Log.create({ service: "lsp.server.zls" })

export const Zls: Info = {
    id: "zls",
    extensions: [".zig", ".zon"],
    root: NearestRoot(["build.zig"]),
    async spawn(root) {
        let bin = Bun.which("zls", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })

        if (!bin) {
            const zig = Bun.which("zig")
            if (!zig) {
                log.error("Zig is required to use zls. Please install Zig first.")
                return
            }

            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("downloading zls from GitHub releases")

            const releaseResponse = await fetch("https://api.github.com/repos/zigtools/zls/releases/latest")
            if (!releaseResponse.ok) {
                log.error("Failed to fetch zls release info")
                return
            }

            const release = (await releaseResponse.json()) as any

            const platform = process.platform
            const arch = process.arch
            let assetName = ""

            let zlsArch: string = arch
            if (arch === "arm64") zlsArch = "aarch64"
            else if (arch === "x64") zlsArch = "x86_64"
            else if (arch === "ia32") zlsArch = "x86"

            let zlsPlatform: string = platform
            if (platform === "darwin") zlsPlatform = "macos"
            else if (platform === "win32") zlsPlatform = "windows"

            const ext = platform === "win32" ? "zip" : "tar.xz"

            assetName = `zls-${zlsArch}-${zlsPlatform}.${ext}`

            const supportedCombos = [
                "zls-x86_64-linux.tar.xz",
                "zls-x86_64-macos.tar.xz",
                "zls-x86_64-windows.zip",
                "zls-aarch64-linux.tar.xz",
                "zls-aarch64-macos.tar.xz",
                "zls-aarch64-windows.zip",
                "zls-x86-linux.tar.xz",
                "zls-x86-windows.zip",
            ]

            if (!supportedCombos.includes(assetName)) {
                log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
                return
            }

            const asset = release.assets.find((a: any) => a.name === assetName)
            if (!asset) {
                log.error(`Could not find asset ${assetName} in latest zls release`)
                return
            }

            const downloadUrl = asset.browser_download_url
            const downloadResponse = await fetch(downloadUrl)
            if (!downloadResponse.ok) {
                log.error("Failed to download zls")
                return
            }

            const tempPath = path.join(Global.Path.bin, assetName)
            await Bun.file(tempPath).write(downloadResponse)

            if (ext === "zip") {
                const ok = await Archive.extractZip(tempPath, Global.Path.bin)
                    .then(() => true)
                    .catch((error) => {
                        log.error("Failed to extract zls archive", { error })
                        return false
                    })
                if (!ok) return
            } else {
                await $`tar -xf ${tempPath}`.cwd(Global.Path.bin).quiet().nothrow()
            }

            await fs.rm(tempPath, { force: true })

            bin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))

            if (!(await Bun.file(bin).exists())) {
                log.error("Failed to extract zls binary")
                return
            }

            if (platform !== "win32") {
                await $`chmod +x ${bin}`.quiet().nothrow()
            }

            log.info(`installed zls`, { bin })
        }

        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}
