import z from "zod"

export namespace ExecutionContract {
  export const Intent = z.enum(["answer", "inspect", "change", "operate", "design"])
  export type Intent = z.infer<typeof Intent>

  export const Scope = z.enum(["direct", "focused", "coordinated"])
  export type Scope = z.infer<typeof Scope>

  export const SCOPE_RANK: Record<Scope, number> = {
    direct: 0,
    focused: 1,
    coordinated: 2,
  }

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
    acceptance: z.array(z.string().min(1).max(1000)).max(16).optional(),
    acceptanceRevision: z.number().int().nonnegative().optional(),
    acceptanceChange: z
      .object({
        reason: z.enum([
          "initial_classification",
          "user_input",
          "mandatory_skill",
          "platform_constraint",
          "runtime_evidence",
        ]),
        detail: z.string().min(1).max(2000),
        invalidatedEvidence: z.array(z.string().max(2000)).max(100),
      })
      .optional(),
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

  export function acceptanceFor(prompt: string): string[] {
    const text = prompt.toLowerCase()
    const requiresWebGL =
      /\bwebgl\b/.test(text) &&
      !/\b(?:without|no)\s+webgl\b|\bwebgl\s+(?:is\s+)?not\s+(?:(?:an?\s+)?(?:extra\s+)?)?(?:required|necessary|requirement)\b/.test(
        text,
      )
    if ((!/\b3d\b/.test(text) && !requiresWebGL) || !/\b(?:game|games|gameplay)\b|oyun/.test(text)) return []
    // ponytail: explicit 3D game requests; other domains retain their original user criteria.
    return [
      "3D: each requested game has world coordinates, non-trivial projection, depth/occlusion and spatial movement that change the rendered scene; canvas existence and HUD changes alone are insufficient.",
      ...(/camera|kamera/.test(text)
        ? [
            "Camera: requested controls change the projected world view while preserving a usable scene in forward, quarter-turn and reverse views.",
          ]
        : []),
      "Gameplay: sustained input in every documented movement direction changes world position consistently with elapsed time; reach an actual objective and observe progression feedback.",
      "Interaction: real browser pointer/keyboard input verifies documented controls and app behavior; helper calls, state mutations and DOM .click() are setup, not input proof. fill() does not prove physical keypress handling.",
      ...(requiresWebGL ? ["Renderer: an active WebGL context renders the requested game."] : []),
      ...(/collision|boundar|çarpış|sınır/.test(text)
        ? ["Collision: player interaction with obstacles or world boundaries prevents invalid spatial movement."]
        : []),
    ]
  }

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

  export function conservativeScope(agentMode?: string): Scope {
    return agentMode === "reviewer" ? "direct" : "focused"
  }

  export function parseSafe(raw: unknown, reason = "invalid_classifier_output"): Info {
    if (!raw || typeof raw !== "object") return fallback(reason)
    const result = Info.safeParse(raw)
    if (result.success) return result.data
    return fallback(`${reason}: ${result.error.issues.map((i) => i.message).join(", ")}`)
  }
}
