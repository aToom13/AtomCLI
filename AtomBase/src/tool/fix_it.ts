import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { Learning } from "../learning"
import * as fs from "fs/promises"

const DESCRIPTION = `Runtime error diagnosis and auto-fix tool.

Parses error output from failed commands, identifies the root cause, searches past learnings for known fixes, and generates structured fix suggestions.

**WHEN TO USE:** After a bash command fails (exit code != 0) and returns error output.

**ACTIONS:**
- "diagnose": Parse raw error output → structured error info (type, file, line, message, stack)
- "find_similar": Search past learnings for similar errors and known solutions
- "suggest_fix": Read the relevant source file and produce a contextual fix suggestion

**WORKFLOW:**
1. Run a command → it fails with error output
2. fix_it(action="diagnose", errorOutput="...") → get structured error info
3. fix_it(action="find_similar", errorType="...", errorMessage="...") → get past solutions
4. fix_it(action="suggest_fix", filePath="...", line=N, errorMessage="...") → get fix with context
5. Apply the fix using edit/write tools
6. Optionally record the fix with learn(action="record_solution") for future reference`

// ─── Error Parsers ───────────────────────────────────────────

interface ParsedError {
    errorType: string
    errorMessage: string
    filePath?: string
    line?: number
    column?: number
    stackTrace?: string[]
    language: string
}

/** Parse TypeScript/JavaScript stack traces: "at funcName (file:line:col)" */
function parseTSJSError(output: string): ParsedError | null {
    // Match patterns like: TypeError: Cannot read property 'x' of undefined
    const typeMatch = output.match(/^(\w*Error):\s*(.+)$/m)
    if (!typeMatch) return null

    // Require at least one "at ..." stack frame to distinguish from Python/other errors
    const stackLines = output.match(/^\s+at\s+.+$/gm) || []
    if (stackLines.length === 0) return null
    const firstFrame = stackLines[0]

    let filePath: string | undefined
    let line: number | undefined
    let column: number | undefined

    if (firstFrame) {
        const frameMatch = firstFrame.match(/\(([^)]+):(\d+):(\d+)\)/) ||
            firstFrame.match(/at\s+([^:]+):(\d+):(\d+)/)
        if (frameMatch) {
            filePath = frameMatch[1]
            line = parseInt(frameMatch[2], 10)
            column = parseInt(frameMatch[3], 10)
        }
    }

    return {
        errorType: typeMatch[1],
        errorMessage: typeMatch[2],
        filePath,
        line,
        column,
        stackTrace: stackLines.map(s => s.trim()),
        language: "typescript",
    }
}

/** Parse Bun/Node module resolution errors */
function parseBunModuleError(output: string): ParsedError | null {
    // "error: Cannot find module './foo'"
    const moduleMatch = output.match(/error:\s*(?:Cannot find module|Module not found|Could not resolve)\s*['"]([^'"]+)['"]/i)
    if (!moduleMatch) return null

    // Try to find the importer: "from '/path/to/file.ts'"
    const fromMatch = output.match(/from\s+['"]([^'"]+)['"]/i) ||
        output.match(/in\s+['"]?([^\s'"]+\.\w+)['"]?/i)

    return {
        errorType: "ModuleNotFoundError",
        errorMessage: `Cannot find module '${moduleMatch[1]}'`,
        filePath: fromMatch?.[1],
        language: "typescript",
    }
}

/** Parse Bun build/compile errors: "/path/file.ts:10:5: error: Unexpected token" */
function parseBunCompileError(output: string): ParsedError | null {
    const match = output.match(/^([^\s:]+\.\w+):(\d+):(\d+):\s*error:\s*(.+)$/m)
    if (!match) return null

    return {
        errorType: "CompileError",
        errorMessage: match[4],
        filePath: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        language: "typescript",
    }
}

/** Parse Python tracebacks */
function parsePythonError(output: string): ParsedError | null {
    // Match: "Traceback (most recent call last):"
    if (!output.includes("Traceback (most recent call last)")) return null

    // Last line is the error: "ValueError: invalid literal..."
    const lines = output.trim().split("\n")
    const errorLine = lines[lines.length - 1]
    const errorMatch = errorLine.match(/^(\w+Error|Exception):\s*(.+)$/)
    if (!errorMatch) return null

    // Extract file from: '  File "/path/to/file.py", line 10, in func'
    const fileMatch = output.match(/File "([^"]+)",\s*line\s*(\d+)/m)

    // Collect stack frames
    const stackFrames = output.match(/^\s+File "[^"]+",\s*line\s*\d+.*/gm) || []

    return {
        errorType: errorMatch[1],
        errorMessage: errorMatch[2],
        filePath: fileMatch?.[1],
        line: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
        stackTrace: stackFrames.map(s => s.trim()),
        language: "python",
    }
}

