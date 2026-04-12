import path from "path"
import os from "os"
import fs from "fs/promises"
import { ConfigMarkdown } from "../../config/markdown"
import { Instance } from "../../project/instance"
import type { PromptInput } from "./types"

export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    const parts: PromptInput["parts"] = [
        {
            type: "text",
            text: template,
        },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
        files.map(async (match) => {
            const name = match[1]
            if (seen.has(name)) return
            seen.add(name)
            const filepath = name.startsWith("~/")
                ? path.join(os.homedir(), name.slice(2))
                : path.resolve(Instance.worktree, name)

            const stats = await fs.stat(filepath).catch(() => undefined)
            if (stats?.isFile()) {
                parts.push({
                    type: "file",
                    url: "file:" + filepath,
                    mime: "text/plain",
                    filename: name,
                })
            }
        }),
    )
    return parts
}
