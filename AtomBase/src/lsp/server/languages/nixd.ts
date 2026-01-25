import { spawn } from "child_process"
import { Log } from "../../../util/log"
import { Instance } from "../../../project/instance"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.nixd" })

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
