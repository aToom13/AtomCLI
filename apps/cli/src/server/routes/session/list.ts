import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { errors } from "../../error"

export const listRoutes = new Hono()
    .get(
        "/session",
        describeRoute({
            summary: "List sessions",
            description: "Get a list of all AtomCLI sessions, sorted by most recently updated.",
            operationId: "session.list",
            responses: {
                200: {
                    description: "List of sessions",
                    content: {
                        "application/json": {
                            schema: resolver(Session.Info.array()),
                        },
                    },
                },
            },
        }),
        validator(
            "query",
            z.object({
                start: z.coerce
                    .number()
                    .optional()
                    .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
                search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
                limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
            }),
        ),
        async (c) => {
            const query = c.req.valid("query")
            const term = query.search?.toLowerCase()
            const sessions: Session.Info[] = []
            for await (const session of Session.list()) {
                if (query.start !== undefined && session.time.updated < query.start) continue
                if (term !== undefined && !session.title.toLowerCase().includes(term)) continue
                sessions.push(session)
                if (query.limit !== undefined && sessions.length >= query.limit) break
            }
            return c.json(sessions)
        },
    )
    .get(
        "/session/status",
        describeRoute({
            summary: "Get session status",
            description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
            operationId: "session.status",
            responses: {
                200: {
                    description: "Get session status",
                    content: {
                        "application/json": {
                            schema: resolver(z.record(z.string(), SessionStatus.Info)),
                        },
                    },
                },
                ...errors(400),
            },
        }),
        async (c) => {
            const result = SessionStatus.list()
            return c.json(result)
        },
    )
    .get(
        "/session/:sessionID",
        describeRoute({
            summary: "Get session",
            description: "Retrieve detailed information about a specific AtomCLI session.",
            tags: ["Session"],
            operationId: "session.get",
            responses: {
                200: {
                    description: "Get session",
                    content: {
                        "application/json": {
                            schema: resolver(Session.Info),
                        },
                    },
                },
                ...errors(400, 404),
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: Session.get.schema,
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const session = await Session.get(sessionID)
            return c.json(session)
        },
    )
    .get(
        "/session/:sessionID/children",
        describeRoute({
            summary: "Get session children",
            tags: ["Session"],
            description: "Retrieve all child sessions that were forked from the specified parent session.",
            operationId: "session.children",
            responses: {
                200: {
                    description: "List of children",
                    content: {
                        "application/json": {
                            schema: resolver(Session.Info.array()),
                        },
                    },
                },
                ...errors(400, 404),
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: Session.children.schema,
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const session = await Session.children(sessionID)
            return c.json(session)
        },
    )
    .get(
        "/session/:sessionID/todo",
        describeRoute({
            summary: "Get session todos",
            description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
            operationId: "session.todo",
            responses: {
                200: {
                    description: "Todo list",
                    content: {
                        "application/json": {
                            schema: resolver(Todo.Info.array()),
                        },
                    },
                },
                ...errors(400, 404),
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: z.string().meta({ description: "Session ID" }),
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const todos = await Todo.get(sessionID)
            return c.json(todos)
        },
    )
