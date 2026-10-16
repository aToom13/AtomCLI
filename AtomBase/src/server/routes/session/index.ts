import { Hono } from "hono"
import { Session } from "@/core/session"
import { SessionCoreRoute } from "./core"
import { SessionMessageRoute } from "./message"
import { SessionToolRoute } from "./tool"
import { SessionExecutionRoute } from "./execution"

// Session routes are split into modular sub-files:
// - core.ts: Basic CRUD and lifecycle operations
// - message.ts: Message and stream handling
// - tool.ts: Tools (revert, diff, command, etc.)

export const SessionRoute = new Hono()
  .use("/:sessionID", async (c, next) => {
    if (c.req.param("sessionID") !== "status") await Session.get(c.req.param("sessionID"))
    await next()
  })
  .use("/:sessionID/*", async (c, next) => {
    if (c.req.param("sessionID") !== "status") await Session.get(c.req.param("sessionID"))
    await next()
  })
  .route("/", SessionCoreRoute)
  .route("/", SessionMessageRoute)
  .route("/", SessionToolRoute)
  .route("/", SessionExecutionRoute)
