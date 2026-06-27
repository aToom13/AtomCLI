import z from "zod"

// Preprocess to handle JSON string serialization from LLM tool calls
// LLM sometimes sends arrays/objects as JSON strings instead of native types
export function parseJsonIfString<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => {
    if (typeof val === "string") {
      try {
        return JSON.parse(val)
      } catch {
        return val
      }
    }
    return val
  }, schema)
}
