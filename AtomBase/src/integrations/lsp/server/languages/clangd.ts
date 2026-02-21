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

const log = Log.create({ service: "lsp.server.clangd" })

export const Clangd: Info = {
    id: "clangd",
    root: NearestRoot(["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt", "Makefile"]),
    extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
    async spawn(root) {
        const args = ["--background-index", "--clang-tidy"]
        const fromPath = Bun.which("clangd")
        if (fromPath) {
            return {
                process: spawn(fromPath, args, {
                    cwd: root,
                }),
            }
        }

        const ext = process.platform === "win32" ? ".exe" : ""
        const direct = path.join(Global.Path.bin, "clangd" + ext)
        if (await Bun.file(direct).exists()) {
            return {
                process: spawn(direct, args, {
                    cwd: root,
                }),
            }
        }

        const entries = await fs.readdir(Global.Path.bin, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            if (!entry.name.startsWith("clangd_")) continue
            const candidate = path.join(Global.Path.bin, entry.name, "bin", "clangd" + ext)
            if (await Bun.file(candidate).exists()) {
                return {
                    process: spawn(candidate, args, {
                        cwd: root,
                    }),
                }
            }
        }

        if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading clangd from GitHub releases")

        const releaseResponse = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest")
        if (!releaseResponse.ok) {
            log.error("Failed to fetch clangd release info")
            return
        }

        const release: {
            tag_name?: string
            assets?: { name?: string; browser_download_url?: string }[]
        } = await releaseResponse.json()

        const tag = release.tag_name
        if (!tag) {
            log.error("clangd release did not include a tag name")
            return
        }
        const platform = process.platform
        const tokens: Record<string, string> = {
            darwin: "mac",
            linux: "linux",
            win32: "windows",
        }
        const token = tokens[platform]
        if (!token) {
            log.error(`Platform ${platform} is not supported by clangd auto-download`)
            return
        }

        const assets = release.assets ?? []
        const valid = (item: { name?: string; browser_download_url?: string }) => {
            if (!item.name) return false
            if (!item.browser_download_url) return false
            if (!item.name.includes(token)) return false
            return item.name.includes(tag)
        }

        const asset =
            assets.find((item) => valid(item) && item.name?.endsWith(".zip")) ??
            assets.find((item) => valid(item) && item.name?.endsWith(".tar.xz")) ??
            assets.find((item) => valid(item))
        if (!asset?.name || !asset.browser_download_url) {
            log.error("clangd could not match release asset", { tag, platform })
            return
        }

        const name = asset.name
        const downloadResponse = await fetch(asset.browser_download_url)
        if (!downloadResponse.ok) {
            log.error("Failed to download clangd")
            return
        }

        const archive = path.join(Global.Path.bin, name)
        const buf = await downloadResponse.arrayBuffer()
        if (buf.byteLength === 0) {
            log.error("Failed to write clangd archive")
            return
        }
        await Bun.write(archive, buf)

        const zip = name.endsWith(".zip")
        const tar = name.endsWith(".tar.xz")
        if (!zip && !tar) {
            log.error("clangd encountered unsupported asset", { asset: name })
            return
        }

        if (zip) {
            const ok = await Archive.extractZip(archive, Global.Path.bin)
                .then(() => true)
                .catch((error) => {
                    log.error("Failed to extract clangd archive", { error })
                    return false
                })
            if (!ok) return
        }
        if (tar) {
            await $`tar -xf ${archive}`.cwd(Global.Path.bin).quiet().nothrow()
        }
        await fs.rm(archive, { force: true })

        const bin = path.join(Global.Path.bin, "clangd_" + tag, "bin", "clangd" + ext)
        if (!(await Bun.file(bin).exists())) {
            log.error("Failed to extract clangd binary")
            return
        }

        if (platform !== "win32") {
            await $`chmod +x ${bin}`.quiet().nothrow()
        }

        await fs.unlink(path.join(Global.Path.bin, "clangd")).catch(() => { })
        await fs.symlink(bin, path.join(Global.Path.bin, "clangd")).catch(() => { })

        log.info(`installed clangd`, { bin })

        return {
            process: spawn(bin, args, {
                cwd: root,
            }),
        }
    },
}
