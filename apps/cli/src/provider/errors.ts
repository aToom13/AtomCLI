import { z } from "zod"
import { NamedError } from "@atomcli/util/error"

export const ModelNotFoundError = NamedError.create(
    "ModelNotFoundError",
    z.object({
        providerID: z.string(),
        modelID: z.string(),
        suggestions: z.string().array().optional(),
    }),
)
export type ModelNotFoundError = InstanceType<typeof ModelNotFoundError>

export const InitError = NamedError.create(
    "InitError",
    z.object({
        providerID: z.string(),
    }),
)
export type InitError = InstanceType<typeof InitError>
