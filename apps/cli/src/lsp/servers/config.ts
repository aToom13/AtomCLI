import { spawn } from "child_process"
import path from "path"
import os from "os"
import { Global } from "../../global"
import { Log } from "../../util/log"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Archive } from "../../util/archive"
import fs from "fs/promises"
import { Instance } from "../../project/instance"
import { NearestRoot } from "../util"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.config" })

export const YamlLS: Info = {
    id: "yaml-ls",
    extensions: [".yaml", ".yml"],
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    async spawn(root) {
        let binary = Bun.which("yaml-language-server")
        const args: string[] = []
        if (!binary) {
            const js = path.join(
                Global.Path.bin,
                "node_modules",
                "yaml-language-server",
                "out",
                "server",
                "src",
                "server.js",
            )
            const exists = await Bun.file(js).exists()
            if (!exists) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "yaml-language-server"], {
                    cwd: Global.Path.bin,
                    env: {
                        ...process.env,
                        BUN_BE_BUN: "1",
                    },
                    stdout: "pipe",
                    stderr: "pipe",
                    stdin: "pipe",
                }).exited
            }
            binary = BunProc.which()
            args.push("run", js)
        }
        args.push("--stdio")
        const proc = spawn(binary, args, {
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

export const TerraformLS: Info = {
    id: "terraform",
    extensions: [".tf", ".tfvars"],
    root: NearestRoot([".terraform.lock.hcl", "terraform.tfstate", "*.tf"]),
    async spawn(root) {
        let bin = Bun.which("terraform-ls", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })

        if (!bin) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("downloading terraform-ls from GitHub releases")

            const releaseResponse = await fetch("https://api.github.com/repos/hashicorp/terraform-ls/releases/latest")
            if (!releaseResponse.ok) {
                log.error("Failed to fetch terraform-ls release info")
                return
            }

            const release = (await releaseResponse.json()) as {
                tag_name?: string
                assets?: { name?: string; browser_download_url?: string }[]
            }
            const version = release.tag_name?.replace("v", "")
            if (!version) {
                log.error("terraform-ls release did not include a version tag")
                return
            }

            const platform = process.platform
            const arch = process.arch

            const tfArch = arch === "arm64" ? "arm64" : "amd64"
            const tfPlatform = platform === "win32" ? "windows" : platform

            const assetName = `terraform-ls_${version}_${tfPlatform}_${tfArch}.zip`

            const assets = release.assets ?? []
            const asset = assets.find((a) => a.name === assetName)
            if (!asset?.browser_download_url) {
                log.error(`Could not find asset ${assetName} in terraform-ls release`)
                return
            }

            const downloadResponse = await fetch(asset.browser_download_url)
            if (!downloadResponse.ok) {
                log.error("Failed to download terraform-ls")
                return
            }

            const tempPath = path.join(Global.Path.bin, assetName)
            await Bun.file(tempPath).write(downloadResponse)

            const ok = await Archive.extractZip(tempPath, Global.Path.bin)
                .then(() => true)
                .catch((error) => {
                    log.error("Failed to extract terraform-ls archive", { error })
                    return false
                })
            if (!ok) return
            await fs.rm(tempPath, { force: true })

            bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))

            if (!(await Bun.file(bin).exists())) {
                log.error("Failed to extract terraform-ls binary")
                return
            }

            if (platform !== "win32") {
                await $`chmod +x ${bin}`.quiet().nothrow()
            }

            log.info(`installed terraform-ls`, { bin })
        }

        return {
            process: spawn(bin, ["serve"], {
                cwd: root,
            }),
            initialization: {
                experimentalFeatures: {
                    prefillRequiredFields: true,
                    validateOnSave: true,
                },
            },
        }
    },
}

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

export const DockerfileLS: Info = {
    id: "dockerfile",
    extensions: [".dockerfile", "Dockerfile"],
    root: async () => Instance.directory,
    async spawn(root) {
        let binary = Bun.which("docker-langserver")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "dockerfile-language-server-nodejs", "lib", "server.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "dockerfile-language-server-nodejs"], {
                    cwd: Global.Path.bin,
                    env: {
                        ...process.env,
                        BUN_BE_BUN: "1",
                    },
                    stdout: "pipe",
                    stderr: "pipe",
                    stdin: "pipe",
                }).exited
            }
            binary = BunProc.which()
            args.push("run", js)
        }
        args.push("--stdio")
        const proc = spawn(binary, args, {
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

export const Nixd: Info = {
    id: "nixd",
    extensions: [".nix"],
    root: async (file) => {
        // First, look for flake.nix - the most reliable Nix project root indicator
        const flakeRoot = await NearestRoot(["flake.nix"])(file)
        if (flakeRoot && flakeRoot !== Instance.directory) return flakeRoot

        // If no flake.nix, fall back to git repository root
        if (Instance.worktree && Instance.worktree !== Instance.directory) return Instance.worktree

        // Finally, use the instance directory as fallback
        return Instance.directory
    },
    async spawn(root) {
        const nixd = Bun.which("nixd")
        if (!nixd) {
            log.info("nixd not found, please install nixd first")
            return
        }
        return {
            process: spawn(nixd, [], {
                cwd: root,
                env: {
                    ...process.env,
                },
            }),
        }
    },
}

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
