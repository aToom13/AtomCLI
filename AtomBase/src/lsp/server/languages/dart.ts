import { spawn } from "child_process"
import { NearestRoot } from "../common"
import { Log } from "../../../util/log"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.dart" })

export const Dart: Info = {
    id: "dart",
    extensions: [".dart"],
    root: NearestRoot(["pubspec.yaml", "analysis_options.yaml"]),
    async spawn(root) {
        const dart = Bun.which("dart")
        if (!dart) {
            log.info("dart not found, please install dart first")
            return
        }
        return {
            process: spawn(dart, ["language-server", "--lsp"], {
                cwd: root,
            }),
        }
    },
}
