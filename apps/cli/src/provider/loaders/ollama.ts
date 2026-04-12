import { detectOllama, toProviderModels } from "../ollama"
import type { CustomLoader } from "../types"

export const ollama: CustomLoader = async () => {
    const { models } = await detectOllama()
    return {
        autoload: models.length > 0,
        models: toProviderModels(models),
    }
}
