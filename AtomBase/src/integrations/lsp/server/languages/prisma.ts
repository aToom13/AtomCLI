import { spawn } from "child_process"
import { NearestRoot } from "../common"
import { Log } from "@/util/util/log"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.prisma" })

export const Prisma: Info = {
    id: "prisma",
    extensions: [".prisma"],
    root: NearestRoot(["schema.prisma", "prisma/schema.prisma", "prisma"], ["package.json"]),
    async spawn(root) {
        const prisma = Bun.which("prisma")
        if (!prisma) {
            log.info("prisma not found, please install prisma")
            return
        }
        return {
            process: spawn(prisma, ["language-server"], {
                cwd: root,
            }),
        }
    },
}
