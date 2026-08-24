import type { Part, Session, ToolPart } from "@atomcli/sdk/v2"
import type { ActiveSubAgent } from "./subagent"
import type { AgentChain, ChainStep, StepStatus, StepTodo } from "@/integrations/agent/chain"

type ToolInput = Record<string, any>

export namespace SessionRecovery {
  function toolInput(part: ToolPart): ToolInput {
    return (part.state && "input" in part.state ? part.state.input : {}) as ToolInput
  }

  function stepIndex(chain: AgentChain, value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return chain.currentStep
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < chain.steps.length) return parsed
    const byID = chain.steps.findIndex((step) => step.id === String(value))
    return byID >= 0 ? byID : chain.currentStep
  }

  function normalizeTodos(todos: unknown): StepTodo[] | undefined {
    if (!Array.isArray(todos)) return undefined
    return todos.map((todo, index) => {
      const item = typeof todo === "string" ? { content: todo } : todo
      const status = item?.status === "completed" ? "complete" : item?.status === "cancelled" ? "failed" : item?.status
      return {
        id: String(item?.id ?? `todo-${index}`),
        content: String(item?.content ?? ""),
        status: (["pending", "in_progress", "complete", "failed"].includes(status)
          ? status
          : "pending") as StepTodo["status"],
      }
    })
  }

  function taskflowStart(input: ToolInput): AgentChain | null {
    if (!Array.isArray(input.plan) || input.plan.length === 0) return null
    const steps: ChainStep[] = input.plan.map((step: any, index: number) => ({
      id: String(step.id ?? index),
      name: String(step.name ?? `Step ${index + 1}`),
      description: String(step.name ?? `Step ${index + 1}`),
      status: index === 0 ? "running" : "pending",
      retryCount: 0,
      todos: normalizeTodos(step.todos),
    }))
    return { steps, currentStep: 0, status: "executing", mode: "safe" }
  }

  function orchestrateStart(input: ToolInput): AgentChain | null {
    if (!Array.isArray(input.tasks) || input.tasks.length === 0) return null
    const steps: ChainStep[] = input.tasks.map((task: any, index: number) => ({
      id: String(task.id ?? index),
      name: String(task.id ?? `Task ${index + 1}`),
      description: String(task.prompt ?? ""),
      status: "pending",
      retryCount: 0,
      agentType: String(task.agent ?? "coder"),
      sessionId: typeof task.sessionId === "string" ? task.sessionId : undefined,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : undefined,
    }))
    return { steps, currentStep: 0, status: "planning", mode: "safe" }
  }

  function singleAgentStart(input: ToolInput, running: boolean): AgentChain | null {
    if (typeof input.description !== "string" || !input.description.trim()) return null
    const id =
      input.description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "task"
    return {
      steps: [
        {
          id,
          name: input.description,
          description: typeof input.prompt === "string" ? input.prompt : input.description,
          status: running ? "running" : "pending",
          retryCount: 0,
          agentType: typeof input.subagent_type === "string" ? input.subagent_type : "agent",
        },
      ],
      currentStep: 0,
      status: running ? "executing" : "planning",
      mode: "safe",
    }
  }

  function markExecuting(chain: AgentChain | null) {
    if (!chain) return null
    const steps = chain.steps.map((step) => ({ ...step }))
    const index = steps.findIndex((step) => step.status === "pending")
    if (index >= 0) steps[index].status = "running"
    return { ...chain, steps, currentStep: index >= 0 ? index : chain.currentStep, status: "executing" as const }
  }

  function markFailed(chain: AgentChain | null, error: string) {
    if (!chain) return null
    const steps = chain.steps.map((step) => ({ ...step }))
    const index = steps.findIndex((step) => step.status === "running" || step.status === "pending")
    if (index >= 0) {
      steps[index].status = "failed"
      steps[index].error = error
    }
    return { ...chain, steps, currentStep: index >= 0 ? index : chain.currentStep, status: "failed" as const }
  }

  function replayTaskflow(chain: AgentChain | null, input: ToolInput): AgentChain | null {
    if (input.action === "start") return taskflowStart(input)
    if (input.action === "clear") return null
    if (!chain) return null

    const index = stepIndex(chain, input.step_id)
    const steps = chain.steps.map((step) => ({ ...step, todos: step.todos?.map((todo) => ({ ...todo })) }))
    const step = steps[index]
    if (!step) return chain

    if (input.todo_id !== undefined || input.todo_status !== undefined) {
      const todoIndex = Number(input.todo_id ?? 0)
      if (step.todos?.[todoIndex]) {
        const status =
          input.todo_status === "completed"
            ? "complete"
            : input.todo_status === "cancelled"
              ? "failed"
              : input.todo_status
        step.todos[todoIndex].status = (
          ["pending", "in_progress", "complete", "failed"].includes(status) ? status : "complete"
        ) as StepTodo["status"]
      }
    }

    if (input.action === "update" && input.status) {
      step.status = (
        input.status === "completed"
          ? "complete"
          : input.status === "failed"
            ? "failed"
            : input.status === "pending"
              ? "pending"
              : "running"
      ) as StepStatus
    }
    if (input.action === "complete") {
      step.status = "complete"
      step.output = input.output
    }
    if (input.action === "fail") {
      step.status = "failed"
      step.error = input.output ?? "Taskflow step failed"
    }

    const nextPending = steps.findIndex((candidate) => candidate.status === "pending")
    const currentStep = nextPending >= 0 ? nextPending : index
    const failed = steps.some((candidate) => candidate.status === "failed")
    const complete = steps.every((candidate) => candidate.status === "complete")
    return { ...chain, steps, currentStep, status: failed ? "failed" : complete ? "complete" : "executing" }
  }

  function replayOrchestrate(chain: AgentChain | null, part: ToolPart, input: ToolInput): AgentChain | null {
    if (input.action === "plan") return orchestrateStart(input)
    if (!chain || input.action !== "execute" || part.state.status !== "completed") return chain
    const output = part.state.output ?? ""
    const statuses = new Map<string, StepStatus>()
    for (const match of output.matchAll(/^###\s+(✅|❌|⏭️|🔄|⏳)\s+([^\s(]+)/gm)) {
      statuses.set(
        match[2],
        ({ "✅": "complete", "❌": "failed", "⏭️": "failed", "🔄": "running", "⏳": "pending" } as const)[match[1]],
      )
    }
    const steps = chain.steps.map((step) => ({ ...step, status: statuses.get(step.id) ?? step.status }))
    const failed = steps.some((step) => step.status === "failed")
    const complete = steps.every((step) => step.status === "complete")
    return { ...chain, steps, status: failed ? "failed" : complete ? "complete" : "executing" }
  }

  function replayAgent(chain: AgentChain | null, part: ToolPart, input: ToolInput): AgentChain | null {
    if (input.action === "workflow") {
      if (input.workflow_action === "plan") return part.state.status === "completed" ? orchestrateStart(input) : chain
      if (input.workflow_action === "execute") {
        if (part.state.status === "running" || part.state.status === "pending") return markExecuting(chain)
        if (part.state.status === "error") return markFailed(chain, part.state.error)
        return replayOrchestrate(chain, part, { action: "execute" })
      }
      return chain
    }

    if (input.action !== "spawn") return chain
    const recovered = singleAgentStart(input, part.state.status === "running")
    if (!recovered) return chain
    if (part.state.status === "pending" || part.state.status === "running") return recovered
    if (part.state.status === "error") return markFailed(recovered, part.state.error)

    const fromOutput = replayOrchestrate(recovered, part, { action: "execute" })
    if (fromOutput?.steps.some((step) => step.status !== "pending" && step.status !== "running")) return fromOutput
    const output = part.state.output
    return {
      ...recovered,
      steps: recovered.steps.map((step) => ({ ...step, status: "complete" as const, output })),
      status: "complete",
    }
  }

  function completedSuccessfully(part: ToolPart) {
    if (part.state.status !== "completed") return false
    const metadata = part.state.metadata as Record<string, unknown>
    return metadata.error !== true && metadata.status !== "error" && metadata.status !== "blocked"
  }

  export function chain(parts: Part[]): AgentChain | null {
    let recovered: AgentChain | null = null
    let parentTaskflowActive = false
    for (const part of parts) {
      if (part.type !== "tool") continue
      const input = toolInput(part)
      const succeeded = completedSuccessfully(part)
      if (part.tool === "taskflow" && succeeded) {
        if (input.action === "start") parentTaskflowActive = true
        if (input.action === "clear") parentTaskflowActive = false
      }
      if (part.tool === "agent") {
        if (parentTaskflowActive) continue
        if (part.state.status === "completed" && !succeeded) {
          const start = input.action === "spawn" ? singleAgentStart(input, true) : recovered
          recovered = markFailed(start, part.state.output)
        } else {
          recovered = replayAgent(recovered, part, input)
        }
        continue
      }
      if (!succeeded) {
        if (part.tool === "orchestrate" && part.state.status === "running" && input.action === "execute") {
          recovered = markExecuting(recovered)
        }
        if (part.tool === "orchestrate" && part.state.status === "error") {
          recovered = markFailed(recovered, part.state.error)
        }
        if (part.tool === "orchestrate" && part.state.status === "completed" && input.action === "execute") {
          recovered = markFailed(recovered, part.state.output)
        }
        continue
      }
      if (part.tool === "taskflow") recovered = replayTaskflow(recovered, input)
      if (part.tool === "orchestrate" && !parentTaskflowActive) recovered = replayOrchestrate(recovered, part, input)
    }
    return recovered
  }

  function agentIdentity(session: Session) {
    const match = session.title.match(/\(@([^\s)]+)(?:\s+subagent)?\)/i)
    return {
      agentType: match?.[1] ?? "agent",
      description: session.title.replace(/\s*\(@[^)]+\)\s*$/i, "").trim() || session.title,
    }
  }

  export function agents(
    parentSessionID: string,
    sessions: Session[],
    status: (sessionID: string) => "idle" | "working" | "compacting",
  ): ActiveSubAgent[] {
    return sessions
      .filter((session) => session.parentID === parentSessionID)
      .map((session) => {
        const identity = agentIdentity(session)
        return {
          sessionId: session.id,
          parentSessionId: parentSessionID,
          agentType: identity.agentType,
          description: identity.description,
          status: status(session.id) === "working" ? "running" : "waiting",
          startedAt: session.time.created,
          updatedAt: session.time.updated,
          runtime: "atom-inprocess",
        }
      })
  }
}
