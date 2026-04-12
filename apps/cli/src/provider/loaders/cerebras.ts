import { CustomLoader } from "../types"

export const cerebras: CustomLoader = async () => {
    return {
        autoload: false,
        options: {
            headers: {
                "X-Cerebras-3rd-Party-Integration": "atomcli",
            },
        },
    }
}
