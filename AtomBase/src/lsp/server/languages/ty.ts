import { spawn } from "child_process"
import path from "path"
import { Log } from "../../../util/log"
import { Flag } from "../../../flag/flag"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.ty" })

export const Ty: Info = {
    id: "ty",
    extensions: [".py", ".pyi"],
    root: NearestRoot([
        "pyproject.toml",
        "ty.toml",
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "Pipfile",
        "pyrightconfig.json",
    ]),
    async spawn(root) {
        if (!Flag.ATOMCLI_EXPERIMENTAL_LSP_TY) {
            return undefined
        }

        let binary = Bun.which("ty")

        const initialization: Record<string, string> = {}

        const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
            (p): p is string => p !== undefined,
        )
        for (const venvPath of potentialVenvPaths) {
            const isWindows = process.platform === "win32"
            const potentialPythonPath = isWindows
                ? path.join(venvPath, "Scripts", "python.exe")
                : path.join(venvPath, "bin", "python")
            if (await Bun.file(potentialPythonPath).exists()) {
                initialization["pythonPath"] = potentialPythonPath
                break
            }
        }

        if (!binary) {
            for (const venvPath of potentialVenvPaths) {
                const isWindows = process.platform === "win32"
                const potentialTyPath = isWindows
                    ? path.join(venvPath, "Scripts", "ty.exe")
                    : path.join(venvPath, "bin", "ty")
                if (await Bun.file(potentialTyPath).exists()) {
                    binary = potentialTyPath
                    break
                }
            }
        }

        if (!binary) {
            log.error("ty not found, please install ty first")
            return
        }

        const proc = spawn(binary, ["server"], {
            cwd: root,
        })

        return {
            process: proc,
            initialization,
        }
    },
}
