import { BusEvent } from "@/core/bus/bus-event"
import { Bus } from "@/core/bus"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { Log } from "@/util/util/log"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "@atomcli/util/error"
import { withTimeout } from "@/util/util/timeout"
import { Instance } from "@/services/project/instance"
import { Filesystem } from "@/util/util/filesystem"

const DIAGNOSTICS_DEBOUNCE_MS = 150

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic

  export type Capabilities = {
    typeDefinitionProvider?: unknown
    renameProvider?: unknown
    codeActionProvider?: boolean | { resolveProvider?: boolean }
    documentFormattingProvider?: unknown
    diagnosticProvider?: { workspaceDiagnostics?: boolean }
    workspace?: {
      fileOperations?: {
        willRename?: unknown
      }
    }
    [key: string]: unknown
  }

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  export const Event = {
    Diagnostics: BusEvent.define(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
  }

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: string }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    input.server.process.stderr?.on("data", (chunk: Buffer | string) => {
      const message = String(chunk).trim()
      if (message) l.warn("server stderr", { message: message.slice(0, 10_000) })
    })

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout as any),
      new StreamMessageWriter(input.server.process.stdin as any),
    )

    const diagnostics = new Map<string, Diagnostic[]>()
    const dynamicCapabilities = new Map<string, string>()
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const filePath = Filesystem.normalizePath(fileURLToPath(params.uri))
      l.info("textDocument/publishDiagnostics", {
        path: filePath,
        count: params.diagnostics.length,
      })
      diagnostics.set(filePath, params.diagnostics)
      Bus.publish(Event.Diagnostics, { path: filePath, serverID: input.serverID })
    })
    connection.onRequest("window/workDoneProgress/create", (params) => {
      l.info("window/workDoneProgress/create", params)
      return null
    })
    connection.onRequest("workspace/configuration", async () => {
      // Return server initialization options
      return [input.server.initialization ?? {}]
    })
    connection.onRequest(
      "client/registerCapability",
      async (params: { registrations?: Array<{ id?: string; method?: string }> }) => {
        for (const registration of params.registrations ?? []) {
          if (registration.id && registration.method) dynamicCapabilities.set(registration.id, registration.method)
        }
      },
    )
    connection.onRequest(
      "client/unregisterCapability",
      async (params: {
        unregisterations?: Array<{ id?: string; method?: string }>
        unregistrations?: Array<{ id?: string; method?: string }>
      }) => {
        for (const registration of params.unregisterations ?? params.unregistrations ?? []) {
          if (registration.id) dynamicCapabilities.delete(registration.id)
        }
      },
    )
    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: pathToFileURL(input.root).href,
      },
    ])
    connection.listen()

    l.info("sending initialize")
    const initializeResult = (await withTimeout(
      connection.sendRequest("initialize", {
        rootUri: pathToFileURL(input.root).href,
        processId: input.server.process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: pathToFileURL(input.root).href,
          },
        ],
        initializationOptions: {
          ...input.server.initialization,
        },
        capabilities: {
          window: {
            workDoneProgress: true,
          },
          workspace: {
            configuration: true,
            workspaceEdit: {
              documentChanges: true,
              resourceOperations: ["create", "rename", "delete"],
              failureHandling: "transactional",
            },
            fileOperations: {
              willRename: true,
            },
            diagnostics: {
              refreshSupport: false,
            },
            didChangeWatchedFiles: {
              dynamicRegistration: true,
            },
          },
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
            },
            typeDefinition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            rename: {
              dynamicRegistration: false,
              prepareSupport: true,
            },
            codeAction: {
              dynamicRegistration: false,
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: [
                    "",
                    "quickfix",
                    "refactor",
                    "refactor.extract",
                    "refactor.inline",
                    "refactor.rewrite",
                    "source",
                  ],
                },
              },
              resolveSupport: {
                properties: ["edit"],
              },
            },
            formatting: {
              dynamicRegistration: false,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
        },
      }),
      45_000,
    ).catch((err) => {
      l.error("initialize error", { error: err })
      throw new InitializeError(
        { serverID: input.serverID },
        {
          cause: err,
        },
      )
    })) as { capabilities?: Capabilities }
    const capabilities = initializeResult?.capabilities ?? {}

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const files: {
      [path: string]: number
    } = {}

    const result = {
      root: input.root,
      get serverID() {
        return input.serverID
      },
      get connection() {
        return connection
      },
      get capabilities() {
        return capabilities
      },
      supports(method: string) {
        if ([...dynamicCapabilities.values()].includes(method)) return true
        switch (method) {
          case "textDocument/typeDefinition":
            return capabilityEnabled(capabilities.typeDefinitionProvider)
          case "textDocument/rename":
            return capabilityEnabled(capabilities.renameProvider)
          case "textDocument/codeAction":
            return capabilityEnabled(capabilities.codeActionProvider)
          case "textDocument/formatting":
            return capabilityEnabled(capabilities.documentFormattingProvider)
          case "workspace/willRenameFiles":
            return capabilityEnabled(capabilities.workspace?.fileOperations?.willRename)
          case "workspace/diagnostic":
            return capabilities.diagnosticProvider?.workspaceDiagnostics === true
          default:
            return false
        }
      },
      documentVersion(filePath: string) {
        const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(Instance.directory, filePath)
        return files[absolute]
      },
      notify: {
        async open(input: { path: string }) {
          input.path = path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path)
          const file = Bun.file(input.path)
          const text = await file.text()
          const extension = path.extname(input.path)
          const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"

          const version = files[input.path]
          if (version !== undefined) {
            log.info("workspace/didChangeWatchedFiles", input)
            await connection.sendNotification("workspace/didChangeWatchedFiles", {
              changes: [
                {
                  uri: pathToFileURL(input.path).href,
                  type: 2, // Changed
                },
              ],
            })

            const next = version + 1
            files[input.path] = next
            log.info("textDocument/didChange", {
              path: input.path,
              version: next,
            })
            await connection.sendNotification("textDocument/didChange", {
              textDocument: {
                uri: pathToFileURL(input.path).href,
                version: next,
              },
              contentChanges: [{ text }],
            })
            return
          }

          log.info("workspace/didChangeWatchedFiles", input)
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: pathToFileURL(input.path).href,
                type: 1, // Created
              },
            ],
          })

          log.info("textDocument/didOpen", input)
          diagnostics.delete(input.path)
          await connection.sendNotification("textDocument/didOpen", {
            textDocument: {
              uri: pathToFileURL(input.path).href,
              languageId,
              version: 0,
              text,
            },
          })
          files[input.path] = 0
          return
        },
      },
      get diagnostics() {
        return diagnostics
      },
      async waitForDiagnostics(input: { path: string }) {
        const normalizedPath = Filesystem.normalizePath(
          path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path),
        )
        log.info("waiting for diagnostics", { path: normalizedPath })
        let unsub: () => void
        let debounceTimer: ReturnType<typeof setTimeout> | undefined
        return await withTimeout(
          new Promise<void>((resolve) => {
            unsub = Bus.subscribe(Event.Diagnostics, (event) => {
              if (event.properties.path === normalizedPath && event.properties.serverID === result.serverID) {
                // Debounce to allow LSP to send follow-up diagnostics (e.g., semantic after syntax)
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                  log.info("got diagnostics", { path: normalizedPath })
                  unsub?.()
                  resolve()
                }, DIAGNOSTICS_DEBOUNCE_MS)
              }
            })
          }),
          3000,
        )
          .catch(() => {})
          .finally(() => {
            if (debounceTimer) clearTimeout(debounceTimer)
            unsub?.()
          })
      },
      async shutdown() {
        l.info("shutting down")
        connection.end()
        connection.dispose()
        input.server.process.kill()
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }

  function capabilityEnabled(capability: unknown) {
    return capability === true || (typeof capability === "object" && capability !== null)
  }
}
