import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "@/session/summary"
import { SessionRevert } from "@/session/revert"
import { SessionCompaction } from "@/session/compaction"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "@/session/message-v2"
import { errors } from "../../error"

export const SessionToolRoute = new Hono()
    .get(
        "/:sessionID/diff",
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
                sessionID: z.lazy(() => SessionSummary.diff.schema.shape.sessionID),
            }),
        ),
        validator(
            "query",
            z.object({
                messageID: z.lazy(() => SessionSummary.diff.schema.shape.messageID),
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
        "/:sessionID/summarize",
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
        "/:sessionID/diff",
        describeRoute({
            summary: "Get session diff",
            description: "Get all file changes (diffs) made during this session.",
            operationId: "session.diff",
            responses: {
                200: {
                    description: "List of diffs",
                    content: {
                        "application/json": {
                            schema: resolver(Snapshot.FileDiff.array()),
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
            const diff = await Session.diff(c.req.valid("param").sessionID)
            return c.json(diff)
        },
    )
    .post(
        "/:sessionID/command",
        describeRoute({
            summary: "Send command",
            description: "Send a new command to a session for execution by the AI assistant.",
            operationId: "session.command",
            responses: {
                200: {
                    description: "Created message",
                    content: {
                        "application/json": {
                            schema: resolver(
                                z.object({
                                    info: MessageV2.Assistant,
                                    parts: MessageV2.Part.array(),
                                }),
                            ),
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
        validator("json", z.lazy(() => SessionPrompt.CommandInput.omit({ sessionID: true }))),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const msg = await SessionPrompt.command({ ...body, sessionID })
            return c.json(msg)
        },
    )
    .post(
        "/:sessionID/shell",
        describeRoute({
            summary: "Run shell command",
            description: "Execute a shell command within the session context and return the AI's response.",
            operationId: "session.shell",
            responses: {
                200: {
                    description: "Created message",
                    content: {
                        "application/json": {
                            schema: resolver(MessageV2.Assistant),
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
        validator("json", z.lazy(() => SessionPrompt.ShellInput.omit({ sessionID: true }))),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const msg = await SessionPrompt.shell({ ...body, sessionID })
            return c.json(msg)
        },
    )
    .post(
        "/:sessionID/revert",
        describeRoute({
            summary: "Revert message",
            description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
            operationId: "session.revert",
            responses: {
                200: {
                    description: "Reverted message",
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
        validator("json", z.lazy(() => SessionRevert.RevertInput.omit({ sessionID: true }))),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            await SessionRevert.revert({ ...body, sessionID })
            return c.json(true)
        },
    )
    .post(
        "/:sessionID/unrevert",
        describeRoute({
            summary: "Restore reverted messages",
            description: "Restore all previously reverted messages in a session.",
            operationId: "session.unrevert",
            responses: {
                200: {
                    description: "Updated session",
                    content: {
                        "application/json": {
                            schema: resolver(z.lazy(() => Session.Info)),
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
    .delete(
        "/:sessionID/share",
        describeRoute({
            summary: "Unshare session",
            description: "Remove the shareable link for a session, making it private again.",
            operationId: "session.unshare",
            responses: {
                200: {
                    description: "Successfully unshared session",
                    content: {
                        "application/json": {
                            schema: resolver(z.lazy(() => Session.Info)),
                        },
                    },
                },
                ...errors(400, 404),
            },
        }),
        validator(
            "param",
            z.object({
                sessionID: z.lazy(() => Session.unshare.schema),
            }),
        ),
        async (c) => {
            const sessionID = c.req.valid("param").sessionID
            await Session.unshare(sessionID)
            const session = await Session.get(sessionID)
            return c.json(session)
        },
    )
