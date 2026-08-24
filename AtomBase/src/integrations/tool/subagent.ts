import { Session } from "@/core/session"
import { SessionPrompt } from "@/core/session/prompt"
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
    const inherited = PermissionNext.merge(parentPermissions, BASE_DENIED_PERMISSIONS)
    if (extraRules && extraRules.length > 0) {
      return PermissionNext.merge(inherited, extraRules)
    }
    return inherited
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
   * Hard-deny enforcement: every "deny" rule the agent declares is re-appended
   * AFTER the merged ruleset. PermissionNext.evaluate() uses findLast, so the
   * last matching rule wins — this guarantees the agent's own deny rules can
   * never be overridden by user config or YOLO-style flat merges.
   */
  export function buildFromAgent(agent: Agent.Info): PermissionNext.Rule[] {
    // Re-append the agent's SPECIFIC deny rules after the merged ruleset so
    // they can never be overridden by user config or YOLO flat merges. The
    // universal catch-all deny ("*": "*") is the allowlist baseline, NOT a
    // hard deny — it must stay before the explicit allows (e.g. the
    // reviewer's read: {"*": "allow"}) or findLast would let it shadow them.
    const hardDenies = (agent.permission ?? []).filter(
      (r) => r.action === "deny" && !(r.permission === "*" && r.pattern === "*"),
    )
    return PermissionNext.merge(agent.permission ?? [], hardDenies, BASE_DENIED_PERMISSIONS)
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
    /** Extra tools to deny beyond the base set */
    deniedTools?: Record<string, boolean>
    /** Called as soon as the child identity is known, before its prompt starts */
    onSession?: (session: { sessionId: string; isNewSession: boolean }) => void | Promise<void>
    /** Runtime backend. Defaults to the behavior-compatible atom-inprocess provider. */
    runtime?: string
    /** Capabilities that must be supported before execution starts. */
    require?: Array<keyof Capabilities>
    /** Optional isolated directory used only while the child prompt executes. */
    workingDirectory?: string
    /** Optional JSON schema for a machine-readable final result. */
    outputSchema?: SubAgentRuntime.OutputSchema
    /** Strict rejects unknown object keys; permissive accepts them unless the schema forbids them. */
    validationMode?: SubAgentRuntime.ValidationMode
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
            cancel: (sessionID) => SessionPrompt.cancel(sessionID),
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

  export async function cancel(sessionID: string, runtime = "atom-inprocess") {
    const provider = runtimes().get(runtime)
    if (!provider) throw new Error(`Unknown sub-agent runtime: ${runtime}`)
    if (!provider.capabilities.cancellation || !provider.cancel) {
      throw new Error(`Sub-agent runtime ${runtime} does not support cancellation`)
    }
    await provider.cancel(sessionID)
    const previous = status(sessionID)
    SubAgentLifecycle.update({ ...previous, status: "cancelled", updatedAt: Date.now() })
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
    if (config.outputSchema) required.add("outputSchema")
    if (config.workingDirectory) required.add("isolation")
    SubAgentRuntime.negotiate(runtime, provider.capabilities, [...required])
    return provider.spawn(config)
  }

  async function spawnInProcess(config: SpawnConfig): Promise<SpawnResult> {
    let isNewSession = false
    const parentStepId = HarnessState.getRunningStep(config.parentSessionID)

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

    // Expose the child identity before starting the blocking prompt. Callers use
    // this to distinguish a user-deleted child from an ordinary model failure
    // and must not wait until spawn() returns to learn the session ID.
    await config.onSession?.({ sessionId: session.id, isNewSession })

    const startedAt = Date.now()
    SubAgentLifecycle.update({
      sessionId: session.id,
      runtime: config.runtime ?? "atom-inprocess",
      status: "running",
      startedAt,
      updatedAt: startedAt,
    })

    const notifyDone = async (lastOutput: string) => {
      SubAgentLifecycle.update({
        sessionId: session.id,
        runtime: config.runtime ?? "atom-inprocess",
        status: "waiting",
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
      SubAgentLifecycle.update({
        sessionId: session.id,
        runtime: config.runtime ?? "atom-inprocess",
        status: "failed",
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
      const executePrompt = async () => {
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
        }
      }
      result = config.workingDirectory
        ? await Instance.provide({ directory: config.workingDirectory, fn: executePrompt })
        : await executePrompt()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      await notifyFailed(`Error: ${detail}`)
      throw error
    }

    if (result.info.role === "assistant" && result.info.error) {
      const detail = "message" in result.info.error ? result.info.error.message : "Sub-agent prompt failed"
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
