import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Session } from "@/session"
import { errors } from "../../error"

export const crudRoutes = new Hono()
    .post(
        "/session",
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
        "/session/:sessionID",
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
        "/session/:sessionID",
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
        "/session/:sessionID/share",
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
    .delete(
        "/session/:sessionID/share",
        describeRoute({
            summary: "Unshare session",
            description: "Remove the shareable link for a session, making it private again.",
            operationId: "session.unshare",
            responses: {
                200: {
                    description: "Successfully unshared session",
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
                sessionID: Session.unshare.schema,
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            await Session.unshare(sessionID)
            const session = await Session.get(sessionID)
            return c.json(session)
        },
    )
