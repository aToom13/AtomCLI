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

const log = Log.create({ service: "lsp.server.script" })

export const Deno: Info = {
    id: "deno",
    root: NearestRoot(["deno.json", "deno.jsonc"]),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    async spawn(root) {
        // Check if Deno is available
        const deno = Bun.which("deno")
        if (!deno) {
            log.info("deno not found")
            return
        }
        return {
            process: spawn(deno, ["lsp"], {
                cwd: root,
            }),
        }
    },
}

export const Rubocop: Info = {
    id: "ruby-lsp",
    root: NearestRoot(["Gemfile"]),
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    async spawn(root) {
        let bin = Bun.which("rubocop", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            const ruby = Bun.which("ruby")
            const gem = Bun.which("gem")
            if (!ruby || !gem) {
                log.info("Ruby not found, please install Ruby first")
                return
            }
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("installing rubocop")
            const proc = Bun.spawn({
                cmd: ["gem", "install", "rubocop", "--bindir", Global.Path.bin],
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install rubocop")
                return
            }
            bin = path.join(Global.Path.bin, "rubocop" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed rubocop`, {
                bin,
            })
        }
        return {
            process: spawn(bin!, ["--lsp"], {
                cwd: root,
            }),
        }
    },
}

export const Ty: Info = {
    id: "ty",
    extensions: [".py", ".pyi"],
    root: NearestRoot([
        "pyproject.toml",
        "ty.toml",
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "Pipfile",
        "pyrightconfig.json",
    ]),
    async spawn(root) {
        if (!Flag.ATOMCLI_EXPERIMENTAL_LSP_TY) {
            return undefined
        }

        let binary = Bun.which("ty")

        const initialization: Record<string, string> = {}

        const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
            (p): p is string => p !== undefined,
        )
        for (const venvPath of potentialVenvPaths) {
            const isWindows = process.platform === "win32"
            const potentialPythonPath = isWindows
                ? path.join(venvPath, "Scripts", "python.exe")
                : path.join(venvPath, "bin", "python")
            if (await Bun.file(potentialPythonPath).exists()) {
                initialization["pythonPath"] = potentialPythonPath
                break
            }
        }

        if (!binary) {
            for (const venvPath of potentialVenvPaths) {
                const isWindows = process.platform === "win32"
                const potentialTyPath = isWindows
                    ? path.join(venvPath, "Scripts", "ty.exe")
                    : path.join(venvPath, "bin", "ty")
                if (await Bun.file(potentialTyPath).exists()) {
                    binary = potentialTyPath
                    break
                }
            }
        }

        if (!binary) {
            log.error("ty not found, please install ty first")
            return
        }

        const proc = spawn(binary, ["server"], {
            cwd: root,
        })

        return {
            process: proc,
            initialization,
        }
    },
}

export const Pyright: Info = {
    id: "pyright",
    extensions: [".py", ".pyi"],
    root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
    async spawn(root) {
        let binary = Bun.which("pyright-langserver")
        const args = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "pyright", "dist", "pyright-langserver.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "pyright"], {
                    cwd: Global.Path.bin,
                    env: {
                        ...process.env,
                        BUN_BE_BUN: "1",
                    },
                }).exited
            }
            binary = BunProc.which()
            args.push(...["run", js])
        }
        args.push("--stdio")

        const initialization: Record<string, string> = {}

        const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
            (p): p is string => p !== undefined,
        )
        for (const venvPath of potentialVenvPaths) {
            const isWindows = process.platform === "win32"
            const potentialPythonPath = isWindows
                ? path.join(venvPath, "Scripts", "python.exe")
                : path.join(venvPath, "bin", "python")
            if (await Bun.file(potentialPythonPath).exists()) {
                initialization["pythonPath"] = potentialPythonPath
                break
            }
        }

        const proc = spawn(binary, args, {
            cwd: root,
            env: {
                ...process.env,
                BUN_BE_BUN: "1",
            },
        })
        return {
            process: proc,
            initialization,
        }
    },
}

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

            const installDir = path.join(Global.Path.bin, `lua-language-server-${lualsArch}-${lualsPlatform}`)

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

export const BashLS: Info = {
    id: "bash",
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    root: async (file) => {
        // Basic implementation as in original server.ts
        const dir = path.dirname(file)
        // Return direct parent as fallback root or try to find NearestRoot patterns if needed
        // The original code returned Instance.directory async() which is flawed if global. 
        // Original: async () => Instance.directory
        // We should replicate that behavior if it's the intended logic.
        return Instance.directory
    },
    async spawn(root) {
        let binary = Bun.which("bash-language-server")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "bash-language-server", "out", "cli.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "bash-language-server"], {
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
        args.push("start")
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
