const MAX_SCHEMA_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_SCHEMA_DEPTH = 12
const MAX_SCHEMA_NODES = 200

export namespace SubAgentRuntime {
  export type Capabilities = {
    outputSchema: boolean
    persona: boolean
    toolFilter: boolean
    depthLimit: boolean
    continuation: boolean
    cancellation: boolean
    isolation: boolean
    wait: boolean
    steer: boolean
    revive: boolean
    status: boolean
    liveActivity: boolean
  }

  export type ValidationMode = "strict" | "permissive"

  export type OutputSchema = {
    type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
    description?: string
    enum?: unknown[]
    const?: unknown
    properties?: Record<string, OutputSchema>
    required?: string[]
    additionalProperties?: boolean
    items?: OutputSchema
    minLength?: number
    maxLength?: number
    minimum?: number
    maximum?: number
    minItems?: number
    maxItems?: number
  }

  export type ValidationIssue = {
    path: string
    message: string
  }

  export type StructuredError = {
    code: "OUTPUT_SCHEMA_INVALID" | "OUTPUT_MISSING" | "OUTPUT_JSON_INVALID" | "OUTPUT_VALIDATION_FAILED"
    message: string
    issues: ValidationIssue[]
    rawPreview?: string
  }

  export type ValidationResult = { success: true; data: unknown } | { success: false; error: StructuredError }

  export class OutputValidationError extends Error {
    readonly detail: StructuredError

    constructor(detail: StructuredError) {
      super(detail.message)
      this.name = "SubAgentOutputValidationError"
      this.detail = detail
    }
  }

  export function negotiate(runtime: string, capabilities: Capabilities, required: Array<keyof Capabilities> = []) {
    const missing = required.filter((capability) => !capabilities[capability])
    if (missing.length > 0) {
      throw new Error(`Sub-agent runtime ${runtime} does not support: ${missing.join(", ")}`)
    }
  }

  export function parseSchema(value: unknown): OutputSchema {
    const serialized = JSON.stringify(value)
    if (!serialized || Buffer.byteLength(serialized) > MAX_SCHEMA_BYTES) {
      throw new OutputValidationError({
        code: "OUTPUT_SCHEMA_INVALID",
        message: `outputSchema must be valid JSON smaller than ${MAX_SCHEMA_BYTES} bytes`,
        issues: [],
      })
    }
    const issues: ValidationIssue[] = []
    let nodes = 0
    validateSchemaNode(value, "$", 0, issues, () => ++nodes)
    if (nodes > MAX_SCHEMA_NODES) {
      issues.push({ path: "$", message: `schema exceeds the ${MAX_SCHEMA_NODES}-node limit` })
    }
    if (issues.length > 0) {
      throw new OutputValidationError({
        code: "OUTPUT_SCHEMA_INVALID",
        message: "outputSchema is invalid or uses unsupported JSON Schema features",
        issues,
      })
    }
    return value as OutputSchema
  }

  export function contract(schema: OutputSchema, mode: ValidationMode) {
    return [
      "Return the requested structured result in exactly one tagged block at the end of your response:",
      '<structured_output>{"valid":"json matching the schema"}</structured_output>',
      `Validation mode: ${mode}. Do not put Markdown fences inside the tag.`,
      "Output schema:",
      JSON.stringify(schema),
    ].join("\n")
  }

