import { spawn } from "child_process"
import path from "path"
import os from "os"
import { Global } from "../../global"
import { Log } from "../../util/log"
import { Flag } from "../../flag/flag"
import { Archive } from "../../util/archive"
import fs from "fs/promises"
import { NearestRoot, pathExists } from "../util"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.managed" })

export const JDTLS: Info = {
    id: "jdtls",
    root: NearestRoot(["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"]),
    extensions: [".java"],
    async spawn(root) {
        const java = Bun.which("java")
        if (!java) {
            log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
            return
        }
        const javaMajorVersion = await $`java -version`
            .quiet()
            .nothrow()
            .then(({ stderr }) => {
                const m = /"(\d+)\.\d+\.\d+"/.exec(stderr.toString())
                return !m ? undefined : parseInt(m[1])
            })
        if (javaMajorVersion == null || javaMajorVersion < 21) {
            log.error("JDTLS requires at least Java 21.")
            return
        }
        const distPath = path.join(Global.Path.bin, "jdtls")
        const launcherDir = path.join(distPath, "plugins")
        const installed = await pathExists(launcherDir)
        if (!installed) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("Downloading JDTLS LSP server.")
            await fs.mkdir(distPath, { recursive: true })
            const releaseURL =
                "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
            const archivePath = path.join(distPath, "release.tar.gz")
            await $`curl -L -o '${archivePath}' '${releaseURL}'`.quiet().nothrow()
            await $`tar -xzf ${archivePath}`.cwd(distPath).quiet().nothrow()
            await fs.rm(archivePath, { force: true })
        }
        const jarFileName = await $`ls org.eclipse.equinox.launcher_*.jar`
            .cwd(launcherDir)
            .quiet()
            .nothrow()
            .then(({ stdout }) => stdout.toString().trim())
        const launcherJar = path.join(launcherDir, jarFileName)
        if (!(await pathExists(launcherJar))) {
            log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
            return
        }
        const configFile = path.join(
            distPath,
            (() => {
                switch (process.platform) {
                    case "darwin":
                        return "config_mac"
                    case "linux":
                        return "config_linux"
                    case "win32":
                        return "config_win"
                    default:
                        return "config_linux"
                }
            })(),
        )
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-jdtls-data"))
        return {
            process: spawn(
                java,
                [
                    "-jar",
                    launcherJar,
                    "-configuration",
                    configFile,
                    "-data",
                    dataDir,
                    "-Declipse.application=org.eclipse.jdt.ls.core.id1",
                    "-Dosgi.bundles.defaultStartLevel=4",
                    "-Declipse.product=org.eclipse.jdt.ls.core.product",
                    "-Dlog.level=ALL",
                    "--add-modules=ALL-SYSTEM",
                    "--add-opens java.base/java.util=ALL-UNNAMED",
                    "--add-opens java.base/java.lang=ALL-UNNAMED",
                ],
                {
                    cwd: root,
                },
            ),
        }
    },
}

