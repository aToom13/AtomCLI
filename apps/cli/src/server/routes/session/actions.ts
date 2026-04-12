import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionCompaction } from "@/session/compaction"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { Agent } from "@/agent/agent"
import { errors } from "../../error"

export const actionRoutes = new Hono()
    .post(
        "/session/:sessionID/init",
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
        "/session/:sessionID/fork",
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
        "/session/:sessionID/abort",
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
        "/session/:sessionID/summarize",
        describeRoute({
            summary: "Summarize session",
            description: "Generate a concise summary of the session using AI compaction to preserve key information.",
            operationId: "session.summarize",
            responses: {
                200: {
                    description: "Summarized session",
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
        validator(
            "json",
            z.object({
                providerID: z.string(),
                modelID: z.string(),
                auto: z.boolean().optional().default(false),
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const session = await Session.get(sessionID)
            await SessionRevert.cleanup(session)
            const msgs = await Session.messages({ sessionID })
            let currentAgent = await Agent.defaultAgent()
            for (let i = msgs.length - 1; i >= 0; i--) {
                const info = msgs[i].info
                if (info.role === "user") {
                    currentAgent = info.agent || (await Agent.defaultAgent())
                    break
                }
            }
            await SessionCompaction.create({
                sessionID,
                agent: currentAgent,
                model: {
                    providerID: body.providerID,
                    modelID: body.modelID,
                },
                auto: body.auto,
            })
            await SessionPrompt.loop(sessionID)
            return c.json(true)
        },
    )
    .get(
        "/session/:sessionID/diff",
        describeRoute({
            summary: "Get message diff",
            description: "Get the file changes (diff) that resulted from a specific user message in the session.",
            operationId: "session.diff",
            responses: {
                200: {
                    description: "Successfully retrieved diff",
                    content: {
                        "application/json": {
                            schema: resolver(Snapshot.FileDiff.array()),
                        },
                    },
                },
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: SessionSummary.diff.schema.shape.sessionID,
            }),
        ),
        validator(
            "query",
            z.object({
                messageID: SessionSummary.diff.schema.shape.messageID,
            }),
        ),
        async (c) => {
            const query = c.req.valid("query")
            const params = c.req.valid("param")
            const result = await SessionSummary.diff({
                sessionID: params.sessionID,
                messageID: query.messageID,
            })
            return c.json(result)
        },
    )
    .post(
        "/session/:sessionID/revert",
        describeRoute({
            summary: "Revert message",
            description:
                "Revert a specific message in a session, undoing its effects and restoring the previous state.",
            operationId: "session.revert",
            responses: {
                200: {
                    description: "Updated session",
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
        validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const session = await SessionRevert.revert({
                sessionID,
                ...c.req.valid("json"),
            })
            return c.json(session)
        },
    )
    .post(
        "/session/:sessionID/unrevert",
        describeRoute({
            summary: "Restore reverted messages",
            description: "Restore all previously reverted messages in a session.",
            operationId: "session.unrevert",
            responses: {
                200: {
                    description: "Updated session",
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
            const session = await SessionRevert.unrevert({ sessionID })
            return c.json(session)
        },
    )
