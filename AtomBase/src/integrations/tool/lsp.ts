import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "@/services/project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const
const DEFAULT_MAX_RESULTS = 25
const MAX_RESULTS = 200

const positionOperations = new Set<(typeof operations)[number]>([
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
])

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum(operations).describe("The LSP operation to perform"),
    filePath: z.string().min(1).max(4096).describe("The absolute or relative path to the file"),
    line: z.number().int().min(1).optional().describe("The 1-based line number; required for position operations"),
    character: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The 1-based character offset; required for position operations"),
    query: z.string().min(1).max(200).optional().describe("Search query; required for workspaceSymbol"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS)
      .default(DEFAULT_MAX_RESULTS)
      .describe(`Maximum results to return (default: ${DEFAULT_MAX_RESULTS}, maximum: ${MAX_RESULTS})`),
  }),
  execute: async (args, ctx) => {
    if (args.operation === "workspaceSymbol" && !args.query?.trim()) {
      throw new Error("query is required for workspaceSymbol")
    }
    if (positionOperations.has(args.operation) && (args.line === undefined || args.character === undefined)) {
      throw new Error(`line and character are required for ${args.operation}`)
    }

    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = pathToFileURL(file).href
    const position = {
      file,
      line: (args.line ?? 1) - 1,
      character: (args.character ?? 1) - 1,
    }

    const relPath = path.relative(Instance.worktree, file)
    const location = args.line === undefined ? relPath : `${relPath}:${args.line}:${args.character}`
    const title = `${args.operation} ${location}`

    const exists = await Bun.file(file).exists()
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    const available = await LSP.hasClients(file)
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    // didOpen/didChange is ordered before the following request on the same
    // LSP connection. Waiting for publishDiagnostics adds up to three seconds
    // and is unnecessary for read-only code-intelligence operations.
    await LSP.touchFile(file)

    const result: unknown[] = await (async () => {
      switch (args.operation) {
        case "goToDefinition":
          return LSP.definition(position)
        case "findReferences":
          return LSP.references(position)
        case "hover":
          return LSP.hover(position)
        case "documentSymbol":
          return LSP.documentSymbol(uri)
        case "workspaceSymbol":
          return LSP.workspaceSymbol(args.query!.trim())
        case "goToImplementation":
          return LSP.implementation(position)
        case "prepareCallHierarchy":
          return LSP.prepareCallHierarchy(position)
        case "incomingCalls":
          return LSP.incomingCalls(position)
        case "outgoingCalls":
          return LSP.outgoingCalls(position)
      }
    })()

    const limited = result.slice(0, args.maxResults)
    const omitted = Math.max(0, result.length - limited.length)
    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      const suffix = omitted > 0 ? `\n\n... ${omitted} more results omitted; increase maxResults to return more` : ""
      return JSON.stringify(limited, null, 2) + suffix
    })()

    return {
      title,
      metadata: {
        results: result.length,
        returned: limited.length,
        omitted,
        limited: omitted > 0,
        query: args.operation === "workspaceSymbol" ? args.query!.trim() : undefined,
      },
      output,
    }
  },
})
