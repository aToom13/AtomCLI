import { Hono } from "hono"
import { SessionCoreRoute } from "./core"

// Session routes are split into modular sub-files:
// - core.ts: Basic CRUD and lifecycle operations
// - message.ts: Message-related endpoints (TODO)
// - prompt.ts: Prompt and command endpoints (TODO)

export const SessionRoute = new Hono()
    .route("/", SessionCoreRoute)
