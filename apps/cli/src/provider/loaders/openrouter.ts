import { CustomLoader } from "../types"

export const openrouter: CustomLoader = async () => {
    return {
        autoload: false,
        options: {
            headers: {
                "HTTP-Referer": "https://atomcli.ai/",
                "X-Title": "atomcli",
            },
        },
    }
}
