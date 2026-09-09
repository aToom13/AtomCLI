export namespace ModelBilling {
  export type Kind = "free" | "subscription" | "metered" | "unknown"

  type Model = {
    api?: { url?: string }
    cost?: {
      input?: number
      output?: number
      cache?: { read?: number; write?: number }
      experimentalOver200K?: {
        input?: number
        output?: number
        cache?: { read?: number; write?: number }
      }
    }
    options?: Record<string, any>
  }

  export function classify(model: Model): Kind {
    const subscription =
      model.options?._billing === "subscription" || model.api?.url?.includes("chatgpt.com/backend-api/codex") === true
    if (subscription) return "subscription"
    if (!model.cost || model.options?._catalogCostKnown === false) return "unknown"

    const values = [model.cost.input, model.cost.output, model.cost.cache?.read, model.cost.cache?.write]
    if (model.cost.experimentalOver200K) {
      values.push(
        model.cost.experimentalOver200K.input,
        model.cost.experimentalOver200K.output,
        model.cost.experimentalOver200K.cache?.read,
        model.cost.experimentalOver200K.cache?.write,
      )
    }
    return values.every((value) => typeof value === "number" && Number.isFinite(value) && value === 0)
      ? "free"
      : "metered"
  }
}
