
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { mapValues } from "remeda"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { errors } from "../error"
import { Log } from "../../util/log"

const log = Log.create({ service: "config" })

export const ConfigRoute = new Hono()
    .get(
        "/",
        describeRoute({
            summary: "Get configuration",
            description: "Retrieve the current AtomCLI configuration settings and preferences.",
            operationId: "config.get",
            responses: {
                200: {
                    description: "Get config info",
                    content: {
                        "application/json": {
                            schema: resolver(Config.Info),
                        },
                    },
                },
            },
        }),
        async (c) => {
            return c.json(await Config.get())
        },
    )
    .patch(
        "/",
        describeRoute({
            summary: "Update configuration",
            description: "Update AtomCLI configuration settings and preferences.",
            operationId: "config.update",
            responses: {
                200: {
                    description: "Successfully updated config",
                    content: {
                        "application/json": {
                            schema: resolver(Config.Info),
                        },
                    },
                },
                ...errors(400),
            },
        }),
        validator("json", Config.Info),
        async (c) => {
            const config = c.req.valid("json")
            await Config.update(config)
            return c.json(config)
        },
    )
    .get(
        "/providers",
        describeRoute({
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
            operationId: "config.providers",
            responses: {
                200: {
                    description: "List of providers",
                    content: {
                        "application/json": {
                            schema: resolver(
                                z.object({
                                    providers: z.lazy(() => Provider.Info.array()),
                                    default: z.record(z.string(), z.string()),
                                }),
                            ),
                        },
                    },
                },
            },
        }),
        async (c) => {
            using _ = log.time("providers")
            const providers = await Provider.list().then((x) => mapValues(x, (item) => item))
            return c.json({
                providers: Object.values(providers),
                default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
            })
        },
    )