/** Parse generic error output (fallback) */
function parseGenericError(output: string): ParsedError {
    // Try to extract any file:line pattern
    const fileLineMatch = output.match(/([^\s:]+\.\w{1,5}):(\d+)/)

    // Try to find an error-like message
    const errorMatch = output.match(/(?:error|fatal|failed|exception):\s*(.+)/im)

    return {
        errorType: "RuntimeError",
        errorMessage: errorMatch?.[1] || output.split("\n").filter(l => l.trim()).pop() || "Unknown error",
        filePath: fileLineMatch?.[1],
        line: fileLineMatch ? parseInt(fileLineMatch[2], 10) : undefined,
        language: "unknown",
    }
}

/** Try all parsers in priority order */
function parseErrorOutput(output: string): ParsedError {
    return parseTSJSError(output) ||
        parseBunModuleError(output) ||
        parseBunCompileError(output) ||
        parsePythonError(output) ||
        parseGenericError(output)
}

// ─── Tool Definition ─────────────────────────────────────────

export const FixItTool = Tool.define("fix_it", {
    description: DESCRIPTION,
    parameters: z.object({
        action: z.enum(["diagnose", "find_similar", "suggest_fix"]).describe("Action to perform"),
        errorOutput: z.string().optional().describe("Raw error output from the failed command (required for 'diagnose')"),
        errorType: z.string().optional().describe("Error type from diagnosis (for 'find_similar')"),
        errorMessage: z.string().optional().describe("Error message from diagnosis (for 'find_similar' and 'suggest_fix')"),
        filePath: z.string().optional().describe("File path where error occurred (for 'suggest_fix')"),
        line: z.number().optional().describe("Line number of the error (for 'suggest_fix')"),
        language: z.string().optional().describe("Programming language context"),
    }),
    async execute(params, ctx): Promise<any> {
        const log = Log.create({ service: "tool.fix_it", sessionID: ctx.sessionID })

        switch (params.action) {
            // ─── DIAGNOSE ──────────────────────────────────────
            case "diagnose": {
                if (!params.errorOutput) {
                    return {
                        title: "Error",
                        output: "errorOutput is required for diagnose action",
                        metadata: { error: true },
                    }
                }

                const parsed = parseErrorOutput(params.errorOutput)
                log.info("diagnosed error", {
                    errorType: parsed.errorType,
                    filePath: parsed.filePath,
                    line: parsed.line,
                })

                const output = [
                    `## Error Diagnosis`,
                    ``,
                    `| Field | Value |`,
                    `|:------|:------|`,
                    `| **Type** | \`${parsed.errorType}\` |`,
                    `| **Message** | ${parsed.errorMessage} |`,
                    parsed.filePath ? `| **File** | \`${parsed.filePath}\` |` : null,
                    parsed.line ? `| **Line** | ${parsed.line} |` : null,
                    parsed.column ? `| **Column** | ${parsed.column} |` : null,
                    `| **Language** | ${parsed.language} |`,
                ].filter(Boolean).join("\n")

                const stackOutput = parsed.stackTrace && parsed.stackTrace.length > 0
                    ? `\n\n### Stack Trace\n\`\`\`\n${parsed.stackTrace.slice(0, 10).join("\n")}\n\`\`\``
                    : ""

                return {
                    title: `Diagnosis: ${parsed.errorType}`,
                    output: output + stackOutput,
                    metadata: {
                        error: false as const,
                        errorType: parsed.errorType,
                        errorMessage: parsed.errorMessage,
                        filePath: parsed.filePath,
                        line: parsed.line,
                        column: parsed.column,
                        language: parsed.language,
                        hasStack: (parsed.stackTrace?.length ?? 0) > 0,
                    },
                }
            }

            // ─── FIND SIMILAR ──────────────────────────────────
            case "find_similar": {
                if (!params.errorType && !params.errorMessage) {
                    return {
                        title: "Error",
                        output: "errorType or errorMessage is required for find_similar action",
                        metadata: { error: true },
                    }
                }

                const query = [params.errorType, params.errorMessage].filter(Boolean).join(": ")
                log.info("searching for similar errors", { query })

                // 1. Check Learning memory
                const knowledge = await Learning.hasKnowledgeAbout(
                    [params.errorType, params.errorMessage, params.language].filter(Boolean) as string[]
                )

                // 2. Search memory with full context
                const result = await Learning.findOrResearch({
                    query,
                    context: params.language,
                    topic: params.errorType || "error",
                    researchIfNotFound: false, // Don't auto-research, just check local knowledge
                })

                const parts: string[] = [`## Similar Errors & Known Solutions\n`]

                if (knowledge.found && knowledge.matches.length > 0) {
                    parts.push("### Past Encounters:")
                    for (const match of knowledge.matches) {
                        parts.push(`- **${match.title}** (relevance: ${match.relevance})`)
                    }
                    parts.push("")
                }

                if (result.found) {
                    parts.push("### Known Solution:")
                    parts.push(result.content)
                    parts.push(`\n*Source: ${result.source} (confidence: ${(result.confidence * 100).toFixed(0)}%)*`)
                }

                if (!knowledge.found && !result.found) {
                    parts.push("No similar errors found in past learnings.")
                    parts.push("\n> **Tip:** After fixing this error, use `learn(action=\"record_error\")` to save the solution for future reference.")
                }

                return {
                    title: `Similar: ${params.errorType || "Error"}`,
                    output: parts.join("\n"),
                    metadata: {
                        error: false as const,
                        found: knowledge.found || result.found,
                        matchCount: knowledge.matches.length,
                        source: result.source,
                        confidence: result.confidence,
                    },
                }
            }

            // ─── SUGGEST FIX ───────────────────────────────────
            case "suggest_fix": {
                if (!params.filePath) {
                    return {
                        title: "Error",
                        output: "filePath is required for suggest_fix action",
                        metadata: { error: true },
                    }
                }

                log.info("generating fix suggestion", {
                    filePath: params.filePath,
                    line: params.line,
                    errorMessage: params.errorMessage,
                })

                // Read the source file around the error line
                let fileContent: string
                try {
                    fileContent = await fs.readFile(params.filePath, "utf-8")
                } catch (e) {
                    return {
                        title: "File Not Found",
                        output: `Could not read file: ${params.filePath}\n\n${(e as Error).message}`,
                        metadata: { error: true },
                    }
                }

                const lines = fileContent.split("\n")
                const errorLine = params.line || 1
                const contextRadius = 10
                const startLine = Math.max(0, errorLine - contextRadius - 1)
                const endLine = Math.min(lines.length, errorLine + contextRadius)
                const contextLines = lines.slice(startLine, endLine)

                // Build context output with line numbers
                const numberedLines = contextLines.map((line, i) => {
                    const lineNum = startLine + i + 1
                    const marker = lineNum === errorLine ? ">>>" : "   "
                    return `${marker} ${String(lineNum).padStart(4)} | ${line}`
                })

                // Get learned errors for this technology
                const language = params.language || detectLanguage(params.filePath)
                const learnedErrors = await Learning.ErrorAnalyzer.getLearnedErrors(language)
                const relevantErrors = learnedErrors
                    .filter(e => params.errorMessage?.includes(e.errorType) || params.errorType === e.errorType)
                    .slice(0, 3)

                const parts: string[] = [
                    `## Fix Suggestion for \`${params.filePath}\`\n`,
                    `**Error:** ${params.errorMessage || "Unknown"}\n`,
                    `### Code Context (around line ${errorLine})`,
                    "```" + language,
                    ...numberedLines,
                    "```",
                    "",
                ]

                if (relevantErrors.length > 0) {
                    parts.push("### Known Fix Patterns for This Error Type:")
                    for (const err of relevantErrors) {
                        parts.push(`\n**${err.errorType}** — ${err.rootCause}`)
                        parts.push(`- Prevention: ${err.prevention}`)
                        if (err.appliedCount > 1) {
                            parts.push(`- Applied ${err.appliedCount} times before`)
                        }
                    }
                    parts.push("")
                }

                parts.push("### Next Steps:")
                parts.push("1. Review the error context above")
                parts.push("2. Apply a fix using `edit` or `write`")
                parts.push("3. Re-run the command to verify")
                parts.push("4. Use `learn(action=\"record_solution\")` to save the fix")

                return {
                    title: `Fix: ${params.filePath}:${errorLine}`,
                    output: parts.join("\n"),
                    metadata: {
                        error: false as const,
                        filePath: params.filePath,
                        line: errorLine,
                        language,
                        contextLines: contextLines.length,
                        knownPatterns: relevantErrors.length,
                    },
                }
            }

            default:
                return {
                    title: "Unknown Action",
                    output: "Unknown action provided to fix_it tool.",
                    metadata: { error: true },
                }
        }
    },
})

/** Detect language from file extension */
function detectLanguage(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase()
    switch (ext) {
        case "ts": case "tsx": return "typescript"
        case "js": case "jsx": case "mjs": case "cjs": return "javascript"
        case "py": return "python"
        case "rs": return "rust"
        case "go": return "go"
        case "rb": return "ruby"
        case "java": return "java"
        case "c": case "h": return "c"
        case "cpp": case "cc": case "hpp": return "cpp"
        case "sh": case "bash": return "bash"
        default: return ext || "unknown"
    }
}

// Export parsers for testing
export const _parsers = {
    parseTSJSError,
    parseBunModuleError,
    parseBunCompileError,
    parsePythonError,
    parseGenericError,
    parseErrorOutput,
    detectLanguage,
}
