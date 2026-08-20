import { Provider } from "@/integrations/provider/provider"
import { selectModel, type TaskCategory } from "@/integrations/tool/model-router"

export namespace ModelPurpose {
  export async function select(category: TaskCategory, prompt = "") {
    const fallback = await Provider.defaultModel()
    return selectModel(category, fallback, "balanced", 0, undefined, prompt)
  }

  export async function language(category: TaskCategory, prompt = "") {
    const selected = await select(category, prompt)
    const model = await Provider.getModel(selected.providerID, selected.modelID)
    return Provider.getLanguage(model)
  }
}
