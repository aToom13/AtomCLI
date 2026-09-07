import { Provider } from "@/integrations/provider/provider"
import { selectModel, type TaskCategory } from "@/integrations/tool/model-router"

export namespace ModelPurpose {
  export type ModelReference = { providerID: string; modelID: string }

  export async function select(category: TaskCategory, prompt = "", reference?: ModelReference) {
    if (reference) return reference
    const fallback = await Provider.defaultModel()
    return selectModel(category, fallback, "balanced", 0, undefined, prompt)
  }

  export async function language(category: TaskCategory, prompt = "", reference?: ModelReference) {
    return (await resolve(category, prompt, reference)).language
  }

  export async function resolve(category: TaskCategory, prompt = "", reference?: ModelReference, sessionID?: string) {
    const selected = await select(category, prompt, reference)
    const session = sessionID ? await import("@/core/session").then(({ Session }) => Session.get(sessionID)) : undefined
    const model = await Provider.getModel(selected.providerID, selected.modelID, { prompt, verify: true, session })
    return { model, language: await Provider.getLanguage(model) }
  }
}
