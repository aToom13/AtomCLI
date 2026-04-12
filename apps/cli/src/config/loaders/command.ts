import path from "path"
import { Schemas } from "../schemas"
import { InvalidError } from "../errors"
import { ConfigMarkdown } from "../markdown"

const COMMAND_GLOB = new Bun.Glob("{command,commands}/**/*.md")

export async function loadCommand(dir: string) {
    const result: Record<string, Schemas.Command> = {}
    for await (const item of COMMAND_GLOB.scan({
        absolute: true,
        followSymlinks: true,
        dot: true,
        cwd: dir,
    })) {
        const md = await ConfigMarkdown.parse(item)
        if (!md.data) continue

        const name = (() => {
            const patterns = ["/.atomcli/command/", "/command/"]
            const pattern = patterns.find((p) => item.includes(p))

            if (pattern) {
                const index = item.indexOf(pattern)
                return item.slice(index + pattern.length, -3)
            }
            return path.basename(item, ".md")
        })()

        const config = {
            name,
            ...md.data,
            template: md.content.trim(),
        }
        const parsed = Schemas.Command.safeParse(config)
        if (parsed.success) {
            result[config.name] = parsed.data
            continue
        }
        throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
}
