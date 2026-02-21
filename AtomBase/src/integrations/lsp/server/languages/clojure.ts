import { spawn } from "child_process"
import { Log } from "@/util/util/log"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.clojure" })

export const Clojure: Info = {
    id: "clojure-lsp",
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    root: NearestRoot(["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]),
    async spawn(root) {
        let bin = Bun.which("clojure-lsp")
        if (!bin && process.platform === "win32") {
            bin = Bun.which("clojure-lsp.exe")
        }
        if (!bin) {
            log.info("clojure-lsp not found, please install clojure-lsp first")
            return
        }
        return {
            process: spawn(bin, ["listen"], {
                cwd: root,
            }),
        }
    },
}
