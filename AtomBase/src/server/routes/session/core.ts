import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { SessionPrompt } from "@/session/prompt"
import { Todo } from "@/session/todo"
import { errors } from "../../error"

export const SessionCoreRoute = new Hono()
    .get(
        "/",
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
        "/status",
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
        "/:sessionID",
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
        "/:sessionID/children",
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
        "/:sessionID/todo",
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
    .post(
        "/",
        describeRoute({
            summary: "Create session",
            description: "Create a new AtomCLI session for interacting with AI assistants and managing conversations.",
            operationId: "session.create",
            responses: {
                ...errors(400),
                200: {
                    description: "Successfully created session",
                    content: {
                        "application/json": {
                            schema: resolver(Session.Info),
                        },
                    },
                },
            },
        }),
        validator("json", Session.create.schema.optional()),
        async (c) => {
            const body = c.req.valid("json") ?? {}
            const session = await Session.create(body)
            return c.json(session)
        },
    )
    .delete(
        "/:sessionID",
        describeRoute({
            summary: "Delete session",
            description: "Delete a session and permanently remove all associated data, including messages and history.",
            operationId: "session.delete",
            responses: {
                200: {
                    description: "Successfully deleted session",
                    content: {
                        "application/json": {
                            schema: resolver(z.boolean()),
                        },
                    },
                },
                ...errors(400, 404),
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: Session.remove.schema,
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            await Session.remove(sessionID)
            return c.json(true)
        },
    )
    .patch(
        "/:sessionID",
        describeRoute({
            summary: "Update session",
            description: "Update properties of an existing session, such as title or other metadata.",
            operationId: "session.update",
            responses: {
                200: {
                    description: "Successfully updated session",
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
                sessionID: z.string(),
            }),
        ),
        validator(
            "json",
            z.object({
                title: z.string().optional(),
                time: z
                    .object({
                        archived: z.number().optional(),
                    })
                    .optional(),
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const updates = c.req.valid("json")

            const updatedSession = await Session.update(sessionID, (session) => {
                if (updates.title !== undefined) {
                    session.title = updates.title
                }
                if (updates.time?.archived !== undefined) session.time.archived = updates.time.archived
            })

            return c.json(updatedSession)
        },
    )
    .post(
        "/:sessionID/init",
        describeRoute({
            summary: "Initialize session",
            description:
                "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
            operationId: "session.init",
            responses: {
                200: {
                    description: "200",
                    content: {
                        "application/json": {
                            schema: resolver(z.boolean()),
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
        validator("json", Session.initialize.schema.omit({ sessionID: true })),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            await Session.initialize({ ...body, sessionID })
            return c.json(true)
        },
    )
    .post(
        "/:sessionID/fork",
        describeRoute({
            summary: "Fork session",
            description: "Create a new session by forking an existing session at a specific message point.",
            operationId: "session.fork",
            responses: {
                200: {
                    description: "200",
                    content: {
                        "application/json": {
                            schema: resolver(Session.Info),
                        },
                    },
                },
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: Session.fork.schema.shape.sessionID,
            }),
        ),
        validator("json", Session.fork.schema.omit({ sessionID: true })),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const result = await Session.fork({ ...body, sessionID })
            return c.json(result)
        },
    )
    .post(
        "/:sessionID/abort",
        describeRoute({
            summary: "Abort session",
            description: "Abort an active session and stop any ongoing AI processing or command execution.",
            operationId: "session.abort",
            responses: {
                200: {
                    description: "Aborted session",
                    content: {
                        "application/json": {
                            schema: resolver(z.boolean()),
                        },
                    },
                },
                ...errors(400, 404),
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: z.string(),
            }),
        ),
        async (c) => {
            SessionPrompt.cancel(c.req.valid("param").sessionID)
            return c.json(true)
        },
    )
    .post(
        "/:sessionID/share",
        describeRoute({
            summary: "Share session",
            description: "Create a shareable link for a session, allowing others to view the conversation.",
            operationId: "session.share",
            responses: {
                200: {
                    description: "Successfully shared session",
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
                sessionID: z.string(),
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            await Session.share(sessionID)
            const session = await Session.get(sessionID)
            return c.json(session)
        },
    )
