import { CustomLoader } from "../types"

export const atomcli: CustomLoader = async (input) => {
    if (!input) {
        return {
            autoload: false,
            options: { apiKey: "public" },
        }
    }

    return {
        autoload: false,
        options: {
            apiKey: input.options?.apiKey ?? "public",
            baseURL: input.api ?? "https://api.atomcli.ai/v1",
        },
    }
}
