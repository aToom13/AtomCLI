import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Session } from ".."
import { Agent } from "@/integrations/agent/agent"
import { TaskTool } from "@/integrations/tool/task"
import { Tool } from "@/integrations/tool/tool"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { PermissionNext } from "@/util/permission/next"
import { Instance } from "@/services/project/instance"
import { ulid } from "ulid"
import type { Provider } from "@/integrations/provider/provider"
import type { ExecutionRuntime } from "@/core/execution/runtime"
import type { Log } from "@/util/util/log"

export async function runPendingTask(
  task: MessageV2.SubtaskPart | MessageV2.CompactionPart | undefined,
  ctx: {
    sessionID: string
    lastUser: MessageV2.User
    model: Provider.Model
    abort: AbortSignal
    executionContext: ExecutionRuntime.Context
    log: Pick<Log.Logger, "error">
  },
): Promise<boolean> {
  const { sessionID, lastUser, model, abort, executionContext, log } = ctx
  if (task?.type !== "subtask") return false

  const taskTool = await TaskTool.init()
  const assistantMessage = (await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
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
  let taskArgs = {
    action: "run" as const,
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }
  let executionError: Error | undefined
  const taskAgent = await Agent.get(task.agent)
  const taskCtx: Tool.Context = {
    agent: task.agent,
    messageID: assistantMessage.id,
    sessionID: sessionID,
    abort,
    callID: part.callID,
    extra: { bypassAgentCheck: true, execution: executionContext },
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
      const latestSession = await Session.get(sessionID)
      await PermissionNext.ask({
        ...req,
        sessionID: sessionID,
        ruleset: PermissionNext.merge(taskAgent.permission, latestSession.permission ?? []),
      })
    },
  }
  const result = await ToolRuntime.execute({
    tool: "task",
    args: taskArgs,
    context: taskCtx,
    mutating: taskTool.mutating,
    effects: taskTool.effects,
    execute: (args, context) => taskTool.execute(args, context),
  }).catch((error) => {
    executionError = error
    log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
    return undefined
  })
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

  return true
}
