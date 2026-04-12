import { ModelsDev } from "../models"
import { fromModelsDevModel } from "../logic"
import type { CustomLoader, Info } from "../types"

export const anthropic: CustomLoader = async () => {
    return {
        autoload: false,
        options: {
            headers: {
                "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
            },
        },
    }
}

export const atomcli: CustomLoader = async (input: Info) => {
    if (!input) {
        return {
            autoload: false,
            options: { apiKey: "public" },
        }
    }

    const modelsDev = await ModelsDev.get()
    const atomcli = modelsDev["atomcli"]

    if (!atomcli) return { autoload: false }

    const models = Object.fromEntries(
        Object.entries(atomcli.models).map(([id, model]) => [id, fromModelsDevModel(atomcli, model)]),
    )

    const isThinking = ["kimi-k2-thinking", "glm-4.6"].includes(input.id)

    return {
        autoload: true,
        models,
        options: isThinking ? { chat_template_args: { enable_thinking: true } } : {},
    }
}
