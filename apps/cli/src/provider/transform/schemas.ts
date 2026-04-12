import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "../provider"

export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema) {
    // Convert integer enums to string enums for Google/Gemini
    if (model.providerID === "google" || model.api.id.includes("gemini")) {
        const sanitizeGemini = (obj: any): any => {
            if (obj === null || typeof obj !== "object") {
                return obj
            }

            if (Array.isArray(obj)) {
                return obj.map(sanitizeGemini)
            }

            const result: any = {}
            for (const [key, value] of Object.entries(obj)) {
                if (key === "enum" && Array.isArray(value)) {
                    // Convert all enum values to strings
                    result[key] = value.map((v) => String(v))
                    // If we have integer type with enum, change type to string
                    if (result.type === "integer" || result.type === "number") {
                        result.type = "string"
                    }
                } else if (typeof value === "object" && value !== null) {
                    result[key] = sanitizeGemini(value)
                } else {
                    result[key] = value
                }
            }

            // Filter required array to only include fields that exist in properties
            if (result.type === "object" && result.properties && Array.isArray(result.required)) {
                result.required = result.required.filter((field: any) => field in result.properties)
            }

            if (result.type === "array" && result.items == null) {
                result.items = {}
            }

            return result
        }

        schema = sanitizeGemini(schema)
    }

    return schema
}
