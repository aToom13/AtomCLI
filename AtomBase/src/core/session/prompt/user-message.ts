import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Session } from "../index"
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
import { MCP } from "@/integrations/mcp"
import { LSP } from "@/integrations/lsp"
import { ReadTool } from "@/integrations/tool/read"
import { FindTool } from "@/integrations/tool/find"
import { FileTime } from "@/services/file/time"
import { Instance } from "@/services/project/instance"
import { Filesystem } from "@/util/util/filesystem"
import { fileURLToPath } from "bun"
import { ConfigMarkdown } from "../../config/markdown"
import { NamedError } from "@atomcli/util/error"
import { Tool } from "@/integrations/tool/tool"
import { SystemPrompt } from "@/core/session/system"
import { Skill } from "@/integrations/skill"
import { PermissionNext } from "@/util/permission/next"
import { DataUrl } from "../data-url"
import { Bus } from "../../bus"
import { Plugin } from "@/integrations/plugin"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "session.prompt.message" })

export async function createUserMessage(input: any, deps: { lastModel: (sessionID: string) => Promise<any> }) {
  const { lastModel } = deps
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
  const info: MessageV2.Info = {
    id: input.messageID ?? Identifier.ascending("message"),
    role: "user",
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    tools: input.tools,
    agent: agent.name,
    model: input.model ?? agent.model ?? (await lastModel(input.sessionID)),
    system: input.system,
    variant: input.variant,
    modelPinned: input.modelPinned,
    thinkingPinned: input.thinkingPinned,
    resumesExecutionID: input.resumesExecutionID,
  }

  const parts = await Promise.all(
    input.parts.map(async (part): Promise<MessageV2.Part[]> => {
      if (part.type === "text" && part.metadata) {
        const { skillReads: _skillReads, nativeAtomicWork: _nativeAtomicWork, ...metadata } = part.metadata
        part = { ...part, metadata }
      }
      if (part.type === "file") {
        // before checking the protocol we check if this is an mcp resource because it needs special handling
        if (part.source?.type === "resource") {
          const { clientName, uri } = part.source
          log.info("mcp resource", { clientName, uri, mime: part.mime })

          const pieces: MessageV2.Part[] = [
            {
              id: Identifier.ascending("part"),
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Reading MCP resource: ${part.filename} (${uri})`,
            },
          ]

          try {
            const resourceContent = await MCP.readResource(clientName, uri)
            if (!resourceContent) {
              throw new Error(`Resource not found: ${clientName}/${uri}`)
            }

            // Handle different content types
            const contents = Array.isArray(resourceContent.contents)
              ? resourceContent.contents
              : [resourceContent.contents]

            for (const content of contents) {
              if ("text" in content && content.text) {
                pieces.push({
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: content.text as string,
                })
              } else if ("blob" in content && content.blob) {
                // Handle binary content if needed
                const mimeType = "mimeType" in content ? content.mimeType : part.mime
                pieces.push({
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `[Binary content: ${mimeType}]`,
                })
              }
            }

            pieces.push({
              ...part,
              id: part.id ?? Identifier.ascending("part"),
              messageID: info.id,
              sessionID: input.sessionID,
            })
          } catch (error: unknown) {
            log.error("failed to read MCP resource", { error, clientName, uri })
            const message = error instanceof Error ? error.message : String(error)
            pieces.push({
              id: Identifier.ascending("part"),
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Failed to read MCP resource ${part.filename}: ${message}`,
            })
          }

          return pieces
        }
        const url = new URL(part.url)
        switch (url.protocol) {
          case "data:":
            if (part.mime === "text/plain") {
              return [
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                },
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: DataUrl.decodeText(part.url),
                },
                {
                  ...part,
                  id: part.id ?? Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                },
              ]
            }
            break
          case "file:":
            log.info("file", { mime: part.mime })
            // have to normalize, symbol search returns absolute paths
            // Decode the pathname since URL constructor doesn't automatically decode it
            const filepath = fileURLToPath(part.url)
            if (
              Instance.worktree &&
              !Filesystem.contains(Instance.worktree, filepath) &&
              !Filesystem.contains(Instance.directory, filepath)
            ) {
              throw new Error(`File path "${filepath}" is outside worktree boundary`)
            }
            const stat = await Bun.file(filepath).stat()

            if (stat.isDirectory()) {
              part.mime = "application/x-directory"
            }

            if (part.mime === "text/plain") {
              let offset: number | undefined = undefined
              let limit: number | undefined = undefined
              const range = {
                start: url.searchParams.get("start"),
                end: url.searchParams.get("end"),
              }
              if (range.start != null) {
                const filePathURI = part.url.split("?")[0]
                let start = parseInt(range.start)
                let end = range.end ? parseInt(range.end) : undefined
                // some LSP servers (eg, gopls) don't give full range in
                // workspace/symbol searches, so we'll try to find the
                // symbol in the document to get the full range
                if (start === end) {
                  const symbols = await LSP.documentSymbol(filePathURI)
                  for (const symbol of symbols) {
                    let range: LSP.Range | undefined
                    if ("range" in symbol) {
                      range = symbol.range
                    } else if ("location" in symbol) {
                      range = symbol.location.range
                    }
                    if (range?.start?.line && range?.start?.line === start) {
                      start = range.start.line
                      end = range?.end?.line ?? start
                      break
                    }
                  }
                }
                offset = Math.max(start - 1, 0)
                if (end) {
                  limit = end - offset
                }
              }
              const args = { filePath: filepath, offset, limit }

              const pieces: MessageV2.Part[] = [
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
              ]

              await ReadTool.init()
                .then(async (t) => {
                  const model = await Provider.getModel(info.model.providerID, info.model.modelID)
                  const readCtx: Tool.Context = {
                    sessionID: input.sessionID,
                    abort: new AbortController().signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, model },
                    metadata: async () => {},
                    ask: async () => {},
                  }
                  const result = await t.execute(args, readCtx)
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((attachment) => ({
                        ...attachment,
                        synthetic: true,
                        filename: attachment.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({
                      ...part,
                      id: part.id ?? Identifier.ascending("part"),
                      messageID: info.id,
                      sessionID: input.sessionID,
                    })
                  }
                })
                .catch((error) => {
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : error.toString()
                  Bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({
                      message,
                    }).toObject(),
                  })
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                })

              return pieces
            }

            if (part.mime === "application/x-directory") {
              const listCtx: Tool.Context = {
                sessionID: input.sessionID,
                abort: new AbortController().signal,
                agent: input.agent!,
                messageID: info.id,
                extra: { bypassCwdCheck: true },
                metadata: async () => {},
                ask: async () => {},
              }
              const result = await FindTool.init().then((t) => t.execute({ mode: "tree", path: filepath }, listCtx))
              return [
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the find tool with the following input: ${JSON.stringify({ mode: "tree", path: filepath })}`,
                },
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: result.output,
                },
                {
                  ...part,
                  id: part.id ?? Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                },
              ]
            }

            const file = Bun.file(filepath)
            FileTime.read(input.sessionID, filepath)
            return [
              {
                id: Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                text: `Called the Read tool with the following input: {\"filePath\":\"${filepath}\"}`,
                synthetic: true,
              },
              {
                id: part.id ?? Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "file",
                url: `data:${part.mime};base64,` + Buffer.from(await file.bytes()).toString("base64"),
                mime: part.mime,
                filename: part.filename!,
                source: part.source,
              },
            ]
        }
      }

      // Explicit @skill mentions use the same bounded resolver as turn context.
      if (part.type === "text" && !part.synthetic && part.text && ConfigMarkdown.files(part.text).length) {
        const session = await Session.get(input.sessionID)
        const skillReads: Skill.LoadedChunk[] = []
        const text = await SystemPrompt.autoInjectSkills(
          part.text,
          PermissionNext.merge(agent.permission, session.permission ?? []),
          (record) => skillReads.push(record),
        )
        if (text)
          return [
            { id: Identifier.ascending("part"), ...part, messageID: info.id, sessionID: input.sessionID },
            {
              id: Identifier.ascending("part"),
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text,
              metadata: { skillManifest: Skill.loadingManifest(text), skillReads },
            },
          ]
      }

      if (part.type === "agent") {
        // Check if this agent would be denied by task permission
        const perm = PermissionNext.evaluate("task", part.name, agent.permission)
        const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
        return [
          {
            id: Identifier.ascending("part"),
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
          {
            id: Identifier.ascending("part"),
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            // An extra space is added here. Otherwise the 'Use' gets appended
            // to user's last word; making a combined word
            text:
              " Use the above message and context to generate a prompt and call the agent tool with action='spawn', subagent_type: " +
              part.name +
              hint,
          },
        ]
      }

      return [
        {
          id: Identifier.ascending("part"),
          ...part,
          messageID: info.id,
          sessionID: input.sessionID,
        },
      ]
    }),
  ).then((x) => x.flat())

  await Plugin.trigger(
    "chat.message",
    {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      messageID: input.messageID,
      variant: input.variant,
    },
    {
      message: info,
      parts,
    },
  )

  await Session.updateMessage(info)
  for (const part of parts) {
    await Session.updatePart(part)
  }

  return {
    info,
    parts,
  }
}
