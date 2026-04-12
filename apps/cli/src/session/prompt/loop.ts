import { Identifier } from "../../id/id"
import { Log } from "../../util/log"
import { Session } from ".."
import { MessageV2 } from "../message-v2"
import { start, cancel, state } from "./state"
import { defer } from "../../util/defer"
import { SessionStatus } from "../status"
import { SessionCompaction } from "../compaction"
import { ensureTitle } from "./title"
import { Provider } from "../../provider/provider"
import { Instance } from "../../project/instance"
import { TaskTool } from "../../tool/task"
import { ulid } from "ulid"
import { Plugin } from "../../plugin"
import { Agent } from "../../agent/agent"
import { PermissionNext } from "../../permission/next"
import { resolveTools } from "./tools"
import { SessionSummary } from "../summary"
import { clone } from "remeda"
import { SystemPrompt } from "../system"
import { SessionProcessor } from "../processor"
import { insertReminders } from "./messages"
import { fn } from "../../util/fn"
import { Tool } from "../../tool/tool"
import MAX_STEPS from "./max-steps.txt"

const log = Log.create({ service: "session", file: "prompt/loop" })

export const loop = fn(Identifier.schema("session"), async (sessionID) => {
    const abort = start(sessionID)
    if (!abort) {
        return new Promise<MessageV2.WithParts>((resolve, reject) => {
            const callbacks = state()[sessionID].callbacks
            callbacks?.push({ resolve, reject })
        })
    }

    using _ = defer(() => cancel(sessionID))

    let step = 0
    const session = await Session.get(sessionID)
    while (true) {
        SessionStatus.set(sessionID, { type: "busy" })
        log.info("loop", { step, sessionID })
        if (abort.aborted) break
        let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

        let lastUser: MessageV2.User | undefined
        let lastAssistant: MessageV2.Assistant | undefined
        let lastFinished: MessageV2.Assistant | undefined
        let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
        for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i]
            if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
            if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
            if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
                lastFinished = msg.info as MessageV2.Assistant
            if (lastUser && lastFinished) break
            const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
            if (task && !lastFinished) {
                tasks.push(...task)
            }
        }

        if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
        if (
            lastAssistant?.finish &&
            !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
            lastUser.id < lastAssistant.id
        ) {
            log.info("exiting loop", { sessionID })
            break
        }

        step++
        if (step === 1)
            ensureTitle({
                session,
                modelID: lastUser.model.modelID,
                providerID: lastUser.model.providerID,
                history: msgs,
            })

        const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)
        const task = tasks.pop()

        // pending subtask
        // TODO: centralize "invoke tool" logic
        if (task?.type === "subtask") {
            const taskTool = await TaskTool.init()
            const assistantMessage = (await Session.updateMessage({
                id: Identifier.ascending("message"),
                role: "assistant",
                parentID: lastUser.id,
                sessionID,
                mode: task.agent,
                agent: task.agent,
                path: {
                    cwd: Instance.directory,
                    root: Instance.worktree,
                },
                cost: 0,
                tokens: {
                    input: 0,
                    output: 0,
                    reasoning: 0,
                    cache: { read: 0, write: 0 },
                },
                modelID: model.id,
                providerID: model.providerID,
                time: {
                    created: Date.now(),
                },
            })) as MessageV2.Assistant
            let part = (await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: assistantMessage.id,
                sessionID: assistantMessage.sessionID,
                type: "tool",
                callID: ulid(),
                tool: TaskTool.id,
                state: {
                    status: "running",
                    input: {
                        prompt: task.prompt,
                        description: task.description,
                        subagent_type: task.agent,
                        command: task.command,
                    },
                    time: {
                        start: Date.now(),
                    },
                },
            })) as MessageV2.ToolPart
            const taskArgs = {
                prompt: task.prompt,
                description: task.description,
                subagent_type: task.agent,
                command: task.command,
            }
            await Plugin.trigger(
                "tool.execute.before",
                {
                    tool: "task",
                    sessionID,
                    callID: part.id,
                },
                { args: taskArgs },
            )
            let executionError: Error | undefined
            const taskAgent = await Agent.get(task.agent)
            const taskCtx: Tool.Context = {
                agent: task.agent,
                messageID: assistantMessage.id,
                sessionID: sessionID,
                abort,
                callID: part.callID,
                extra: { bypassAgentCheck: true },
                async metadata(input) {
                    await Session.updatePart({
                        ...part,
                        type: "tool",
                        state: {
                            ...part.state,
                            ...input,
                        },
                    } satisfies MessageV2.ToolPart)
                },
                async ask(req) {
                    await PermissionNext.ask({
                        ...req,
                        sessionID: sessionID,
                        ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
                    })
                },
            }
            const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
                executionError = error
                log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
                return undefined
            })
            await Plugin.trigger(
                "tool.execute.after",
                {
                    tool: "task",
                    sessionID,
                    callID: part.id,
                },
                result,
            )
            assistantMessage.finish = "tool-calls"
            assistantMessage.time.completed = Date.now()
            await Session.updateMessage(assistantMessage)
            if (result && part.state.status === "running") {
                await Session.updatePart({
                    ...part,
                    state: {
                        status: "completed",
                        input: part.state.input,
                        title: result.title,
                        metadata: result.metadata,
                        output: result.output,
                        attachments: result.attachments,
                        time: {
                            ...part.state.time,
                            end: Date.now(),
                        },
                    },
                } satisfies MessageV2.ToolPart)
            }
            if (!result) {
                await Session.updatePart({
                    ...part,
                    state: {
                        status: "error",
                        error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
                        time: {
                            start: part.state.status === "running" ? part.state.time.start : Date.now(),
                            end: Date.now(),
                        },
                        metadata: part.metadata,
                        input: part.state.input,
                    },
                } satisfies MessageV2.ToolPart)
            }

            // Add synthetic user message to prevent certain reasoning models from erroring
            // If we create assistant messages w/ out user ones following mid loop thinking signatures
            // will be missing and it can cause errors for models like gemini for example
            const summaryUserMsg: MessageV2.User = {
                id: Identifier.ascending("message"),
                sessionID,
                role: "user",
                time: {
                    created: Date.now(),
                },
                agent: lastUser.agent,
                model: lastUser.model,
            }
            await Session.updateMessage(summaryUserMsg)
            await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: summaryUserMsg.id,
                sessionID,
                type: "text",
                text: "Summarize the task tool output above and continue with your task.",
                synthetic: true,
            } satisfies MessageV2.TextPart)

            continue
        }

        // pending compaction
        if (task?.type === "compaction") {
            const result = await SessionCompaction.process({
                messages: msgs,
                parentID: lastUser.id,
                abort,
                sessionID,
                auto: task.auto,
            })
            if (result === "stop") break
            continue
        }

        // context overflow, needs compaction
        if (
            lastFinished &&
            lastFinished.summary !== true &&
            (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
        ) {
            await SessionCompaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
            })
            continue
        }

        // normal processing
        const agent = await Agent.get(lastUser.agent)
        const maxSteps = agent.steps ?? Infinity
        const isLastStep = step >= maxSteps
        msgs = insertReminders({
            messages: msgs,
            agent,
        })

        const processor = SessionProcessor.create({
            assistantMessage: (await Session.updateMessage({
                id: Identifier.ascending("message"),
                parentID: lastUser.id,
                role: "assistant",
                mode: agent.name,
                agent: agent.name,
                path: {
                    cwd: Instance.directory,
                    root: Instance.worktree,
                },
                cost: 0,
                tokens: {
                    input: 0,
                    output: 0,
                    reasoning: 0,
                    cache: { read: 0, write: 0 },
                },
                modelID: model.id,
                providerID: model.providerID,
                time: {
                    created: Date.now(),
                },
                sessionID,
            })) as MessageV2.Assistant,
            sessionID: sessionID,
            model,
            abort,
        })

        // Check if user explicitly invoked an agent via @ in this turn
        const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
        const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

        const tools = await resolveTools({
            agent,
            session,
            model,
            tools: lastUser.tools,
            processor,
            bypassAgentCheck,
        })

        if (step === 1) {
            SessionSummary.summarize({
                sessionID: sessionID,
                messageID: lastUser.id,
            })
        }

        const sessionMessages = clone(msgs)

        // Ephemerally wrap queued user messages with a reminder to stay on track
        if (step > 1 && lastFinished) {
            for (const msg of sessionMessages) {
                if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
                for (const part of msg.parts) {
                    if (part.type !== "text" || part.ignored || part.synthetic) continue
                    if (!part.text.trim()) continue
                    part.text = [
                        "<system-reminder>",
                        "The user sent the following message:",
                        part.text,
                        "",
                        "Please address this message and continue with your tasks.",
                        "</system-reminder>",
                    ].join("\n")
                }
            }
        }

        await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: sessionMessages })

        const [environment, custom] = await Promise.all([SystemPrompt.environment(), SystemPrompt.custom()])
        const result = await processor.process({
            user: lastUser,
            agent,
            abort,
            sessionID,
            system: [...environment, ...custom],
            messages: [
                ...MessageV2.toModelMessage(sessionMessages),
                ...(isLastStep
                    ? [
                        {
                            role: "assistant" as const,
                            content: MAX_STEPS,
                        },
                    ]
                    : []),
            ],
            tools,
            model,
        })
        if (result === "stop") break
        if (result === "compact") {
            await SessionCompaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
            })
        }
        continue
    }
    SessionCompaction.prune({ sessionID })
    for await (const item of MessageV2.stream(sessionID)) {
        if (item.info.role === "user") continue
        const queued = state()[sessionID]?.callbacks ?? []
        for (const q of queued) {
            q.resolve(item)
        }
        return item
    }
    throw new Error("Impossible")
})
