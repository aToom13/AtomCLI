import { spawn } from "child_process"
import path from "path"
import { readableStreamToText } from "bun"
import { Global } from "../../global"
import { Log } from "../../util/log"
import { BunProc } from "../../bun"
import fs from "fs/promises"
import { Instance } from "../../project/instance"
import { Flag } from "../../flag/flag"
import { Archive } from "../../util/archive"
import { Filesystem } from "../../util/filesystem"
import { NearestRoot } from "../util"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.web" })

export const Typescript: Info = {
    id: "typescript",
    root: NearestRoot(
        ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
        ["deno.json", "deno.jsonc"],
    ),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    async spawn(root) {
        const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => { })
        log.info("typescript server", { tsserver })
        if (!tsserver) return
        const proc = spawn(BunProc.which(), ["x", "typescript-language-server", "--stdio"], {
            cwd: root,
            env: {
                ...process.env,
                BUN_BE_BUN: "1",
            },
        })
        return {
            process: proc,
            initialization: {
                tsserver: {
                    path: tsserver,
                },
            },
        }
    },
}

export const Vue: Info = {
    id: "vue",
    extensions: [".vue"],
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    async spawn(root) {
        let binary = Bun.which("vue-language-server")
        const args: string[] = []
        if (!binary) {
            const js = path.join(
                Global.Path.bin,
                "node_modules",
                "@vue",
                "language-server",
                "bin",
                "vue-language-server.js",
            )
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "@vue/language-server"], {
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
            initialization: {
                // Leave empty; the server will auto-detect workspace TypeScript.
            },
        }
    },
}

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

export const Oxlint: Info = {
    id: "oxlint",
    root: NearestRoot([
        ".oxlintrc.json",
        "package-lock.json",
        "bun.lockb",
        "bun.lock",
        "pnpm-lock.yaml",
        "yarn.lock",
        "package.json",
    ]),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
    async spawn(root) {
        const ext = process.platform === "win32" ? ".cmd" : ""

        const serverTarget = path.join("node_modules", ".bin", "oxc_language_server" + ext)
        const lintTarget = path.join("node_modules", ".bin", "oxlint" + ext)

        const resolveBin = async (target: string) => {
            const localBin = path.join(root, target)
            if (await Bun.file(localBin).exists()) return localBin

            const candidates = Filesystem.up({
                targets: [target],
                start: root,
                stop: Instance.worktree,
            })
            const first = await candidates.next()
            await candidates.return()
            if (first.value) return first.value

            return undefined
        }

        let lintBin = await resolveBin(lintTarget)
        if (!lintBin) {
            const found = Bun.which("oxlint")
            if (found) lintBin = found
        }

        if (lintBin) {
            const proc = Bun.spawn([lintBin, "--help"], { stdout: "pipe" })
            await proc.exited
            const help = await readableStreamToText(proc.stdout)
            if (help.includes("--lsp")) {
                return {
                    process: spawn(lintBin, ["--lsp"], {
                        cwd: root,
                    }),
                }
            }
        }

        let serverBin = await resolveBin(serverTarget)
        if (!serverBin) {
            const found = Bun.which("oxc_language_server")
            if (found) serverBin = found
        }
        if (serverBin) {
            return {
                process: spawn(serverBin, [], {
                    cwd: root,
                }),
            }
        }

        log.info("oxlint not found, please install oxlint")
        return
    },
}

export const Biome: Info = {
    id: "biome",
    root: NearestRoot([
        "biome.json",
        "biome.jsonc",
        "package-lock.json",
        "bun.lockb",
        "bun.lock",
        "pnpm-lock.yaml",
        "yarn.lock",
    ]),
    extensions: [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".mts",
        ".cts",
        ".json",
        ".jsonc",
        ".vue",
        ".astro",
        ".svelte",
        ".css",
        ".graphql",
        ".gql",
        ".html",
    ],
    async spawn(root) {
        const localBin = path.join(root, "node_modules", ".bin", "biome")
        let bin: string | undefined
        if (await Bun.file(localBin).exists()) bin = localBin
        if (!bin) {
            const found = Bun.which("biome")
            if (found) bin = found
        }

        let args = ["lsp-proxy", "--stdio"]

        if (!bin) {
            const resolved = await Bun.resolve("biome", root).catch(() => undefined)
            if (!resolved) return
            bin = BunProc.which()
            args = ["x", "biome", "lsp-proxy", "--stdio"]
        }

        const proc = spawn(bin, args, {
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

export const Svelte: Info = {
    id: "svelte",
    extensions: [".svelte"],
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    async spawn(root) {
        let binary = Bun.which("svelteserver")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "svelte-language-server", "bin", "server.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "svelte-language-server"], {
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
            initialization: {},
        }
    },
}

export const Astro: Info = {
    id: "astro",
    extensions: [".astro"],
    root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
    async spawn(root) {
        const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => { })
        if (!tsserver) {
            log.info("typescript not found, required for Astro language server")
            return
        }
        const tsdk = path.dirname(tsserver)

        let binary = Bun.which("astro-ls")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "@astrojs", "language-server", "bin", "nodeServer.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "@astrojs/language-server"], {
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
            initialization: {
                typescript: {
                    tsdk,
                },
            },
        }
    },
}

export const PHPIntelephense: Info = {
    id: "php intelephense",
    extensions: [".php"],
    root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
    async spawn(root) {
        let binary = Bun.which("intelephense")
        const args: string[] = []
        if (!binary) {
            const js = path.join(Global.Path.bin, "node_modules", "intelephense", "lib", "intelephense.js")
            if (!(await Bun.file(js).exists())) {
                if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
                await Bun.spawn([BunProc.which(), "install", "intelephense"], {
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
            initialization: {
                telemetry: {
                    enabled: false,
                },
            },
        }
    },
}

export const Prisma: Info = {
    id: "prisma",
    extensions: [".prisma"],
    root: NearestRoot(["schema.prisma", "prisma/schema.prisma", "prisma"], ["package.json"]),
    async spawn(root) {
        const prisma = Bun.which("prisma")
        if (!prisma) {
            log.info("prisma not found, please install prisma")
            return
        }
        return {
            process: spawn(prisma, ["language-server"], {
                cwd: root,
            }),
        }
    },
}
