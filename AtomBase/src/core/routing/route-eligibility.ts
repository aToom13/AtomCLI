import z from "zod"
import type { Provider } from "@/integrations/provider/provider"

export namespace RouteEligibility {
  export const Decision = z.enum(["eligible", "verification_required", "ineligible"])
  export type Decision = z.infer<typeof Decision>

  export const Reason = z.enum([
    "provider_not_connected",
    "provider_not_allowed",
    "model_unavailable",
    "model_excluded",
    "permission_denied",
    "free_model_required",
    "price_unknown",
    "text_unsupported",
    "tool_unsupported",
    "modality_unsupported",
    "context_too_small",
    "output_too_small",
    "variant_unsupported",
    "verification_missing",
    "verification_cooldown",
  ])
  export type Reason = z.infer<typeof Reason>

  export const Input = z.object({
    model: z.custom<Provider.Model>(),
    connected: z.boolean(),
    available: z.boolean().default(true),
    providerAllowed: z.boolean(),
    modelExcluded: z.boolean().default(false),
    permitted: z.boolean().default(true),
    freeOnly: z.boolean().default(false),
    price: z.enum(["free", "paid", "unknown"]),
    requiredCapabilities: z.array(z.enum(["text", "tool", "image", "audio", "video", "pdf"])).default(["text"]),
    requiredContext: z.number().int().nonnegative().default(0),
    requiredOutput: z.number().int().nonnegative().default(0),
    variant: z.string().optional(),
    paramsDigest: z.string(),
    verificationKey: z.string(),
    verification: z
      .object({
        status: z.enum(["unknown", "verified", "failed", "rate_limited", "inconclusive", "expired"]),
        capabilities: z.record(z.string(), z.number()),
        retryAt: z.number().optional(),
      })
      .optional(),
    requireVerification: z.boolean().default(true),
    now: z.number().default(() => Date.now()),
    estimate: z
      .object({
        calls: z.number().int().nonnegative().optional(),
        steps: z.number().int().nonnegative().optional(),
        costUsd: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  export type Input = z.input<typeof Input>

  export const Result = z.object({
    decision: Decision,
    reasonCodes: z.array(Reason),
    concreteRoute: z.object({ providerID: z.string(), modelID: z.string(), variant: z.string().optional() }),
    paramsDigest: z.string(),
    verificationKey: z.string(),
    priceEvidence: z.enum(["free", "paid", "unknown"]),
    estimate: Input.shape.estimate,
    expiresAt: z.number().optional(),
  })
  export type Result = z.infer<typeof Result>

  function supports(model: Provider.Model, capability: string) {
    if (capability === "text") return model.capabilities.input.text && model.capabilities.output.text
    if (capability === "tool") return model.capabilities.toolcall
    return model.capabilities.input[capability as "image" | "audio" | "video" | "pdf"]
  }

  export function evaluate(raw: Input): Result {
    const input = Input.parse(raw)
    const reasons: Reason[] = []
    if (!input.connected) reasons.push("provider_not_connected")
    if (!input.providerAllowed) reasons.push("provider_not_allowed")
    if (!input.available) reasons.push("model_unavailable")
    if (input.modelExcluded) reasons.push("model_excluded")
    if (!input.permitted) reasons.push("permission_denied")
    if (input.freeOnly && input.price !== "free")
      reasons.push(input.price === "unknown" ? "price_unknown" : "free_model_required")
    if (input.variant && !input.model.variants?.[input.variant]) reasons.push("variant_unsupported")
    if ((input.model.limit?.context ?? 0) < input.requiredContext) reasons.push("context_too_small")
    if ((input.model.limit?.output ?? 0) < input.requiredOutput) reasons.push("output_too_small")
    for (const capability of input.requiredCapabilities) {
      if (supports(input.model, capability)) continue
      reasons.push(
        capability === "text"
          ? "text_unsupported"
          : capability === "tool"
            ? "tool_unsupported"
            : "modality_unsupported",
      )
    }

    let expiresAt: number | undefined
    if (reasons.length === 0 && input.requireVerification) {
      const evidence = input.verification
      const verified = input.requiredCapabilities.every(
        (capability) => (evidence?.capabilities[capability] ?? 0) > input.now,
      )
      if (evidence?.status !== "verified" || !verified) {
        if (
          evidence &&
          ["failed", "rate_limited", "inconclusive"].includes(evidence.status) &&
          (evidence.retryAt ?? 0) > input.now
        ) {
          reasons.push("verification_cooldown")
          expiresAt = evidence.retryAt
        } else {
          reasons.push("verification_missing")
        }
      } else {
        expiresAt = Math.min(...input.requiredCapabilities.map((capability) => evidence.capabilities[capability]))
      }
    }

    const verificationOnly = reasons.length === 1 && reasons[0] === "verification_missing"
    return Result.parse({
      decision: verificationOnly ? "verification_required" : reasons.length ? "ineligible" : "eligible",
      reasonCodes: reasons,
      concreteRoute: { providerID: input.model.providerID, modelID: input.model.id, variant: input.variant },
      paramsDigest: input.paramsDigest,
      verificationKey: input.verificationKey,
      priceEvidence: input.price,
      estimate: input.estimate,
      expiresAt,
    })
  }
}
