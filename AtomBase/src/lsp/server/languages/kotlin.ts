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

const log = Log.create({ service: "lsp.server.kotlin" })

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
