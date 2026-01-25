import { spawn } from "child_process"
import path from "path"
import { readableStreamToText } from "bun"
import { Log } from "../../../util/log"
import { Filesystem } from "../../../util/filesystem"
import { Instance } from "../../../project/instance"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.oxlint" })

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
                stop: Instance.worktree, // Assuming Instance.worktree is available and public
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
