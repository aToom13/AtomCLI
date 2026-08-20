export namespace SubAgentRuntime {
  export interface Capabilities {
    outputSchema: boolean
    persona: boolean
    toolFilter: boolean
    depthLimit: boolean
    continuation: boolean
    cancellation: boolean
  }

  export function negotiate(
    runtime: string,
    capabilities: Capabilities,
    required: Array<keyof Capabilities> = [],
  ) {
    const missing = required.filter((capability) => !capabilities[capability])
    if (missing.length > 0) {
      throw new Error(`Sub-agent runtime ${runtime} does not support: ${missing.join(", ")}`)
    }
  }
}