export const KotlinLS: Info = {
    id: "kotlin-ls",
    extensions: [".kt", ".kts"],
    root: async (file) => {
        // 1) Nearest Gradle root (multi-project or included build)
        const settingsRoot = await NearestRoot(["settings.gradle.kts", "settings.gradle"])(file)
        if (settingsRoot) return settingsRoot
        // 2) Gradle wrapper (strong root signal)
        const wrapperRoot = await NearestRoot(["gradlew", "gradlew.bat"])(file)
        if (wrapperRoot) return wrapperRoot
        // 3) Single-project or module-level build
        const buildRoot = await NearestRoot(["build.gradle.kts", "build.gradle"])(file)
        if (buildRoot) return buildRoot
        // 4) Maven fallback
        return NearestRoot(["pom.xml"])(file)
    },
    async spawn(root) {
        const distPath = path.join(Global.Path.bin, "kotlin-ls")
        const launcherScript =
            process.platform === "win32" ? path.join(distPath, "kotlin-lsp.cmd") : path.join(distPath, "kotlin-lsp.sh")
        const installed = await Bun.file(launcherScript).exists()
        if (!installed) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("Downloading Kotlin Language Server from GitHub.")

            const releaseResponse = await fetch("https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest")
            if (!releaseResponse.ok) {
                log.error("Failed to fetch kotlin-lsp release info")
                return
            }

            const release = await releaseResponse.json()
            const version = release.name?.replace(/^v/, "")

            if (!version) {
                log.error("Could not determine Kotlin LSP version from release")
                return
            }

            const platform = process.platform
            const arch = process.arch

            let kotlinArch: string = arch
            if (arch === "arm64") kotlinArch = "aarch64"
            else if (arch === "x64") kotlinArch = "x64"

            let kotlinPlatform: string = platform
            if (platform === "darwin") kotlinPlatform = "mac"
            else if (platform === "linux") kotlinPlatform = "linux"
            else if (platform === "win32") kotlinPlatform = "win"

            const supportedCombos = ["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"]

            const combo = `${kotlinPlatform}-${kotlinArch}`

            if (!supportedCombos.includes(combo)) {
                log.error(`Platform ${platform}/${arch} is not supported by Kotlin LSP`)
                return
            }

            const assetName = `kotlin-lsp-${version}-${kotlinPlatform}-${kotlinArch}.zip`
            const releaseURL = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${assetName}`

            await fs.mkdir(distPath, { recursive: true })
            const archivePath = path.join(distPath, "kotlin-ls.zip")
            await $`curl -L -o '${archivePath}' '${releaseURL}'`.quiet().nothrow()
            const ok = await Archive.extractZip(archivePath, distPath)
                .then(() => true)
                .catch((error) => {
                    log.error("Failed to extract Kotlin LS archive", { error })
                    return false
                })
            if (!ok) return
            await fs.rm(archivePath, { force: true })
            if (process.platform !== "win32") {
                await $`chmod +x ${launcherScript}`.quiet().nothrow()
            }
            log.info("Installed Kotlin Language Server", { path: launcherScript })
        }
        if (!(await Bun.file(launcherScript).exists())) {
            log.error(`Failed to locate the Kotlin LS launcher script in the installed directory: ${distPath}.`)
            return
        }
        return {
            process: spawn(launcherScript, ["--stdio"], {
                cwd: root,
            }),
        }
    },
}

export const CSharp: Info = {
    id: "csharp",
    root: NearestRoot([".sln", ".csproj", "global.json"]),
    extensions: [".cs"],
    async spawn(root) {
        let bin = Bun.which("csharp-ls", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            if (!Bun.which("dotnet")) {
                log.error(".NET SDK is required to install csharp-ls")
                return
            }

            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("installing csharp-ls via dotnet tool")
            const proc = Bun.spawn({
                cmd: ["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin],
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install csharp-ls")
                return
            }

            bin = path.join(Global.Path.bin, "csharp-ls" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed csharp-ls`, { bin })
        }

        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}

export const FSharp: Info = {
    id: "fsharp",
    root: NearestRoot([".sln", ".fsproj", "global.json"]),
    extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
    async spawn(root) {
        let bin = Bun.which("fsautocomplete", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })
        if (!bin) {
            if (!Bun.which("dotnet")) {
                log.error(".NET SDK is required to install fsautocomplete")
                return
            }

            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("installing fsautocomplete via dotnet tool")
            const proc = Bun.spawn({
                cmd: ["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin],
                stdout: "pipe",
                stderr: "pipe",
                stdin: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
                log.error("Failed to install fsautocomplete")
                return
            }

            bin = path.join(Global.Path.bin, "fsautocomplete" + (process.platform === "win32" ? ".exe" : ""))
            log.info(`installed fsautocomplete`, { bin })
        }

        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}

export const Clojure: Info = {
    id: "clojure-lsp",
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    root: NearestRoot(["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]),
    async spawn(root) {
        let bin = Bun.which("clojure-lsp")
        if (!bin && process.platform === "win32") {
            bin = Bun.which("clojure-lsp.exe")
        }
        if (!bin) {
            log.info("clojure-lsp not found, please install clojure-lsp first")
            return
        }
        return {
            process: spawn(bin, ["listen"], {
                cwd: root,
            }),
        }
    },
}
