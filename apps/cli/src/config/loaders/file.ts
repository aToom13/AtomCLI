import path from "path"
import os from "os"
import { Log } from "../../util/log"
import { Schemas } from "../schemas"
import { InvalidError, JsonError } from "../errors"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"

const log = Log.create({ service: "config.loader" })

export async function loadFile(filepath: string): Promise<Schemas.Info> {
    log.info("loading", { path: filepath })
    let text = await Bun.file(filepath)
        .text()
        .catch((err) => {
            if (err.code === "ENOENT") return
            throw new JsonError({ path: filepath }, { cause: err })
        })
    if (!text) return {}
    return load(text, filepath)
}

export async function load(text: string, configFilepath: string) {
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
        return process.env[varName] || ""
    })

    const fileMatches = text.match(/\{file:[^}]+\}/g)
    if (fileMatches) {
        const configDir = path.dirname(configFilepath)
        const lines = text.split("\n")

        for (const match of fileMatches) {
            const lineIndex = lines.findIndex((line) => line.includes(match))
            if (lineIndex !== -1 && lines[lineIndex].trim().startsWith("//")) {
                continue // Skip if line is commented
            }
            let filePath = match.replace(/^\{file:/, "").replace(/\}$/, "")
            if (filePath.startsWith("~/")) {
                filePath = path.join(os.homedir(), filePath.slice(2))
            }
            const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
            const fileContent = (
                await Bun.file(resolvedPath)
                    .text()
                    .catch((error) => {
                        const errMsg = `bad file reference: "${match}"`
                        if (error.code === "ENOENT") {
                            throw new InvalidError(
                                {
                                    path: configFilepath,
                                    message: errMsg + ` ${resolvedPath} does not exist`,
                                },
                                { cause: error },
                            )
                        }
                        throw new InvalidError({ path: configFilepath, message: errMsg }, { cause: error })
                    })
            ).trim()
            // escape newlines/quotes, strip outer quotes
            text = text.replace(match, JSON.stringify(fileContent).slice(1, -1))
        }
    }

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
        const lines = text.split("\n")
        const errorDetails = errors
            .map((e) => {
                const beforeOffset = text.substring(0, e.offset).split("\n")
                const line = beforeOffset.length
                const column = beforeOffset[beforeOffset.length - 1].length + 1
                const problemLine = lines[line - 1]

                const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
                if (!problemLine) return error

                return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
            })
            .join("\n")

        throw new JsonError({
            path: configFilepath,
            message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
        })
    }

    const parsed = Schemas.Info.safeParse(data)
    if (parsed.success) {
        if (!parsed.data.$schema) {
            parsed.data.$schema = "https://atomcli.ai/config.json"
            await Bun.write(configFilepath, JSON.stringify(parsed.data, null, 2))
        }
        const data = parsed.data
        if (data.plugin) {
            for (let i = 0; i < data.plugin.length; i++) {
                const plugin = data.plugin[i]
                try {
                    data.plugin[i] = import.meta.resolve!(plugin, configFilepath)
                } catch (err) { }
            }
        }
        return data
    }

    throw new InvalidError({
        path: configFilepath,
        issues: parsed.error.issues,
    })
}
