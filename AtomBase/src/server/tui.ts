import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { AsyncQueue } from "../util/queue"
import { Session } from "@/session"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { errors } from "./error"

const TuiRequest = z.object({
  path: z.string(),
  body: z.any(),
})

type TuiRequest = z.infer<typeof TuiRequest>

const request = new AsyncQueue<TuiRequest>()
const response = new AsyncQueue<any>()

export async function callTui(ctx: Context) {
  const body = await ctx.req.json()
  request.push({
    path: ctx.req.path,
    body,
  })
  return response.next()
}

export const TuiRoute = new Hono()
  .get(
    "/next",
    describeRoute({
      summary: "Get next TUI request",
      description: "Retrieve the next TUI (Terminal User Interface) request from the queue for processing.",
      operationId: "tui.control.next",
      responses: {
        200: {
          description: "Next TUI request",
          content: {
            "application/json": {
              schema: resolver(TuiRequest),
            },
          },
        },
      },
    }),
    async (c) => {
      const req = await request.next()
      return c.json(req)
    },
  )
  .post(
    "/response",
    describeRoute({
      summary: "Submit TUI response",
      description: "Submit a response to the TUI request queue to complete a pending request.",
      operationId: "tui.control.response",
      responses: {
        200: {
          description: "Response submitted successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("json", z.any()),
    async (c) => {
      const body = c.req.valid("json")
      response.push(body)
      return c.json(true)
    },
  )

export const TuiGeneralRoute = new Hono()
  .post(
    "/select-session",
    describeRoute({
      summary: "Select session",
      description: "Navigate the TUI to display the specified session.",
      operationId: "tui.selectSession",
      responses: {
        200: {
          description: "Session selected successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("json", TuiEvent.SessionSelect.properties),
    async (c) => {
      const { sessionID } = c.req.valid("json")
      await Session.get(sessionID)
      await Bus.publish(TuiEvent.SessionSelect, { sessionID })
      return c.json(true)
    },
  )
  .post(
    "/execute-command",
    describeRoute({
      summary: "Execute TUI command",
      description: "Execute a TUI command (e.g. agent_cycle)",
      operationId: "tui.executeCommand",
      responses: {
        200: {
          description: "Command executed successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", z.object({ command: z.string() })),
    async (c) => {
      const command = c.req.valid("json").command
      await Bus.publish(TuiEvent.CommandExecute, {
        command: {
          session_new: "session.new",
          session_share: "session.share",
          session_interrupt: "session.interrupt",
          session_compact: "session.compact",
          messages_page_up: "session.page.up",
          messages_page_down: "session.page.down",
          messages_half_page_up: "session.half.page.up",
          messages_half_page_down: "session.half.page.down",
          messages_first: "session.first",
          messages_last: "session.last",
          agent_cycle: "agent.cycle",
        }[command] as any,
      })
      return c.json(true)
    },
  )
  .post(
    "/show-toast",
    describeRoute({
      summary: "Show TUI toast",
      description: "Show a toast notification in the TUI",
      operationId: "tui.showToast",
      responses: {
        200: {
          description: "Toast notification shown successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("json", TuiEvent.ToastShow.properties),
    async (c) => {
      await Bus.publish(TuiEvent.ToastShow, c.req.valid("json"))
      return c.json(true)
    },
  )
  .post(
    "/publish",
    describeRoute({
      summary: "Publish TUI event",
      description: "Publish a TUI event",
      operationId: "tui.publish",
      responses: {
        200: {
          description: "Event published successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.union(
        Object.values(TuiEvent).map((def) => {
          return z
            .object({
              type: z.literal(def.type),
              properties: def.properties,
            })
            .meta({
              ref: "Event" + "." + def.type,
            })
        }),
      ),
    ),
    async (c) => {
      const evt = c.req.valid("json")
      await Bus.publish(Object.values(TuiEvent).find((def) => def.type === evt.type)!, evt.properties)
      return c.json(true)
    },
  )
