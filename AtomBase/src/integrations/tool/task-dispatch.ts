import { SubAgent } from "./subagent"
import { Skill } from "@/integrations/skill"
import { Session } from "@/core/session"
import { PermissionNext } from "@/util/permission/next"
import { Lock } from "@/util/util/lock"
import type { ExecutionRuntime } from "@/core/execution/runtime"

export namespace TaskDispatch {
  export async function spawn(
    config: SubAgent.SpawnConfig,
    skills: string[] = [],
    guard?: {
      sessionID: string
      execution: ExecutionRuntime.Context
      taskID: string
      expectedVersion: number
    },
  ) {
    for (const name of skills) {
      if (!(await Skill.get(name))) throw new Error(`Unknown skill: ${name}`)
      if (
        PermissionNext.evaluate("skill", name, PermissionNext.merge(config.agent.permission, config.permissions))
          .action === "deny"
      )
        throw new Error(`Skill denied for ${config.agent.name}: ${name}`)
    }
    const required = skills.map((name) => `@${name}`).join(" ")
    const spawnConfig = {
      ...config,
      parts: required
        ? [
            ...config.parts,
            { type: "text", text: `Required skills: ${required}. Load required instructions before work.` },
          ]
        : config.parts,
    } as SubAgent.SpawnConfig
    const parentUser = (
      await Session.messages({ sessionID: config.parentSessionID, limit: 20, excludePatches: true })
    ).findLast((message) => message.info.role === "user")
    if (
      parentUser?.info.role === "user" &&
      parentUser.info.model.providerID === "atomcli" &&
      parentUser.info.model.modelID === "atomcli-free"
    )
      spawnConfig.model = parentUser.info.model
    let pending: Promise<SubAgent.SpawnResult>
    if (guard) {
      using _lock = await Lock.write(`execution-tasks:${guard.execution.executionID}`)
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      await ExecutionRuntime.assertAtomicReady(guard)
      pending = SubAgent.spawn(spawnConfig)
    } else pending = SubAgent.spawn(spawnConfig)
    const result = await pending
    if (skills.length) {
      const pending = await Skill.pendingRequiredReads(
        required,
        await Session.messages({ sessionID: result.sessionId, excludePatches: true }),
      )
      if (pending.length) throw new Error(`Required skill reads incomplete: ${pending.join("; ")}`)
    }
    return result
  }
}
