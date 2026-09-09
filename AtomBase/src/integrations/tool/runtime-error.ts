export class ToolNotAppliedError extends Error {
  readonly applied = false

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = "ToolNotAppliedError"
  }
}

export class ToolAppliedError extends Error {
  readonly applied = true

  constructor(tool: string, cause: unknown) {
    super(
      `Tool ${tool} completed its operation, but post-processing failed. The operation may have side effects; do not retry it automatically. ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = "ToolAppliedError"
  }
}
