import { Session } from "@/core/session"
import { SessionPrompt } from "@/core/session/prompt"
import { Identifier } from "@/core/id/id"
import { PermissionNext } from "@/util/permission/next"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import type { Agent } from "../agent/agent"

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

  export interface SpawnConfig {
    /** Parent session ID for hierarchy */
    parentSessionID: string
    /** Resolved agent info */
    agent: Agent.Info
    /** Model to use for the prompt */
    model: { providerID: string; modelID: string }
    /** Full prompt parts (text, file, etc.) */
    parts: any[]
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
  }

  export interface SpawnResult {
    /** The child session ID */
    sessionId: string
    /** Whether a new session was created (vs reused) */
    isNewSession: boolean
    /** Extracted text from the last text part of the response */
    output: string
    /** Raw response parts from SessionPrompt.prompt() */
    parts: any[]
  }

  /**
   * Spawn a sub-agent: create/reuse session, emit TUI events, execute prompt.
   *
   * This is a BLOCKING call — returns when the sub-agent finishes.
   * Callers handle background detach if needed.
   */
  export async function spawn(config: SpawnConfig): Promise<SpawnResult> {
    let isNewSession = false

    // Try to reuse existing session
    let session: any = null
    if (config.sessionId) {
      session = await Session.get(config.sessionId).catch(() => null)
      if (session) {
        try {
          await Bus.publish(TuiEvent.SubAgentReactivate, {
            sessionId: session.id,
            description: config.description,
          })
        } catch { /* TUI may not be available */ }
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
        await Bus.publish(TuiEvent.SubAgentActive, {
          sessionId: session.id,
          agentType: config.agent.name,
          description: config.description,
        })
      } catch { /* TUI may not be available */ }
    }

    // Execute the prompt
    const messageID = Identifier.ascending("message")
    const result = await SessionPrompt.prompt({
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

    const lastText = result.parts.findLast((x) => x.type === "text")
    const output = lastText && "text" in lastText ? (lastText as any).text : ""

    // Notify TUI that sub-agent finished
    try {
      await Bus.publish(TuiEvent.SubAgentDone, {
        sessionId: session.id,
        lastOutput: output.slice(0, 2000),
      })
    } catch { /* TUI may not be available */ }

    return {
      sessionId: session.id,
      isNewSession,
      output,
      parts: result.parts,
    }
  }
}
