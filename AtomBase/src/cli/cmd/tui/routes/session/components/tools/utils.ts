import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"

export function normalizePath(input?: string) {
    if (!input) return ""
    if (path.isAbsolute(input)) {
        return path.relative(process.cwd(), input) || "."
    }
    return input
}

export function input(input: Record<string, any>, omit?: string[]): string {
    const primitives = Object.entries(input).filter(([key, value]) => {
        if (omit?.includes(key)) return false
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    })
    if (primitives.length === 0) return ""
    return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

export function filetype(input?: string) {
    if (!input) return "none"
    const ext = path.extname(input)
    const language = LANGUAGE_EXTENSIONS[ext]
    if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
    return language
}
