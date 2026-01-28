import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { LSP } from "../../lsp"

export const LspRoute = new Hono()
    .get(
        "/",
        describeRoute({
            summary: "Get LSP server status",
            description: "Get the status of all LSP servers",
            operationId: "lsp.status",
            responses: {
                200: {
                    description: "Status of LSP servers",
                    content: {
                        "application/json": {
                            schema: resolver(LSP.Status.array()),
                        },
                    },
                },
            },
        }),
        async (c) => {
            return c.json(await LSP.status())
        },
    )
