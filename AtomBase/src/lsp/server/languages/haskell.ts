import { spawn } from "child_process"
import { Log } from "../../../util/log"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.haskell" })

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
