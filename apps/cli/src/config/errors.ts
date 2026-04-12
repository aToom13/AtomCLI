import { NamedError } from "@atomcli/util/error"
import z from "zod"

export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
        path: z.string(),
        message: z.string().optional(),
    }),
)

export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
        path: z.string(),
        dir: z.string(),
        suggestion: z.string(),
    }),
)

export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
        path: z.string(),
        issues: z.custom<z.core.$ZodIssue[]>().optional(),
        message: z.string().optional(),
    }),
)
