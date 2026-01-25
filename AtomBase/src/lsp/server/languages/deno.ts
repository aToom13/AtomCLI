import { spawn } from "child_process"
import path from "path"
import { Log } from "../../../util/log"
import { Filesystem } from "../../../util/filesystem"
import { Instance } from "../../../project/instance"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.deno" })

export const Deno: Info = {
    id: "deno",
    root: async (file) => {
        const files = Filesystem.up({
            targets: ["deno.json", "deno.jsonc"],
            start: path.dirname(file),
            stop: Instance.directory,
        })
        const first = await files.next()
        await files.return()
        if (!first.value) return undefined
        return path.dirname(first.value)
    },
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    async spawn(root) {
        const deno = Bun.which("deno")
        if (!deno) {
            log.info("deno not found, please install deno first")
            return
        }
        return {
            process: spawn(deno, ["lsp"], {
                cwd: root,
            }),
        }
    },
}
