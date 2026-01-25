import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { stream } from "hono/streaming"
import { z } from "zod"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { MessageV2 } from "@/session/message-v2"
import { errors } from "../../error"

export const SessionMessageRoute = new Hono()
    .get(
        "/:sessionID/message",
        describeRoute({
            summary: "Get session messages",
            description: "Retrieve all messages in a session, including user prompts and AI responses.",
            operationId: "session.messages",
            responses: {
                200: {
                    description: "List of messages",
                    content: {
                        "application/json": {
                            schema: resolver(z.lazy(() => MessageV2.WithParts.array())),
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
            "query",
            z.object({
                limit: z.coerce.number().optional(),
            }),
        ),
        async (c) => {
            const query = c.req.valid("query")
            const messages = await Session.messages({
                sessionID: c.req.valid("param").sessionID,
                limit: query.limit,
            })
            return c.json(messages)
        },
    )
    .get(
        "/:sessionID/message/:messageID",
        describeRoute({
            summary: "Get message",
            description: "Retrieve a specific message from a session by its message ID.",
            operationId: "session.message",
            responses: {
                200: {
                    description: "Message",
                    content: {
                        "application/json": {
                            schema: resolver(
                                z.object({
                                    info: z.lazy(() => MessageV2.Info),
                                    parts: z.lazy(() => MessageV2.Part.array()),
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
                messageID: z.string().meta({ description: "Message ID" }),
            }),
        ),
        async (c) => {
            const params = c.req.valid("param")
            const message = await MessageV2.get({
                sessionID: params.sessionID,
                messageID: params.messageID,
            })
            return c.json(message)
        },
    )
    .delete(
        "/:sessionID/message/:messageID/part/:partID",
        describeRoute({
            description: "Delete a part from a message",
            operationId: "part.delete",
            responses: {
                200: {
                    description: "Successfully deleted part",
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
                messageID: z.string().meta({ description: "Message ID" }),
                partID: z.string().meta({ description: "Part ID" }),
            }),
        ),
        async (c) => {
            const params = c.req.valid("param")
            await Session.removePart({
                sessionID: params.sessionID,
                messageID: params.messageID,
                partID: params.partID,
            })
            return c.json(true)
        },
    )
    .patch(
        "/:sessionID/message/:messageID/part/:partID",
        describeRoute({
            description: "Update a part in a message",
            operationId: "part.update",
            responses: {
                200: {
                    description: "Successfully updated part",
                    content: {
                        "application/json": {
                            schema: resolver(z.lazy(() => MessageV2.Part)),
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
                messageID: z.string().meta({ description: "Message ID" }),
                partID: z.string().meta({ description: "Part ID" }),
            }),
        ),
        validator("json", z.lazy(() => MessageV2.Part)),
        async (c) => {
            const params = c.req.valid("param")
            const body = c.req.valid("json")
            if (
                body.id !== params.partID ||
                body.messageID !== params.messageID ||
                body.sessionID !== params.sessionID
            ) {
                throw new Error(
                    `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
                )
            }
            const part = await Session.updatePart(body)
            return c.json(part)
        },
    )
    .post(
        "/:sessionID/message",
        describeRoute({
            summary: "Send message",
            description: "Create and send a new message to a session, streaming the AI response.",
            operationId: "session.prompt",
            responses: {
                200: {
                    description: "Created message",
                    content: {
                        "application/json": {
                            schema: resolver(
                                z.object({
                                    info: z.lazy(() => MessageV2.Assistant),
                                    parts: z.lazy(() => MessageV2.Part.array()),
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
        validator("json", z.lazy(() => SessionPrompt.PromptInput.omit({ sessionID: true }))),
        async (c) => {
            c.status(200)
            c.header("Content-Type", "application/json")
            return stream(c, async (stream) => {
                const sessionID = c.req.valid("param").sessionID
                const body = c.req.valid("json")
                const msg = await SessionPrompt.prompt({ ...body, sessionID })
                stream.write(JSON.stringify(msg))
            })
        },
    )
    .post(
        "/:sessionID/prompt_async",
        describeRoute({
            summary: "Send async message",
            description:
                "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
            operationId: "session.prompt_async",
            responses: {
                204: {
                    description: "Prompt accepted",
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
        validator("json", z.lazy(() => SessionPrompt.PromptInput.omit({ sessionID: true }))),
        async (c) => {
            c.status(204)
            c.header("Content-Type", "application/json")
            return stream(c, async () => {
                const sessionID = c.req.valid("param").sessionID
                const body = c.req.valid("json")
                SessionPrompt.prompt({ ...body, sessionID })
            })
        },
    )
