import { Hono } from "hono"
import { listRoutes } from "./session/list"
import { crudRoutes } from "./session/crud"
import { messageRoutes } from "./session/messages"
import { actionRoutes } from "./session/actions"

export const SessionRoute = new Hono()
    .route("/", listRoutes)
    .route("/", crudRoutes)
    .route("/", messageRoutes)
    .route("/", actionRoutes)
