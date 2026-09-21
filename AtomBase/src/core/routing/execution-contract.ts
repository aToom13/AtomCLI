import z from "zod"

export namespace ExecutionContract {
  export const Intent = z.enum(["answer", "inspect", "change", "operate", "design"])
  export type Intent = z.infer<typeof Intent>

  export const Scope = z.enum(["direct", "focused", "coordinated"])
  export type Scope = z.infer<typeof Scope>

  export const Risk = z.enum(["low", "elevated", "critical"])
  export type Risk = z.infer<typeof Risk>

  export const Surface = z.enum(["conversation", "workspace", "system", "network", "browser", "remote"])
  export type Surface = z.infer<typeof Surface>

  export const Uncertainty = z.enum(["low", "material", "blocking"])
  export type Uncertainty = z.infer<typeof Uncertainty>

  export const Info = z.object({
    intent: Intent,
    scope: Scope,
    risk: Risk.default("low"),
    confidence: z.number().min(0).max(1),
    deliverables: z.array(z.string()).max(8).default([]),
    expectedSurfaces: z.array(Surface).max(6).default(["conversation"]),
    assumptions: z.array(z.string()).max(5).default([]),
    uncertainty: Uncertainty.default("low"),
    needsDiscovery: z.boolean().default(false),
    needsMutation: z.boolean().default(false),
    needsExternalAction: z.boolean().default(false),
    likelyCrossBoundary: z.boolean().default(false),
    rationale: z.string().max(500).default(""),
  })
  export type Info = z.infer<typeof Info>

  export function fallback(reason = "classifier_unavailable", overrides?: Partial<Info>): Info {
    return {
      intent: "change",
      scope: "focused",
      risk: "elevated",
      confidence: 0,
      deliverables: [],
      expectedSurfaces: ["workspace"],
      assumptions: ["Fallback policy applied due to unavailable or failed classification"],
      uncertainty: "material",
      needsDiscovery: true,
      needsMutation: true,
      needsExternalAction: false,
      likelyCrossBoundary: false,
      rationale: reason,
      ...overrides,
    }
  }

  export function parseSafe(raw: unknown, reason = "invalid_classifier_output"): Info {
    if (!raw || typeof raw !== "object") return fallback(reason)
    const result = Info.safeParse(raw)
    if (result.success) return result.data
    return fallback(`${reason}: ${result.error.issues.map((i) => i.message).join(", ")}`)
  }
}
