import { spawn } from "child_process"
import path from "path"
import { BunProc } from "../../../bun"
import { NearestRoot } from "../common"
import type { Info } from "../types"

export const Biome: Info = {
    id: "biome",
    root: NearestRoot([
        "biome.json",
        "biome.jsonc",
        "package-lock.json",
        "bun.lockb",
        "bun.lock",
        "pnpm-lock.yaml",
        "yarn.lock",
    ]),
    extensions: [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".mts",
        ".cts",
        ".json",
        ".jsonc",
        ".vue",
        ".astro",
        ".svelte",
        ".css",
        ".graphql",
        ".gql",
        ".html",
    ],
    async spawn(root) {
        const localBin = path.join(root, "node_modules", ".bin", "biome")
        let bin: string | undefined
        if (await Bun.file(localBin).exists()) bin = localBin
        if (!bin) {
            const found = Bun.which("biome")
            if (found) bin = found
        }

        let args = ["lsp-proxy", "--stdio"]

        if (!bin) {
            const resolved = await Bun.resolve("biome", root).catch(() => undefined)
            if (!resolved) return
            bin = BunProc.which()
            args = ["x", "biome", "lsp-proxy", "--stdio"]
        }

        const proc = spawn(bin, args, {
            cwd: root,
            env: {
                ...process.env,
                BUN_BE_BUN: "1",
            },
        })

        return {
            process: proc,
        }
    },
}
