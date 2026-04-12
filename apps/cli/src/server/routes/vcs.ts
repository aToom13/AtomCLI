import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Vcs } from "@/project/vcs"

export const VcsRoute = new Hono()
    .get(
        "/vcs",
        describeRoute({
            summary: "Get VCS info",
            description:
                "Retrieve version control system (VCS) information for the current project, such as git branch.",
            operationId: "vcs.get",
            responses: {
                200: {
                    description: "VCS info",
                    content: {
                        "application/json": {
                            schema: resolver(Vcs.Info),
                        },
                    },
                },
            },
        }),
        async (c) => {
            const branch = await Vcs.branch()
            return c.json({
                branch,
            })
        },
    )
