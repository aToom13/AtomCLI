import { spawn } from "child_process"
import { NearestRoot } from "../common"
import { Log } from "../../../util/log"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.ocaml" })

export const Ocaml: Info = {
    id: "ocaml-lsp",
    extensions: [".ml", ".mli"],
    root: NearestRoot(["dune-project", "dune-workspace", ".merlin", "opam"]),
    async spawn(root) {
        const bin = Bun.which("ocamllsp")
        if (!bin) {
            log.info("ocamllsp not found, please install ocaml-lsp-server")
            return
        }
        return {
            process: spawn(bin, {
                cwd: root,
            }),
        }
    },
}
