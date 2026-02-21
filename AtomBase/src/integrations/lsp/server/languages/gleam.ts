import { spawn } from "child_process"
import { Log } from "@/util/util/log"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.gleam" })

export const Gleam: Info = {
    id: "gleam",
    extensions: [".gleam"],
    root: NearestRoot(["gleam.toml"]),
    async spawn(root) {
        const gleam = Bun.which("gleam")
        if (!gleam) {
            log.info("gleam not found, please install gleam first")
            return
        }
        return {
            process: spawn(gleam, ["lsp"], {
                cwd: root,
            }),
        }
    },
}
