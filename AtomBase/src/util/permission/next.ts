import { Bus } from "@/core/bus"
import { BusEvent } from "@/core/bus/bus-event"
import { Config } from "@/core/config/config"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Storage } from "@/core/storage/storage"
import { fn } from "@/util/util/fn"
import { Log } from "@/util/util/log"
import { Wildcard } from "@/util/util/wildcard"
import z from "zod"

import { Flag } from "@/interfaces/flag/flag"

export namespace PermissionNext {
  const log = Log.create({ service: "permission" })

  // Permissions that are NEVER auto-allowed, even in YOLO or autonomous mode.
  // edit/write/task/todowrite/todoread are exempt so sub-agent deny rules
  // (e.g. the reviewer's read-only baseline) stay effective under YOLO — the
  // ruleset is still evaluated for these instead of being blindly auto-allowed.
  const YOLO_EXEMPT_PERMISSIONS = ["window_control", "edit", "write", "ssh", "task", "todowrite", "todoread"]

  export const Action = z.enum(["allow", "deny", "ask"]).meta({
    ref: "PermissionAction",
  })
  export type Action = z.infer<typeof Action>

  export const Rule = z
    .object({
      permission: z.string(),
      pattern: z.string(),
      action: Action,
    })
    .meta({
      ref: "PermissionRule",
    })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array().meta({
    ref: "PermissionRuleset",
  })
  export type Ruleset = z.infer<typeof Ruleset>

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
    for (const [key, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        ruleset.push({
          permission: key,
          action: value,
          pattern: "*",
        })
        continue
      }
      ruleset.push(...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern, action })))
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.filter(Boolean).flat()
  }

  export const Request = z
    .object({
      id: Identifier.schema("permission"),
      sessionID: Identifier.schema("session"),
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "PermissionRequest",
    })

  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Approval = z.object({
    projectID: z.string(),
    patterns: z.string().array(),
  })

  export const Event = {
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        reply: Reply,
      }),
    ),
  }

  const state = Instance.state(async () => {
    const projectID = Instance.project.id
    let stored: Ruleset = []
    try {
      stored = await Storage.read<Ruleset>(["permission", projectID])
      if (!Array.isArray(stored)) {
        log.warn("permission store corrupted, resetting", { projectID })
        stored = []
      }
    } catch (error) {
      log.warn("failed to load persisted permissions, starting fresh", { projectID, error })
    }

    // SSH approvals used to persist command/path-specific patterns. The SSH
    // tool now treats "always" as approval for the whole tool, so preserve the
    // user's earlier choice instead of prompting again after the upgrade.
    const hasLegacySshApproval = stored.some(
      (rule) => rule.permission === "ssh" && rule.action === "allow" && rule.pattern !== "*",
    )
    const hasWholeSshApproval = stored.some(
      (rule) => rule.permission === "ssh" && rule.action === "allow" && rule.pattern === "*",
    )
    if (hasLegacySshApproval && !hasWholeSshApproval) {
      stored.push({ permission: "ssh", pattern: "*", action: "allow" })
      try {
        await Storage.write(["permission", projectID], stored)
      } catch (error) {
        log.warn("failed to persist upgraded SSH permission", { projectID, error })
      }
    }

    const pending: Record<
      string,
      {
        info: Request
        resolve: () => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
      approved: stored,
    }
  })

  export const ask = fn(
    Request.partial({ id: true }).extend({
      ruleset: Ruleset,
    }),
    async (input) => {
      // YOLO mode: auto-allow everything except exempt permissions (e.g., window_control)
      // Activated by: --yolo/--autonomous CLI flag, ATOMCLI_YOLO/ATOMCLI_AUTONOMOUS env, or config agent_mode
      if (Flag.ATOMCLI_YOLO && !YOLO_EXEMPT_PERMISSIONS.includes(input.permission)) {
        // Deny rules stay effective even in YOLO: a YOLO parent must not
        // auto-allow a sub-agent call that its own merged ruleset explicitly
        // denies (e.g. the reviewer's read-only bash overlay). Evaluate the
        // FINAL verdict per pattern (findLast semantics, no storage read)
        // before the auto-allow shortcut — an explicit allow (e.g. the
        // reviewer's read: {"*": "allow"}) wins over the catch-all baseline,
        // while unlisted tools still fall back to the catch-all deny.
        const denyRules: Rule[] = []
        for (const pattern of input.patterns ?? []) {
          const rule = evaluate(input.permission, pattern, input.ruleset)
          if (rule.action === "deny") denyRules.push(rule)
        }
        if (denyRules.length > 0) {
          log.warn("YOLO mode: deny rule overrides auto-allow", { permission: input.permission, denyRules })
          throw new DeniedError(denyRules)
        }
        log.info("YOLO mode: auto-allowing", { permission: input.permission })
        return
      }
      const s = await state()
      const { ruleset, ...request } = input
      // Hard denies from the passed ruleset (agent overlays / config) must win
      // over stored user approvals, otherwise a reviewer's read-only bash
      // overlay could be bypassed by an "always" approval stored earlier.
      // Re-append the ruleset's deny rules after s.approved so findLast picks
      // the deny for matching patterns — approvals still work for everything
      // that is not explicitly denied. The universal catch-all deny ("*": "*")
      // is excluded: it is the allowlist baseline, not a hard deny, and
      // re-appending it would shadow the agent's explicit allows (e.g. the
      // reviewer's read: {"*": "allow"}).
      const hardDenies = ruleset.filter(
        (rule) => rule.action === "deny" && !(rule.permission === "*" && rule.pattern === "*"),
      )
      for (const pattern of request.patterns ?? []) {
        const rule = evaluate(request.permission, pattern, ruleset, s.approved, hardDenies)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny")
          throw new DeniedError(ruleset.filter((r) => Wildcard.match(request.permission, r.permission)))
        if (rule.action === "ask") {
          const id = input.id ?? Identifier.ascending("permission")
          return new Promise<void>((resolve, reject) => {
            const info: Request = {
              id,
              ...request,
            }
            // Auto-reject after 5 min if user doesn't respond (extended for mobile use)
            const autoRejectTimer = setTimeout(() => {
              if (s.pending[id]) {
                delete s.pending[id]
                log.warn("permission auto-rejected after 5min timeout", {
                  id,
                  permission: request.permission,
                })
                Bus.publish(Event.Replied, {
                  sessionID: request.sessionID,
                  requestID: id,
                  reply: "reject" as Reply,
                })
                reject(new RejectedError())
              }
            }, 300_000)
            s.pending[id] = {
              info,
              resolve: () => {
                clearTimeout(autoRejectTimer)
                resolve()
              },
              reject: (e: any) => {
                clearTimeout(autoRejectTimer)
                reject(e)
              },
            }
            Bus.publish(Event.Asked, info)
          })
        }
        if (rule.action === "allow") continue
      }
    },
  )

  export const reply = fn(
    z.object({
      requestID: Identifier.schema("permission"),
      reply: Reply,
      message: z.string().optional(),
    }),
    async (input) => {
      const s = await state()
      const existing = s.pending[input.requestID]
      if (!existing) return
      delete s.pending[input.requestID]
      Bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })
      if (input.reply === "reject") {
        existing.reject(input.message ? new CorrectedError(input.message) : new RejectedError())
        // Reject all other pending permissions for this session
        const sessionID = existing.info.sessionID
        for (const [id, pending] of Object.entries(s.pending)) {
          if (pending.info.sessionID === sessionID) {
            delete s.pending[id]
            Bus.publish(Event.Replied, {
              sessionID: pending.info.sessionID,
              requestID: pending.info.id,
              reply: "reject",
            })
            pending.reject(new RejectedError())
          }
        }
        return
      }
      if (input.reply === "once") {
        existing.resolve()
        return
      }
      if (input.reply === "always") {
        for (const pattern of existing.info.always) {
          s.approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }

        existing.resolve()

        const sessionID = existing.info.sessionID
        for (const [id, pending] of Object.entries(s.pending)) {
          if (pending.info.sessionID !== sessionID) continue
          const ok = pending.info.patterns.every(
            (pattern) => evaluate(pending.info.permission, pattern, s.approved).action === "allow",
          )
          if (!ok) continue
          delete s.pending[id]
          Bus.publish(Event.Replied, {
            sessionID: pending.info.sessionID,
            requestID: pending.info.id,
            reply: "always",
          })
          pending.resolve()
        }

        // Persist the permission ruleset to disk
        try {
          await Storage.write(["permission", Instance.project.id], s.approved)
        } catch (error) {
          log.error("failed to persist permission rules to disk — approval will only last this session", {
            error,
            projectID: Instance.project.id,
          })
        }
        return
      }
    },
  )

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    const merged = merge(...rulesets)
    log.info("evaluate", { permission, pattern, ruleset: merged })
    const match = merged.findLast(
      (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
    return match ?? { action: "ask", permission, pattern: "*" }
  }

  const EDIT_TOOLS = ["edit", "write"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool

      const rule = ruleset.findLast((r) => Wildcard.match(permission, r.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }

  /** User rejected without message - halts execution */
  export class RejectedError extends Error {
    constructor() {
      super(`The user rejected permission to use this specific tool call.`)
    }
  }

  /** User rejected with message - continues with guidance */
  export class CorrectedError extends Error {
    constructor(message: string) {
      super(`The user rejected permission to use this specific tool call with the following feedback: ${message}`)
    }
  }

  /** Auto-rejected by config rule - halts execution */
  export class DeniedError extends Error {
    constructor(public readonly ruleset: Ruleset) {
      super(
        `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`,
      )
    }
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }
}
