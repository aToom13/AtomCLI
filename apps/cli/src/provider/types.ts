import z from "zod"
import { type Provider as SDK } from "ai"
import { NamedError } from "@atomcli/util/error"

export type CustomModelLoader = (
    sdk: any,
    modelID: string,
    options?: Record<string, any>,
) => Promise<any>

export type CustomLoader = (provider: Info) => Promise<{
    autoload: boolean
    getModel?: CustomModelLoader
    options?: Record<string, any>
    models?: Record<string, Model>
}>

export const Model = z
    .object({
        id: z.string(),
        modelID: z.string(),
        providerID: z.string(),
        api: z.object({
            id: z.string(),
            url: z.string(),
            npm: z.string(),
        }),
        name: z.string(),
        family: z.string().optional(),
        capabilities: z.object({
            temperature: z.boolean(),
            reasoning: z.boolean(),
            attachment: z.boolean(),
            toolcall: z.boolean(),
            interleaved: z.union([
                z.boolean(),
                z.object({
                    field: z.enum(["reasoning_content", "reasoning_details"]),
                }),
            ]),
            input: z.object({
                text: z.boolean(),
                audio: z.boolean(),
                image: z.boolean(),
                video: z.boolean(),
                pdf: z.boolean(),
            }),
            output: z.object({
                text: z.boolean(),
                audio: z.boolean(),
                image: z.boolean(),
                video: z.boolean(),
                pdf: z.boolean(),
            }),
        }),
        cost: z.object({
            input: z.number(),
            output: z.number(),
            cache: z
                .object({
                    read: z.number(),
                    write: z.number(),
                })
                .optional(),
            experimentalOver200K: z
                .object({
                    input: z.number(),
                    output: z.number(),
                    cache: z.object({
                        read: z.number(),
                        write: z.number(),
                    }),
                })
                .optional(),
        }),
        limit: z.object({
            context: z.number(),
            output: z.number(),
        }),
        release_date: z.string(),
        status: z.enum(["alpha", "beta", "deprecated", "active"]),
        options: z.record(z.string(), z.any()),
        headers: z.record(z.string(), z.string()),
        variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .meta({
        ref: "Model",
    })

export type Model = z.infer<typeof Model>

export const Info = z
    .object({
        id: z.string(),
        name: z.string(),
        source: z.enum(["env", "config", "custom", "api"]),
        env: z.string().array(),
        key: z.string().optional(),
        options: z.record(z.string(), z.any()),
        models: z.record(z.string(), Model),
        npm: z.string().optional(),
    })
    .meta({
        ref: "Provider",
    })

export type Info = z.infer<typeof Info>

export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
        providerID: z.string(),
        modelID: z.string(),
        suggestions: z.array(z.string()).optional(),
    }),
)

export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
        providerID: z.string(),
    }),
)
