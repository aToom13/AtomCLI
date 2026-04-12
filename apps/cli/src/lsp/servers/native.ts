import { spawn } from "child_process"
import path from "path"
import { Global } from "../../global"
import { Log } from "../../util/log"
import { BunProc } from "../../bun"
import { Flag } from "../../flag/flag"
import { Archive } from "../../util/archive"
import fs from "fs/promises"
import { NearestRoot } from "../util"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.native" })

export const Gopls: Info = {
    id: "gopls",
    root: async (file) => {
        const work = await NearestRoot(["go.work"])(file)
        if (work) return work
        return NearestRoot(["go.mod", "go.sum"])(file)
    },
    extensions: [".go"],
    async spawn(root) {
        let bin = Bun.which("gopls", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            if (!Bun.which("go")) return
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return

            log.info("installing gopls")
            const proc = Bun.spawn({
                cmd: ["go", "install", "golang.org/x/tools/gopls@latest"],
                env: { ...process.env, GOBIN: Global.Path.bin },
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install gopls")
                return
            }
            bin = path.join(Global.Path.bin, "gopls" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed gopls`, {
                bin,
            })
        }
        return {
            process: spawn(bin!, {
                cwd: root,
            }),
        }
    },
}

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

            let zlsArch: string = arch
            if (arch === "arm64") zlsArch = "aarch64"
            else if (arch === "x64") zlsArch = "x86_64"
            else if (arch === "ia32") zlsArch = "x86"

            let zlsPlatform: string = platform
            if (platform === "darwin") zlsPlatform = "macos"
            else if (platform === "win32") zlsPlatform = "windows"

            const ext = platform === "win32" ? "zip" : "tar.xz"

            const assetName = `zls-${zlsArch}-${zlsPlatform}.${ext}`

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

export const SourceKit: Info = {
    id: "sourcekit-lsp",
    extensions: [".swift", ".objc", "objcpp"],
    root: NearestRoot(["Package.swift", "*.xcodeproj", "*.xcworkspace"]),
    async spawn(root) {
        const sourcekit = Bun.which("sourcekit-lsp")
        if (sourcekit) {
            return {
                process: spawn(sourcekit, {
                    cwd: root,
                }),
            }
        }

        if (!Bun.which("xcrun")) return

        const lspLoc = await $`xcrun --find sourcekit-lsp`.quiet().nothrow()

        if (lspLoc.exitCode !== 0) return

        const bin = lspLoc.text().trim()

        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}

export const RustAnalyzer: Info = {
    id: "rust",
    root: async (root) => {
        const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(root)
        if (crateRoot === undefined) {
            return undefined
        }
        let currentDir = crateRoot as string

        while (currentDir !== path.dirname(currentDir)) {
            const cargoTomlPath = path.join(currentDir, "Cargo.toml")
            try {
                const cargoTomlContent = await Bun.file(cargoTomlPath).text()
                if (cargoTomlContent.includes("[workspace]")) {
                    return currentDir
                }
            } catch (err) { }

            const parentDir = path.dirname(currentDir)
            if (parentDir === currentDir) break
            currentDir = parentDir

            if (!currentDir.startsWith(Instance.worktree)) break
        }

        return crateRoot
    },
    extensions: [".rs"],
    async spawn(root) {
        const bin = Bun.which("rust-analyzer")
        if (!bin) {
            log.info("rust-analyzer not found in path, please install it")
            return
        }
        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}

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

export const Dart: Info = {
    id: "dart",
    extensions: [".dart"],
    root: NearestRoot(["pubspec.yaml", "analysis_options.yaml"]),
    async spawn(root) {
        const dart = Bun.which("dart")
        if (!dart) {
            log.info("dart not found, please install dart first")
            return
        }
        return {
            process: spawn(dart, ["language-server", "--lsp"], {
                cwd: root,
            }),
        }
    },
}

export const Ocaml: Info = {
    id: "ocaml-lsp",
    extensions: [".ml", ".mli"],
    root: NearestRoot(["dune-project", "dune-workspace", ".merlin", "opam"]),
    async spawn(root) {
        const bin = Bun.which("ocamllsp")
        if (!bin) {
            log.info("ocamllsp not found, please install ocaml-lsp-server")
            return
        }
        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}

export const Gleam: Info = {
    id: "gleam",
    extensions: [".gleam"],
    root: NearestRoot(["gleam.toml"]),
    async spawn(root) {
        const gleam = Bun.which("gleam")
        if (!gleam) {
            log.info("gleam not found, please install gleam first")
            return
        }
        return {
            process: spawn(gleam, ["lsp"], {
                cwd: root,
            }),
        }
    },
}

export const HLS: Info = {
    id: "haskell-language-server",
    extensions: [".hs", ".lhs"],
    root: NearestRoot(["stack.yaml", "cabal.project", "hie.yaml", "*.cabal"]),
    async spawn(root) {
        const bin = Bun.which("haskell-language-server-wrapper")
        if (!bin) {
            log.info("haskell-language-server-wrapper not found, please install haskell-language-server")
            return
        }
        return {
            process: spawn(bin, ["--lsp"], {
                cwd: root,
            }),
        }
    },
}
