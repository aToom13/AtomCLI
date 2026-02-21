import { spawn } from "child_process"
import path from "path"
import { Log } from "@/util/util/log"
import { Instance } from "@/services/project/instance"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.rust" })

export const RustAnalyzer: Info = {
    id: "rust",
    root: async (root) => {
        const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(root)
        if (crateRoot === undefined) {
            return undefined
        }
        let currentDir = crateRoot

        while (currentDir !== path.dirname(currentDir)) {
            // Stop at filesystem root
            const cargoTomlPath = path.join(currentDir, "Cargo.toml")
            try {
                const cargoTomlContent = await Bun.file(cargoTomlPath).text()
                if (cargoTomlContent.includes("[workspace]")) {
                    return currentDir
                }
            } catch (err) {
                // File doesn't exist or can't be read, continue searching up
            }

            const parentDir = path.dirname(currentDir)
            if (parentDir === currentDir) break // Reached filesystem root
            currentDir = parentDir

            // Stop if we've gone above the app root
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
