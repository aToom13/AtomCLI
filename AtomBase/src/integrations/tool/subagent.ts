import { Session } from "@/core/session"
import type { SessionPrompt } from "@/core/session/prompt"
import { Identifier } from "@/core/id/id"
import { PermissionNext } from "@/util/permission/next"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { SessionReuse } from "./session-reuse"
import type { Agent } from "../agent/agent"
import { Instance } from "@/services/project/instance"
import { SubAgentRuntime } from "./subagent-runtime"
import { HarnessState } from "@/core/session/harness-state"
import { MessageV2 } from "@/core/session/message-v2"
import { SubAgentLifecycle } from "./subagent-lifecycle"
import { SessionExecutionProfile } from "@/core/session/execution-profile"
import { ReviewPolicy } from "@/core/verification/review-policy"
import { Log } from "@/util/util/log"

/**
 * Shared sub-agent session spawn utility.
 *
 * Handles the common pattern of:
 * 1. Creating or reusing a child session with inherited permissions
 * 2. Emitting TUI events (SubAgentActive/Reactivate/Done)
 * 3. Executing a prompt via SessionPrompt.prompt()
 * 4. Extracting result text from response parts
 *
 * Callers retain responsibility for:
 * - Background detach (setTimeout)
 * - Result notification/batching
 * - Retry logic
 * - Model selection
 * - Chain progress events
 * - AGENT_SESSION_MAP management
 */
export namespace SubAgent {
  const log = Log.create({ service: "subagent" })
  export class ExecutionTimeoutError extends Error {
    constructor() {
      super("Sub-agent execution timed out")
      this.name = "ExecutionTimeoutError"
    }
  }

  export type LifecycleStatus = SubAgentLifecycle.Status

  export function status(sessionID: string): LifecycleStatus {
    return SubAgentLifecycle.status(sessionID)
  }

