import type { APICallError } from "ai"

export function error(providerID: string, error: APICallError) {
    let message = error.message
    if (providerID === "github-copilot" && message.includes("The requested model is not supported")) {
        return (
            message +
            "\n\nMake sure the model is enabled in your copilot settings: https://github.com/settings/copilot/features"
        )
    }

    return message
}
