import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Instance } from "@/project/instance"
import { Global } from "@/global"

export const InstanceRoute = new Hono()
    .post(
        "/instance/dispose",
        describeRoute({
            summary: "Dispose instance",
            description: "Clean up and dispose the current AtomCLI instance, releasing all resources.",
            operationId: "instance.dispose",
            responses: {
                200: {
                    description: "Instance disposed",
                    content: {
                        "application/json": {
                            schema: resolver(z.boolean()),
                        },
                    },
                },
            },
        }),
        async (c) => {
            await Instance.dispose()
            return c.json(true)
        },
    )
    .get(
        "/path",
        describeRoute({
            summary: "Get paths",
            description:
                "Retrieve the current working directory and related path information for the AtomCLI instance.",
            operationId: "path.get",
            responses: {
                200: {
                    description: "Path",
                    content: {
                        "application/json": {
                            schema: resolver(
                                z
                                    .object({
                                        home: z.string(),
                                        state: z.string(),
                                        config: z.string(),
                                        worktree: z.string(),
                                        directory: z.string(),
                                    })
                                    .meta({
                                        ref: "Path",
                                    }),
                            ),
                        },
                    },
                },
            },
        }),
        async (c) => {
            return c.json({
                home: Global.Path.home,
                state: Global.Path.state,
                config: Global.Path.config,
                worktree: Instance.worktree,
                directory: Instance.directory,
            })
        },
    )
