import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "@/services/project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"
import { LSPWorkspaceEdit } from "@/integrations/lsp/workspace-edit"
import { Filesystem } from "@/util/util/filesystem"
import type { CodeAction, WorkspaceEdit } from "vscode-languageserver-types"

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
  "diagnostics",
  "renameSymbol",
  "renameFile",
  "typeDefinition",
  "codeActions",
  "formatting",
  "workspaceDiagnostics",
] as const
const DEFAULT_MAX_RESULTS = 25
const MAX_RESULTS = 200

type LspMetadata = {
  serverID?: string
  changedFiles?: string[]
  textEdits?: number
  resourceOperations?: number
  results?: number
  returned?: number
  omitted?: number
  limited?: boolean
  query?: string
}

function resultMetadata(metadata: LspMetadata) {
  return metadata
}

const positionOperations = new Set<(typeof operations)[number]>([
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
  "renameSymbol",
  "typeDefinition",
  "codeActions",
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
    newName: z.string().min(1).max(500).optional().describe("New symbol name; required for renameSymbol"),
    newFilePath: z.string().min(1).max(4096).optional().describe("Destination path; required for renameFile"),
    endLine: z.number().int().min(1).optional().describe("Optional 1-based code action range end line"),
    endCharacter: z.number().int().min(1).optional().describe("Optional 1-based code action range end character"),
    codeActionKinds: z.array(z.string().min(1).max(100)).max(20).optional().describe("Optional code action kinds"),
    apply: z.boolean().default(false).describe("Apply the selected code action; listing is the default"),
    actionIndex: z.number().int().min(0).optional().describe("Zero-based code action index to apply"),
    tabSize: z.number().int().min(1).max(16).default(2).describe("Formatting tab size"),
    insertSpaces: z.boolean().default(true).describe("Use spaces for formatting indentation"),
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
    if (args.operation === "renameSymbol" && !args.newName?.trim()) {
      throw new Error("newName is required for renameSymbol")
    }
    if (args.operation === "renameFile" && !args.newFilePath?.trim()) {
      throw new Error("newFilePath is required for renameFile")
    }
    if (args.operation === "codeActions" && args.apply && args.actionIndex === undefined) {
      throw new Error("actionIndex is required when applying a code action")
    }
    if (
      (args.operation === "codeActions" && (args.endLine ?? args.line!) < args.line!) ||
      (args.operation === "codeActions" &&
        (args.endLine ?? args.line!) === args.line! &&
        (args.endCharacter ?? args.character!) < args.character!)
    ) {
      throw new Error("code action range end must not precede its start")
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
    await LSP.touchFile(file, args.operation === "diagnostics" || args.operation === "codeActions")

    const applyWorkspaceEdit = async (
      edit: WorkspaceEdit,
      serverID: string,
      additionalRenames?: LSPWorkspaceEdit.AdditionalRename[],
    ) => {
      const applied = await LSPWorkspaceEdit.apply({
        edit,
        sessionID: ctx.sessionID,
        additionalRenames,
        version: (filePath) => LSP.documentVersion(filePath, serverID),
        authorize: async (authorization) => {
          for (const target of authorization.paths) await assertExternalDirectory(ctx, target)
          await ctx.ask({
            permission: "edit",
            patterns: authorization.paths.map((target) => path.relative(Instance.worktree, target)),
            always: ["*"],
            metadata: {
              diff: authorization.summary,
              lspServer: serverID,
            },
          })
        },
      })
      await Promise.all(
        applied.changedFiles.map(async (target) => {
          if (await Bun.file(target).exists()) await LSP.touchFile(target)
        }),
      )
      return {
        title,
        metadata: resultMetadata({
          serverID,
          changedFiles: applied.changedFiles,
          textEdits: applied.textEdits,
          resourceOperations: applied.resourceOperations,
        }),
        output: `${applied.summary}\n\nApplied ${applied.textEdits} text edits and ${applied.resourceOperations} resource operations atomically.`,
      }
    }

    if (args.operation === "renameSymbol") {
      const response = await LSP.renameSymbol({ ...position, newName: args.newName!.trim() })
      if (!response.value) throw new Error("LSP server returned no workspace edit for renameSymbol")
      return applyWorkspaceEdit(response.value, response.serverID)
    }

    if (args.operation === "renameFile") {
      const destination = path.isAbsolute(args.newFilePath!)
        ? path.normalize(args.newFilePath!)
        : path.resolve(Instance.directory, args.newFilePath!)
      await assertExternalDirectory(ctx, destination)
      const response = await LSP.willRenameFiles({ file, destination })
      return applyWorkspaceEdit(response.value ?? {}, response.serverID, [{ oldPath: file, newPath: destination }])
    }

    if (args.operation === "formatting") {
      const response = await LSP.formatting({
        file,
        options: { tabSize: args.tabSize, insertSpaces: args.insertSpaces },
      })
      if (response.value.length === 0) throw new Error("LSP server returned no formatting edits")
      return applyWorkspaceEdit({ changes: { [uri]: response.value } }, response.serverID)
    }

    if (args.operation === "codeActions") {
      const normalized = Filesystem.normalizePath(file)
      const diagnostics = (await LSP.diagnostics())[normalized] ?? []
      const response = await LSP.codeActions({
        file,
        range: {
          start: { line: position.line, character: position.character },
          end: {
            line: (args.endLine ?? args.line!) - 1,
            character: (args.endCharacter ?? args.character!) - 1,
          },
        },
        diagnostics,
        only: args.codeActionKinds,
      })
      const actions = response.value
      if (args.apply) {
        const selected = actions[args.actionIndex!]
        if (!selected) throw new Error(`Code action index ${args.actionIndex} is out of range`)
        if (!("edit" in selected) && "command" in selected && typeof selected.command === "string") {
          throw new Error("Selected code action is command-only; AtomCLI does not execute arbitrary LSP commands")
        }
        let action = selected as CodeAction
        if (!action.edit) action = await LSP.resolveCodeAction({ file, serverID: response.serverID, action })
        if (!action.edit) throw new Error("Selected code action did not provide a workspace edit")
        return applyWorkspaceEdit(action.edit, response.serverID)
      }
      const listed = actions.slice(0, args.maxResults).map((action, index) => ({
        index,
        title: action.title,
        ...(typeof action.command === "object" ? { command: action.command.command } : {}),
        ...(typeof action.command !== "string" && "kind" in action ? { kind: action.kind } : {}),
        ...(typeof action.command !== "string" && "isPreferred" in action ? { isPreferred: action.isPreferred } : {}),
        hasEdit: "edit" in action && !!action.edit,
        hasCommand: "command" in action && !!action.command,
      }))
      return {
        title,
        metadata: resultMetadata({ serverID: response.serverID, results: actions.length, returned: listed.length }),
        output: actions.length > 0 ? JSON.stringify(listed, null, 2) : "No code actions available",
      }
    }

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
        case "diagnostics": {
          const diagnostics = await LSP.diagnostics()
          return diagnostics[Filesystem.normalizePath(file)] ?? []
        }
        case "typeDefinition":
          return LSP.typeDefinition(position)
        case "workspaceDiagnostics": {
          const response = await LSP.workspaceDiagnostics(file)
          return [response.value]
        }
        case "renameSymbol":
        case "renameFile":
        case "codeActions":
        case "formatting":
          return []
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
      metadata: resultMetadata({
        results: result.length,
        returned: limited.length,
        omitted,
        limited: omitted > 0,
        query: args.operation === "workspaceSymbol" ? args.query!.trim() : undefined,
      }),
      output,
    }
  },
})
