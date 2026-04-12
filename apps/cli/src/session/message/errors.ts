import z from "zod"
import { NamedError } from "@atomcli/util/error"
import { APICallError, LoadAPIKeyError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import { ProviderTransform } from "@/provider/transform"
import { type SystemError } from "bun"

export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
export const AbortedError = NamedError.create("MessageAbortedError", z.object({ message: z.string() }))
export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
        providerID: z.string(),
        message: z.string(),
    }),
)
export const APIError = NamedError.create(
    "APIError",
    z.object({
        message: z.string(),
        statusCode: z.number().optional(),
        isRetryable: z.boolean(),
        responseHeaders: z.record(z.string(), z.string()).optional(),
        responseBody: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
    }),
)
export type APIError = z.infer<typeof APIError.Schema>

export const RetryPartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
})

export const RetryPart = RetryPartBase.extend({
    type: z.literal("retry"),
    attempt: z.number(),
    error: APIError.Schema,
    time: z.object({
        created: z.number(),
    }),
}).meta({
    ref: "RetryPart",
})
export type RetryPart = z.infer<typeof RetryPart>

export function fromError(e: unknown, ctx: { providerID: string }) {
    switch (true) {
        case e instanceof DOMException && e.name === "AbortError":
            return new AbortedError(
                { message: e.message },
                {
                    cause: e,
                },
            ).toObject()
        case OutputLengthError.isInstance(e):
            return e
        case LoadAPIKeyError.isInstance(e):
            return new AuthError(
                {
                    providerID: ctx.providerID,
                    message: e.message,
                },
                { cause: e },
            ).toObject()
        case (e as SystemError)?.code === "ECONNRESET":
            return new APIError(
                {
                    message: "Connection reset by server",
                    isRetryable: true,
                    metadata: {
                        code: (e as SystemError).code ?? "",
                        syscall: (e as SystemError).syscall ?? "",
                        message: (e as SystemError).message ?? "",
                    },
                },
                { cause: e },
            ).toObject()
        case APICallError.isInstance(e):
            const message = iife(() => {
                let msg = (e as any).message
                if (msg === "") {
                    if ((e as any).responseBody) return (e as any).responseBody
                    if ((e as any).statusCode) {
                        const err = STATUS_CODES[(e as any).statusCode]
                        if (err) return err
                    }
                    return "Unknown error"
                }
                const transformed = ProviderTransform.error(ctx.providerID, e as any)
                if (transformed !== msg) {
                    return transformed
                }
                if (!(e as any).responseBody || ((e as any).statusCode && msg !== STATUS_CODES[(e as any).statusCode])) {
                    return msg
                }

                try {
                    const body = JSON.parse((e as any).responseBody)
                    // try to extract common error message fields
                    const errMsg = body.message || body.error || body.error?.message
                    if (errMsg && typeof errMsg === "string") {
                        return `${msg}: ${errMsg}`
                    }
                } catch { }

                return `${msg}: ${(e as any).responseBody}`
            }).trim()

            return new APIError(
                {
                    message,
                    statusCode: (e as any).statusCode,
                    isRetryable: (e as any).isRetryable,
                    responseHeaders: (e as any).responseHeaders,
                    responseBody: (e as any).responseBody,
                },
                { cause: e },
            ).toObject()
        case e instanceof Error:
            return new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
        default:
            return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e })
    }
}
