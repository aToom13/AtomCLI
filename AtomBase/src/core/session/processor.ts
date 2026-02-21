import { MessageV2 } from "./message-v2"
import { Log } from "@/util/util/log"
import { Identifier } from "@/core/id/id"
import { Session } from "."
import { Agent } from "@/integrations/agent/agent"
import { Snapshot } from "@/core/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/core/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/integrations/plugin"
import { Provider } from "@/integrations/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/core/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/util/permission/next"
import { Question } from "@/interfaces/question"
import { AmendmentQueue } from "./amendment"
import { ModelFallback } from "@/integrations/provider/fallback"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type ProcessResult = {
    status: "compact" | "stop" | "continue"
    fallbackModel?: Provider.Model
  }
  export type Result = ProcessResult

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
    initialFallbackModel?: Provider.Model
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let fallbackAttempted = !!input.initialFallbackModel
    let currentFallbackModel = input.initialFallbackModel
    let needsCompaction = false
    let userMessageText: string | undefined // Store user message for context

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput, options?: {
        enableAmendments?: boolean
      }) {
        log.info("process")
        needsCompaction = false

        // If we have a fallback model from previous iteration, use it
        if (currentFallbackModel) {
          streamInput = { ...streamInput, model: currentFallbackModel }
        }

        // Store user message text for semantic learning
        try {
          const userMsg = streamInput.user
          const userParts = await MessageV2.parts(userMsg.id)
          const textParts = userParts.filter(p => p.type === "text" && !("synthetic" in p && p.synthetic))
          userMessageText = textParts.map(p => (p as any).text).join(" ")
        } catch (error) {
          log.warn("Failed to get user message text", { error })
        }

        // Enable amendment processing by default
        const enableAmendments = options?.enableAmendments !== false
        if (enableAmendments) {
          AmendmentQueue.setProcessing(input.sessionID, true)
        }

        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}

            // Direct stream — errors happen during fullStream iteration, caught below
            const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()

              // Check for amendments during streaming
              if (enableAmendments) {
                const amendment = AmendmentQueue.dequeue(input.sessionID)
                if (amendment) {
                  if (amendment.type === "interrupt") {
                    log.info("interrupt received", { sessionID: input.sessionID })
                    throw new Error("Stream interrupted by user")
                  } else {
                    // Handle amendment - inject into context
                    log.info("amendment received", { sessionID: input.sessionID, amendmentID: amendment.id })
                    await Session.updatePart({
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.sessionID,
                      type: "text",
                      text: `\n[Amendment: ${amendment.content}]\n`,
                      time: { start: Date.now(), end: Date.now() },
                      metadata: { amendment: true },
                    })
                  }
                }
              }

              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text) await Session.updatePart({ part, delta: value.text })
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      // Don't block the session on permission/question rejection
                      // Just skip this tool call and continue with the next one
                      blocked = false
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  break

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: value.text,
                      })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePart(currentText)

                    // Learn from assistant response with user message context
                    try {
                      const { SessionMemoryIntegration } = await import("../memory/integration/session")
                      await SessionMemoryIntegration.learnFromResponse(
                        currentText.text,
                        userMessageText // Pass user message for context
                      )
                    } catch (error) {
                      log.error("Failed to learn from assistant response", { error })
                    }
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = await MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)

              // FALLBACK: On first retryable error, try switching to a fallback model
              // instead of waiting (delay can be 43277s)
              if (!fallbackAttempted) {
                try {
                  // Get fallback models from config or use defaults
                  const config = await Config.get()
                  const fallbackModels = [
                    config.fallback?.secondary,
                    config.fallback?.tertiary,
                    ...ModelFallback.DEFAULT_FALLBACK_MODELS,
                  ].filter(Boolean) as string[]

                  // Check if fallback is enabled
                  if (config.fallback?.enabled === false) {
                    log.info("fallback disabled by config")
                  } else {
                    // Try each fallback model in order
                    for (const fallbackModelID of fallbackModels) {
                      try {
                        const parsed = Provider.parseModel(fallbackModelID)
                        const fallbackModel = await Provider.getModel(parsed.providerID, parsed.modelID)

                        // Skip if same as current model
                        if (fallbackModel.providerID === streamInput.model.providerID &&
                          fallbackModel.id === streamInput.model.id) {
                          continue
                        }

                        log.warn("switching to fallback model", {
                          from: `${streamInput.model.providerID}/${streamInput.model.id}`,
                          to: `${fallbackModel.providerID}/${fallbackModel.id}`,
                          reason: retry,
                          originalDelay: delay,
                        })

                        streamInput = { ...streamInput, model: fallbackModel }
                        // Update assistant message model info for UI display
                        input.assistantMessage.modelID = fallbackModel.id
                        input.assistantMessage.providerID = fallbackModel.providerID
                        // Publish message update event so UI refreshes
                        Bus.publish(MessageV2.Event.Updated, {
                          info: input.assistantMessage,
                        })
                        attempt = 0
                        fallbackAttempted = true
                        currentFallbackModel = fallbackModel

                        SessionStatus.set(input.sessionID, {
                          type: "retry",
                          attempt: 0,
                          message: `Switching to ${fallbackModel.providerID}/${fallbackModel.id} (${retry})`,
                          next: Date.now() + 1000,
                        })
                        await SessionRetry.sleep(1000, input.abort).catch(() => { })
                        break
                      } catch (modelErr) {
                        log.warn("failed to load fallback model", {
                          model: fallbackModelID,
                          error: (modelErr as Error).message,
                        })
                      }
                    }
                  }
                } catch (fallbackErr) {
                  log.warn("failed to find fallback provider", {
                    error: (fallbackErr as Error).message,
                  })
                }

                if (fallbackAttempted) {
                  continue // Retry with new model
                }
              }

              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => { })
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)

          // Cleanup amendment processing state
          if (enableAmendments) {
            AmendmentQueue.setProcessing(input.sessionID, false)
          }

          if (needsCompaction) return { status: "compact" as const, fallbackModel: currentFallbackModel }
          if (blocked) return { status: "stop" as const, fallbackModel: currentFallbackModel }
          if (input.assistantMessage.error) return { status: "stop" as const, fallbackModel: currentFallbackModel }
          return { status: "continue" as const, fallbackModel: currentFallbackModel }
        }
      },
    }
    return result
  }
}