  export async function wait(
    sessionID: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<LifecycleStatus> {
    return SubAgentLifecycle.wait(sessionID, options)
  }

  /**
   * Base permission rules that ALL sub-agents must have.
   * These prevent recursive agent spawning and todo manipulation.
   */
  const BASE_DENIED_PERMISSIONS: PermissionNext.Rule[] = [
    { permission: "todowrite", pattern: "*", action: "deny" as const },
    { permission: "todoread", pattern: "*", action: "deny" as const },
    { permission: "task", pattern: "*", action: "deny" as const },
  ]

  /**
   * Build the full permission set for a sub-agent session.
   *
   * Merges parent permissions with the base deny rules (todowrite/todoread/task)
   * and any additional rules provided by the caller.
   */
  export function buildPermissions(
    parentPermissions: PermissionNext.Rule[],
    extraRules?: PermissionNext.Rule[],
  ): PermissionNext.Rule[] {
    return PermissionNext.merge(parentPermissions, extraRules ?? [], BASE_DENIED_PERMISSIONS)
  }

  /**
   * Build permissions from an agent's OWN definition instead of inheriting
   * from the parent session.
   *
   * Uses the agent's permission rules as the base (instead of parent permissions)
   * and merges with the base deny rules (todowrite/todoread/task).
   *
   * This is used for special agents like "reviewer" that should have
   * restricted permissions ("*": "deny", read: { "*": "allow" }) regardless
   * of what permissions the parent session has.
   *
   * Concrete denies remain hard. Deny-by-default permission allowlists retain
   * their ordered exceptions when replayed after global grants.
   */
  export function buildFromAgent(agent: Agent.Info): PermissionNext.Rule[] {
    const rules = agent.permission ?? []
    const allowlists = new Set(
      rules
        .filter(
          (r) =>
            r.permission !== "*" &&
            r.pattern === "*" &&
            r.action === "deny" &&
            rules.some(
              (other) => other.permission === r.permission && other.pattern !== "*" && other.action !== "deny",
            ),
        )
        .map((r) => r.permission),
    )
    const hardDenies = rules.filter(
      (r) => r.action === "deny" && !(r.permission === "*" && r.pattern === "*") && !allowlists.has(r.permission),
    )
    return PermissionNext.merge(
      rules,
      hardDenies,
      rules.filter((r) => allowlists.has(r.permission)),
      BASE_DENIED_PERMISSIONS,
    )
  }

  export type SpawnConfig = {
    /** Parent session ID for hierarchy */
    parentSessionID: string
    /** Resolved agent info */
    agent: Agent.Info
    /** Model to use for the prompt */
    model: { providerID: string; modelID: string }
    /** Full prompt parts (text, file, etc.) */
    parts: SessionPrompt.PromptInput["parts"]
    /** Pre-computed permissions for the child session */
    permissions: PermissionNext.Rule[]
    /** Short description for UI display */
    description: string
    /** Existing session ID — reuse if found */
    sessionId?: string
    /** Child session title (defaults to description + agent name) */
    title?: string
    /** Stable task identifier used to nest this agent under Mission Control. */
    parentStepId?: string
    /** Extra tools to deny beyond the base set */
    deniedTools?: Record<string, boolean>
    /** Called as soon as the child identity is known, before its prompt starts */
    onSession?: (session: { sessionId: string; isNewSession: boolean }) => void | Promise<void>
    onInvocation?: (invocationID: string) => void | Promise<void>
    /** Runtime backend. Defaults to the behavior-compatible atom-inprocess provider. */
    runtime?: string
    /** Capabilities that must be supported before execution starts. */
    require?: Array<keyof Capabilities>
    /** Optional isolated directory used only while the child prompt executes. */
    workingDirectory?: string
    /** File ownership for native children sharing the parent workspace. */
    ownership?: import("./orchestrate/ownership").WorkflowOwnership.Scope
    /** Optional JSON schema for a machine-readable final result. */
    outputSchema?: SubAgentRuntime.OutputSchema
    /** Strict rejects unknown object keys; permissive accepts them unless the schema forbids them. */
    validationMode?: SubAgentRuntime.ValidationMode
    /** Cancels the child prompt when its parent operation is cancelled. */
    signal?: AbortSignal
    executionTimeoutMs?: number
    allowCancelledContinuation?: boolean
  }

  export type SpawnResult = {
    /** The child session ID */
    sessionId: string
    /** Whether a new session was created (vs reused) */
    isNewSession: boolean
    /** Extracted text from the last text part of the response */
    output: string
    /** Raw response parts from SessionPrompt.prompt() */
    parts: MessageV2.Part[]
    /** Validated value when outputSchema was requested. */
    structuredOutput?: unknown
  }

  export type Capabilities = SubAgentRuntime.Capabilities

  export type RuntimeProvider = {
    id: string
    capabilities: Capabilities
    spawn(config: SpawnConfig): Promise<SpawnResult>
    cancel?(sessionID: string): Promise<void> | void
    dispose?(): Promise<void> | void
  }

  const runtimes = Instance.state(
    () =>
      new Map<string, RuntimeProvider>([
        [
          "atom-inprocess",
          {
            id: "atom-inprocess",
            capabilities: {
              outputSchema: true,
              persona: true,
              toolFilter: true,
              depthLimit: true,
              continuation: true,
              cancellation: true,
              isolation: true,
              wait: true,
              steer: false,
              revive: true,
              status: true,
              liveActivity: true,
            },
            spawn: spawnInProcess,
            cancel: async (sessionID) => (await import("@/core/session/prompt")).SessionPrompt.cancel(sessionID),
          },
        ],
      ]),
    async (providers) => {
      await Promise.allSettled([...providers.values()].map((provider) => provider.dispose?.()))
      providers.clear()
    },
  )

  export function register(provider: RuntimeProvider) {
    runtimes().set(provider.id, provider)
  }

  export function capabilities(runtime = "atom-inprocess") {
    const provider = runtimes().get(runtime)
    if (!provider) throw new Error(`Unknown sub-agent runtime: ${runtime}`)
    return provider.capabilities
  }

  const activeChildren = Instance.sessionState(
    () => new Map<string, { controller: AbortController; cancellation?: Promise<void> }>(),
  )

  export async function cancel(sessionID: string, runtime = "atom-inprocess") {
    const provider = runtimes().get(runtime)
    if (!provider) throw new Error(`Unknown sub-agent runtime: ${runtime}`)
    if (!provider.capabilities.cancellation || !provider.cancel) {
      throw new Error(`Sub-agent runtime ${runtime} does not support cancellation`)
    }
    const previous = status(sessionID)
    if (["completed", "failed", "cancelled", "timed_out"].includes(previous.status)) return
    const active = activeChildren().get(sessionID)
    active?.controller.abort(new Error("Sub-agent cancelled"))
    SubAgentLifecycle.update({ ...previous, status: "cancelled", updatedAt: Date.now() })
    await (active?.cancellation ?? provider.cancel(sessionID))
  }

  /**
   * Spawn a sub-agent: create/reuse session, emit TUI events, execute prompt.
   *
   * This is a BLOCKING call — returns when the sub-agent finishes.
   * Callers handle background detach if needed.
   */
  export async function spawn(config: SpawnConfig): Promise<SpawnResult> {
    const runtime = config.runtime ?? "atom-inprocess"
    const provider = runtimes().get(runtime)
    if (!provider) throw new Error(`Unknown sub-agent runtime: ${runtime}`)
    const required = new Set(config.require ?? [])
    if (config.agent.name === "reviewer" || config.signal || config.executionTimeoutMs) required.add("cancellation")
    if (config.outputSchema) required.add("outputSchema")
    if (config.workingDirectory) required.add("isolation")
    SubAgentRuntime.negotiate(runtime, provider.capabilities, [...required])
    if (required.has("cancellation") && !provider.cancel) {
      throw new Error(`Sub-agent runtime ${runtime} does not support cancellation`)
    }
    const parts = config.outputSchema
      ? [
          ...config.parts,
          {
            type: "text" as const,
            text: SubAgentRuntime.contract(config.outputSchema, config.validationMode ?? "strict"),
          },
        ]
      : config.parts
    if (config.sessionId && activeChildren().has(config.sessionId)) throw new Error("Child execution is still draining")
    if (config.sessionId && status(config.sessionId).status === "cancelled" && !config.allowCancelledContinuation)
      throw new Error("Cancelled child requires explicit continuation")
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    const controller = new AbortController()
    const signal = config.signal ? AbortSignal.any([config.signal, controller.signal]) : controller.signal
    signal.throwIfAborted()
    let sessionID: string | undefined
    const cancelChild = () => {
      if (!sessionID) return
      try {
        const execution = ExecutionRuntime.activeContext(sessionID)
        const parent = ExecutionRuntime.activeContext(config.parentSessionID)
        if (execution && execution.rootSessionID !== sessionID && parent?.executionID === execution.executionID) {
          ExecutionRuntime.cancelInvocation(execution)
          ExecutionRuntime.finishInvocation(
            execution,
            signal.reason instanceof ExecutionTimeoutError ? "failed" : "cancelled",
            signal.reason instanceof ExecutionTimeoutError ? "deadline" : undefined,
          )
        }
      } catch (error) {
        log.warn("child invocation cancellation failed", { error, sessionID })
      }
      const previous = status(sessionID)
      const timedOut = signal.reason instanceof ExecutionTimeoutError && config.agent.name !== "reviewer"
      SubAgentLifecycle.update({
        ...previous,
        status: timedOut ? "timed_out" : "cancelled",
        updatedAt: Date.now(),
        error: String(signal.reason),
      })
      const cancellation = Promise.resolve().then(() => provider.cancel?.(sessionID!))
      const active = activeChildren().get(sessionID)
      if (active) active.cancellation = cancellation
      void cancellation.catch((error) => log.warn("child cancellation failed", { error, sessionID }))
      void Bus.publish(TuiEvent.SubAgentFailed, {
        sessionId: sessionID,
        error: String(signal.reason).slice(0, 2000),
      }).catch(() => {})
    }
    const timeoutMs =
      config.agent.name === "reviewer"
        ? Math.min(config.executionTimeoutMs ?? Infinity, ReviewPolicy.REVIEW_TIMEOUT_MS)
        : config.executionTimeoutMs
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () =>
              controller.abort(
                config.agent.name === "reviewer"
                  ? new Error("Independent reviewer timed out")
                  : new ExecutionTimeoutError(),
              ),
            timeoutMs,
          )
    let aborted: () => void
    const cancelled = new Promise<never>((_, reject) => {
      aborted = () => {
        cancelChild()
        reject(signal.reason ?? new Error("Sub-agent cancelled"))
      }
      signal.addEventListener("abort", aborted, { once: true })
    })
    const children = activeChildren()
    let pending: Promise<SpawnResult> | undefined
    try {
      pending = provider.spawn({
        ...config,
        parts,
        signal,
        onSession: async (session) => {
          sessionID = session.sessionId
          const startedAt = Math.max(Date.now(), status(sessionID).updatedAt + 1)
          activeChildren().set(sessionID, { controller })
          SubAgentLifecycle.update({
            sessionId: sessionID,
            runtime,
            status: "running",
            startedAt,
            updatedAt: startedAt,
          })
          if (signal.aborted) {
            cancelChild()
            signal.throwIfAborted()
          }
          await config.onSession?.(session)
        },
      })
      const cleanup = () => {
        if (sessionID && children.get(sessionID)?.controller === controller) children.delete(sessionID)
      }
      void pending.then(cleanup, cleanup)
      const result = await Promise.race([pending, cancelled])
      signal.throwIfAborted()
      if (["cancelled", "timed_out"].includes(status(result.sessionId).status))
        throw new Error("Child result arrived after cancellation")
      const previous = status(result.sessionId)
      SubAgentLifecycle.update({ ...previous, status: "completed", updatedAt: Date.now() })
      return result
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError" && !signal.aborted) controller.abort(error)
      if (sessionID && !signal.aborted) {
        const previous = status(sessionID)
        SubAgentLifecycle.update({ ...previous, status: "failed", updatedAt: Date.now(), error: String(error) })
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener("abort", aborted!)
      if (!pending && sessionID) children.delete(sessionID)
    }
  }

  async function spawnInProcess(config: SpawnConfig): Promise<SpawnResult> {
    let isNewSession = false
    const parentStepId = config.parentStepId ?? HarnessState.getRunningStep(config.parentSessionID)

    // Try to reuse existing session
    let session: Session.Info | null = null
    if (config.sessionId) {
      session = await Session.get(config.sessionId).catch(() => null)
      // Security: only reuse sessions created by this same parent. A caller-controlled
      // sessionId must not continue an unrelated session (cross-session context leak).
      if (session && !SessionReuse.isAllowed(session, config.parentSessionID)) {
        session = null
      }
      if (session) {
        try {
          await Bus.publish(TuiEvent.SubAgentReactivate, {
            sessionId: session.id,
            description: config.description,
            parentSessionId: config.parentSessionID,
            parentStepId,
            startedAt: Date.now(),
          })
        } catch {
          /* TUI may not be available */
        }
      }
    }

    // Create new session if needed
    if (!session) {
      session = await Session.create({
        parentID: config.parentSessionID,
        title: config.title ?? `${config.description} (@${config.agent.name} subagent)`,
        permission: config.permissions,
      })
      isNewSession = true

      try {
        const startedAt = Date.now()
        await Bus.publish(TuiEvent.SubAgentActive, {
          sessionId: session.id,
          agentType: config.agent.name,
          description: config.description,
          parentSessionId: config.parentSessionID,
          parentStepId,
          runtime: config.runtime ?? "atom-inprocess",
          startedAt,
        })
      } catch {
        /* TUI may not be available */
      }
    }

    if (config.ownership) {
      const { WorkflowOwnership } = await import("./orchestrate/ownership")
      const prior = await WorkflowOwnership.scope(session.id)
      if (
        prior &&
        (prior.root !== config.ownership.root ||
          config.ownership.owns.some((file) => {
            try {
              WorkflowOwnership.assertPath(prior, file)
              return false
            } catch {
              return true
            }
          }))
      )
        throw new Error("Cannot widen a reused child's task ownership")
      await Session.update(session.id, (draft) => {
        draft.metadata = { ...draft.metadata, workflowOwnership: config.ownership }
      })
    }

    // Expose the child identity before starting the blocking prompt. Callers use
    // this to distinguish a user-deleted child from an ordinary model failure
    // and must not wait until spawn() returns to learn the session ID.
    await config.onSession?.({ sessionId: session.id, isNewSession })
    SessionExecutionProfile.inherit(config.parentSessionID, session.id)
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    await ExecutionRuntime.inheritSession(config.parentSessionID, session.id)

    const startedAt = SubAgentLifecycle.status(session.id).startedAt
    SubAgentLifecycle.update({
      sessionId: session.id,
      runtime: config.runtime ?? "atom-inprocess",
      status: "running",
      startedAt,
      updatedAt: startedAt,
    })

    const notifyDone = async (lastOutput: string) => {
      if (["cancelled", "timed_out"].includes(SubAgentLifecycle.status(session.id).status)) return
      SubAgentLifecycle.update({
        sessionId: session.id,
        runtime: config.runtime ?? "atom-inprocess",
        status: "completed",
        startedAt,
        updatedAt: Date.now(),
      })
      try {
        await Bus.publish(TuiEvent.SubAgentDone, {
          sessionId: session.id,
          lastOutput: lastOutput.slice(0, 2000),
          completedAt: Date.now(),
        })
      } catch {
        /* TUI may not be available */
      }
    }

    const notifyFailed = async (error: string) => {
      if (["cancelled", "timed_out"].includes(SubAgentLifecycle.status(session.id).status)) return
      SubAgentLifecycle.update({
        sessionId: session.id,
        runtime: config.runtime ?? "atom-inprocess",
        status:
          config.signal?.aborted || ExecutionRuntime.invocation(messageID)?.state === "cancelled"
            ? "cancelled"
            : "failed",
        startedAt,
        updatedAt: Date.now(),
        error,
      })
      try {
        await Bus.publish(TuiEvent.SubAgentFailed, {
          sessionId: session.id,
          error: error.slice(0, 2000),
        })
      } catch {
        /* TUI may not be available */
      }
    }

    // Execute the prompt. A rejected prompt must also close the active state;
    // otherwise the sub-agent card remains stuck on "running" forever.
    const messageID = Identifier.ascending("message")
    let result: Awaited<ReturnType<typeof SessionPrompt.prompt>>
    try {
      await config.onInvocation?.(messageID)
      const { SessionPrompt } = await import("@/core/session/prompt")
      const executePrompt = async () => {
        config.signal?.throwIfAborted()
        const abortChild = () => SessionPrompt.cancel(session.id)
        config.signal?.addEventListener("abort", abortChild, { once: true })
        const unsubscribe = Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
          const part = event.properties.part
          if (part.sessionID !== session.id) return
          if (part.type === "tool") {
            const liveOutput =
              "metadata" in part.state && typeof part.state.metadata?.output === "string"
                ? part.state.metadata.output
                : undefined
            const command = typeof part.state.input.command === "string" ? part.state.input.command : undefined
            await Bus.publish(TuiEvent.SubAgentActivity, {
              sessionId: session.id,
              kind: part.tool === "bash" ? "command" : "tool",
              label: part.state.status === "completed" ? part.state.title : command || part.tool,
              status: part.state.status,
              output: part.state.status === "completed" ? part.state.output.slice(-1_000) : liveOutput?.slice(-1_000),
              time: Date.now(),
            }).catch(() => {})
            return
          }
          if (part.type === "text" && part.text.trim()) {
            await Bus.publish(TuiEvent.SubAgentActivity, {
              sessionId: session.id,
              kind: "transcript",
              label: part.text.trim().slice(-1_000),
              time: Date.now(),
            }).catch(() => {})
          }
        })
        try {
          return await SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: config.model.modelID,
              providerID: config.model.providerID,
            },
            agent: config.agent.name,
            tools: {
              todowrite: false,
              todoread: false,
              task: false,
              ...(config.deniedTools ?? {}),
            },
            parts: config.parts,
          })
        } finally {
          unsubscribe()
          config.signal?.removeEventListener("abort", abortChild)
        }
      }
      result = config.workingDirectory
        ? await Instance.provide({
            directory: config.workingDirectory,
            sessionDirectory: Instance.sessionDirectory,
            fn: executePrompt,
          })
        : await executePrompt()
      config.signal?.throwIfAborted()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      await notifyFailed(`Error: ${detail}`)
      throw error
    }

    if (result.info.role === "assistant" && result.info.error) {
      const detail =
        "data" in result.info.error && result.info.error.data && typeof result.info.error.data.message === "string"
          ? result.info.error.data.message
          : "message" in result.info.error && typeof result.info.error.message === "string"
            ? result.info.error.message
            : "Sub-agent prompt failed"
      await notifyFailed(`Error: ${result.info.error.name}: ${detail}`)
      throw new Error(`${result.info.error.name}: ${detail}`)
    }

    // Preserve multi-part final answers instead of silently returning only the
    // last text fragment.
    const output = result.parts
      .filter((part) => part.type === "text" && "text" in part)
      .map((part) => String(part.text))
      .filter((text) => text.trim().length > 0)
      .join("\n\n")

    let structuredOutput: unknown
    if (config.outputSchema) {
      const validation = SubAgentRuntime.validateOutput(output, config.outputSchema, config.validationMode ?? "strict")
      if ("error" in validation) {
        await notifyFailed(JSON.stringify(validation.error))
        throw new SubAgentRuntime.OutputValidationError(validation.error)
      }
      structuredOutput = validation.data
    }

    await notifyDone(output)

    return {
      sessionId: session.id,
      isNewSession,
      output,
      parts: result.parts,
      structuredOutput,
    }
  }
}
