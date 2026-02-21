import { spawn } from "child_process"
import { $ } from "bun"
import { NearestRoot } from "../common"
import type { Info } from "../types"

export const SourceKit: Info = {
    id: "sourcekit-lsp",
    extensions: [".swift", ".objc", "objcpp"],
    root: NearestRoot(["Package.swift", "*.xcodeproj", "*.xcworkspace"]),
    async spawn(root) {
        // Check if sourcekit-lsp is available in the PATH
        // This is installed with the Swift toolchain
        const sourcekit = Bun.which("sourcekit-lsp")
        if (sourcekit) {
            return {
                process: spawn(sourcekit, {
                    cwd: root,
                }),
            }
        }

        // If sourcekit-lsp not found, check if xcrun is available
        // This is specific to macOS where sourcekit-lsp is typically installed with Xcode
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