  export function validateOutput(output: string, schema: OutputSchema, mode: ValidationMode): ValidationResult {
    if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
      return failure("OUTPUT_JSON_INVALID", `structured output exceeds the ${MAX_OUTPUT_BYTES}-byte limit`, [], output)
    }
    const tagged = [...output.matchAll(/<structured_output>\s*([\s\S]*?)\s*<\/structured_output>/gi)]
    let raw = tagged.length === 1 ? tagged[0][1] : undefined
    if (tagged.length > 1) {
      return failure("OUTPUT_JSON_INVALID", "multiple structured_output blocks were returned", [], output)
    }
    if (!raw && mode === "permissive") {
      const fenced = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)]
      if (fenced.length === 1) raw = fenced[0][1]
      else if (fenced.length === 0) raw = output.trim()
    }
    if (!raw?.trim()) {
      return failure(
        "OUTPUT_MISSING",
        "sub-agent did not return a structured_output block",
        [{ path: "$", message: "missing structured output" }],
        output,
      )
    }
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch (error) {
      return failure(
        "OUTPUT_JSON_INVALID",
        "sub-agent structured output is not valid JSON",
        [{ path: "$", message: error instanceof Error ? error.message : String(error) }],
        raw,
      )
    }
    const issues: ValidationIssue[] = []
    validateValue(data, schema, "$", mode, issues)
    if (issues.length > 0) {
      return failure("OUTPUT_VALIDATION_FAILED", "sub-agent structured output does not match outputSchema", issues, raw)
    }
    return { success: true, data }
  }

  function failure(
    code: StructuredError["code"],
    message: string,
    issues: ValidationIssue[],
    raw?: string,
  ): ValidationResult {
    return {
      success: false,
      error: {
        code,
        message,
        issues: issues.slice(0, 100),
        rawPreview: raw?.slice(0, 2_000),
      },
    }
  }

  function validateSchemaNode(
    value: unknown,
    schemaPath: string,
    depth: number,
    issues: ValidationIssue[],
    count: () => number,
  ) {
    count()
    if (depth > MAX_SCHEMA_DEPTH) {
      issues.push({ path: schemaPath, message: `schema exceeds the ${MAX_SCHEMA_DEPTH}-level depth limit` })
      return
    }
    if (!isRecord(value)) {
      issues.push({ path: schemaPath, message: "schema node must be an object" })
      return
    }
    const allowed = new Set([
      "type",
      "description",
      "enum",
      "const",
      "properties",
      "required",
      "additionalProperties",
      "items",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
    ])
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) issues.push({ path: `${schemaPath}.${key}`, message: "unsupported schema keyword" })
    }
    const types = new Set(["object", "array", "string", "number", "integer", "boolean", "null"])
    if (typeof value.type !== "string" || !types.has(value.type)) {
      issues.push({ path: `${schemaPath}.type`, message: "type must be one supported JSON type" })
      return
    }
    if (value.description !== undefined && typeof value.description !== "string") {
      issues.push({ path: `${schemaPath}.description`, message: "description must be a string" })
    }
    if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0)) {
      issues.push({ path: `${schemaPath}.enum`, message: "enum must be a non-empty array" })
    }
    if (value.type === "object") {
      if (value.properties !== undefined && !isRecord(value.properties)) {
        issues.push({ path: `${schemaPath}.properties`, message: "properties must be an object" })
      }
      if (isRecord(value.properties)) {
        for (const [key, child] of Object.entries(value.properties)) {
          validateSchemaNode(child, `${schemaPath}.properties.${key}`, depth + 1, issues, count)
        }
      }
      if (
        value.required !== undefined &&
        (!Array.isArray(value.required) || value.required.some((item) => typeof item !== "string"))
      ) {
        issues.push({ path: `${schemaPath}.required`, message: "required must contain property names" })
      }
      if (Array.isArray(value.required) && isRecord(value.properties)) {
        for (const key of value.required) {
          if (typeof key === "string" && !(key in value.properties)) {
            issues.push({ path: `${schemaPath}.required`, message: `unknown required property: ${key}` })
          }
        }
      }
      if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") {
        issues.push({ path: `${schemaPath}.additionalProperties`, message: "additionalProperties must be boolean" })
      }
    }
    if (value.type === "array") {
      if (value.items === undefined)
        issues.push({ path: `${schemaPath}.items`, message: "array schema requires items" })
      else validateSchemaNode(value.items, `${schemaPath}.items`, depth + 1, issues, count)
    }
    validateNonNegativeInteger(value, "minLength", schemaPath, issues)
    validateNonNegativeInteger(value, "maxLength", schemaPath, issues)
    validateNonNegativeInteger(value, "minItems", schemaPath, issues)
    validateNonNegativeInteger(value, "maxItems", schemaPath, issues)
    for (const key of ["minimum", "maximum"] as const) {
      if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
        issues.push({ path: `${schemaPath}.${key}`, message: `${key} must be a finite number` })
      }
    }
  }

  function validateNonNegativeInteger(
    value: Record<string, unknown>,
    key: string,
    schemaPath: string,
    issues: ValidationIssue[],
  ) {
    const current = value[key]
    if (current !== undefined && (!Number.isInteger(current) || (current as number) < 0)) {
      issues.push({ path: `${schemaPath}.${key}`, message: `${key} must be a non-negative integer` })
    }
  }

  function validateValue(
    value: unknown,
    schema: OutputSchema,
    valuePath: string,
    mode: ValidationMode,
    issues: ValidationIssue[],
  ) {
    if (!matchesType(value, schema.type)) {
      issues.push({ path: valuePath, message: `expected ${schema.type}, received ${describeType(value)}` })
      return
    }
    if (schema.const !== undefined && !sameJSON(value, schema.const)) {
      issues.push({ path: valuePath, message: "value does not match const" })
    }
    if (schema.enum && !schema.enum.some((item) => sameJSON(value, item))) {
      issues.push({ path: valuePath, message: "value is not in enum" })
    }
    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        issues.push({ path: valuePath, message: `string is shorter than ${schema.minLength}` })
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        issues.push({ path: valuePath, message: `string is longer than ${schema.maxLength}` })
      }
    }
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        issues.push({ path: valuePath, message: `number is less than ${schema.minimum}` })
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        issues.push({ path: valuePath, message: `number is greater than ${schema.maximum}` })
      }
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        issues.push({ path: valuePath, message: `array has fewer than ${schema.minItems} items` })
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        issues.push({ path: valuePath, message: `array has more than ${schema.maxItems} items` })
      }
      if (schema.items) {
        value.forEach((item, index) => validateValue(item, schema.items!, `${valuePath}[${index}]`, mode, issues))
      }
    }
    if (isRecord(value) && schema.type === "object") {
      const properties = schema.properties ?? {}
      for (const key of schema.required ?? []) {
        if (!(key in value)) issues.push({ path: `${valuePath}.${key}`, message: "required property is missing" })
      }
      for (const [key, item] of Object.entries(value)) {
        const property = properties[key]
        if (property) validateValue(item, property, `${valuePath}.${key}`, mode, issues)
        else if (schema.additionalProperties === false || (mode === "strict" && schema.additionalProperties !== true)) {
          issues.push({ path: `${valuePath}.${key}`, message: "additional property is not allowed" })
        }
      }
    }
  }

  function matchesType(value: unknown, type: OutputSchema["type"]) {
    if (type === "null") return value === null
    if (type === "array") return Array.isArray(value)
    if (type === "object") return isRecord(value)
    if (type === "integer") return typeof value === "number" && Number.isInteger(value)
    return typeof value === type
  }

  function describeType(value: unknown) {
    if (value === null) return "null"
    if (Array.isArray(value)) return "array"
    return typeof value
  }

  function sameJSON(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
