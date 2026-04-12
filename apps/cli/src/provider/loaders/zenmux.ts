import { CustomLoader } from "../types"

export const zenmux: CustomLoader = async () => {
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
