import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Agent } from "../../agent/agent"
import z from "zod"

export const AgentRoute = new Hono()
    .get(
        "/",
        describeRoute({
            summary: "List agents",
            description: "Get a list of all available AI agents in the AtomCLI system.",
            operationId: "app.agents",
            responses: {
                200: {
                    description: "List of agents",
                    content: {
                        "application/json": {
                            schema: resolver(z.lazy(() => Agent.Info.array())),
                        },
                    },
                },
            },
        }),
        async (c) => {
            const modes = await Agent.list()
            return c.json(modes)
        },
    )
