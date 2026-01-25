import { spawn } from "child_process"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { $ } from "bun"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { Flag } from "../../../flag/flag"
import { NearestRoot, pathExists } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.jdtls" })

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
