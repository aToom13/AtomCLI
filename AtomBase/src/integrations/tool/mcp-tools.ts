import { createHash } from "node:crypto"
import z from "zod"
import { Storage } from "@/core/storage/storage"
import { Session } from "@/core/session"
import { MCP } from "@/integrations/mcp"
import { Agent } from "@/integrations/agent/agent"
import { PermissionNext } from "@/util/permission/next"
import { Token } from "@/util/util/token"
import { Lock } from "@/util/util/lock"
import { Tool } from "./tool"

export namespace McpTools {
  const PAGE_SIZE = 50
  // ponytail: schemas use at most a quarter of context, capped at 16k estimated tokens; explicit unload permits replacement.
  export const MAX_SCHEMA_TOKENS = 16_000
  type Selection = Record<string, string>
  export type Available = Awaited<ReturnType<typeof MCP.tools>>

  export async function permitted(input: {
    sessionID: string
    agent: Agent.Info
    tools?: Record<string, boolean>
    available: Available
  }) {
    const sessions = [await Session.get(input.sessionID)]
    const visited = new Set([input.sessionID])
    while (sessions.at(-1)?.parentID) {
      const parentID = sessions.at(-1)!.parentID!
      if (visited.has(parentID)) throw new Error("Cyclic session ancestry")
      visited.add(parentID)
      sessions.push(await Session.get(parentID))
    }
    return Object.fromEntries(
      Object.entries(input.available).filter(
        ([id]) =>
          input.tools?.[id] !== false &&
          PermissionNext.evaluate(id, "*", input.agent.permission, sessions[0].permission ?? []).action !== "deny" &&
          sessions
            .slice(1)
            .every((session) => PermissionNext.evaluate(id, "*", session.permission ?? []).action !== "deny"),
      ),
    )
  }

  export async function digest(item: Available[string]) {
    const { asSchema } = await import("ai")
    const schema = await asSchema(item.inputSchema).jsonSchema
    return createHash("sha256")
      .update(JSON.stringify({ description: item.description, schema }))
      .digest("hex")
  }

  export async function selection(sessionID: string) {
    try {
      return await Storage.read<Selection>(["session_mcp_tools", sessionID])
    } catch (error) {
      if (error instanceof Storage.NotFoundError) return {}
      throw error
    }
  }

  export async function selected(sessionID: string, available: Available) {
    const saved = await selection(sessionID)
    const result: Available = {}
    const stale: string[] = []
    for (const [id, hash] of Object.entries(saved)) {
      if (available[id] && (await digest(available[id])) === hash) result[id] = available[id]
      else stale.push(id)
    }
    return { tools: result, stale }
  }

  export async function schemaTokens(available: Available) {
    const { asSchema } = await import("ai")
    return Token.estimate(
      JSON.stringify(
        await Promise.all(
          Object.entries(available).map(async ([id, item]) => ({
            id,
            description: item.description,
            schema: await asSchema(item.inputSchema).jsonSchema,
          })),
        ),
      ),
    )
  }

  export const Info = Tool.define("mcp_tools", {
    mutating: false,
    description:
      "Discover every permitted MCP tool using a paginated short catalog; load exact IDs to advertise full schemas on the NEXT turn. No relevance filter. Search is optional. Never call a tool before load succeeds. Unload explicitly to free schema budget; nothing is silently evicted. Refresh list after server changes.",
    parameters: z.object({
      action: z.enum(["list", "load", "unload"]),
      ids: z.array(z.string().min(1)).min(1).max(50).optional(),
      query: z.string().max(200).optional(),
      offset: z.number().int().nonnegative().default(0),
    }),
    effects: { workspace: "none", external: "read", reversible: true, destructive: false, privileged: false },
    async execute(args, ctx) {
      using _ = await Lock.write(`mcp-tools:${ctx.sessionID}`)
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      if (ctx.agent === "reviewer" || (ctx.extra?.execution && ExecutionRuntime.isReviewer(ctx.extra.execution)))
        throw new Error("MCP discovery is unavailable to reviewers")
      const agent = await Agent.get(ctx.agent)
      if (!agent) throw new Error("Unknown agent")
      const owners: Record<string, string> = {}
      const available = await permitted({
        sessionID: ctx.sessionID,
        agent,
        tools: ctx.extra?.userTools,
        available: await MCP.tools(ctx.abort, undefined, owners),
      })
      const current = await selected(ctx.sessionID, available)
      const budget = Math.max(
        0,
        Math.min(MAX_SCHEMA_TOKENS, Math.floor((ctx.extra?.model?.limit?.context ?? 64_000) / 4)),
      )
      if (args.action === "list") {
        const query = args.query?.toLowerCase()
        const entries = Object.entries(available)
          .sort(([a], [b]) => a.localeCompare(b))
          .filter(([id, item]) => !query || `${id} ${item.description ?? ""}`.toLowerCase().includes(query))
        return {
          title: "MCP tool catalog",
          output: JSON.stringify({
            total: entries.length,
            nextOffset: args.offset + PAGE_SIZE < entries.length ? args.offset + PAGE_SIZE : null,
            schemaTokenBudget: budget,
            schemaTokens: await schemaTokens(current.tools),
            stale: current.stale,
            tools: entries.slice(args.offset, args.offset + PAGE_SIZE).map(([id, item]) => ({
              id,
              server: owners[id],
              description: (item.description ?? "").slice(0, 160),
              loaded: Boolean(current.tools[id]),
            })),
          }),
          metadata: { action: args.action as string },
        }
      }
      if (!args.ids?.length) throw new Error("load/unload requires exact tool IDs")
      const saved = await selection(ctx.sessionID)
      if (args.action === "unload") {
        for (const id of args.ids) delete saved[id]
      } else {
        for (const id of args.ids) {
          if (!available[id]) throw new Error(`MCP tool unavailable or denied: ${id}; refresh list`)
          current.tools[id] = available[id]
          saved[id] = await digest(available[id])
        }
        const tokens = await schemaTokens(current.tools)
        if (tokens > budget)
          throw new Error(
            `MCP schemas need ${tokens} estimated tokens; budget ${budget}. Load fewer IDs or unload tools explicitly. No selection changed.`,
          )
      }
      ctx.abort.throwIfAborted()
      await Storage.writeGuarded(["session_mcp_tools", ctx.sessionID], ctx.sessionID, saved)
      return {
        title: `MCP tools ${args.action}ed`,
        output: JSON.stringify({
          action: args.action,
          ids: args.ids,
          refresh: "Schemas refresh on the next model turn",
          schemaTokenBudget: budget,
        }),
        metadata: { action: args.action as string },
      }
    },
  })
}
