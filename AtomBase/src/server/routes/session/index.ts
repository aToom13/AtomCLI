import { Hono } from "hono"
import { SessionCoreRoute } from "./core"
import { SessionMessageRoute } from "./message"
import { SessionToolRoute } from "./tool"

// Session routes are split into modular sub-files:
// - core.ts: Basic CRUD and lifecycle operations
// - message.ts: Message and stream handling
// - tool.ts: Tools (revert, diff, command, etc.)

export const SessionRoute = new Hono()
    .route("/", SessionCoreRoute)
    .route("/", SessionMessageRoute)
    .route("/", SessionToolRoute)
