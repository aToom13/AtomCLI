import path from "path"
import { Schemas } from "../schemas"
import { InvalidError } from "../errors"
import { ConfigMarkdown } from "../markdown"

const AGENT_GLOB = new Bun.Glob("{agent,agents}/**/*.md")

export async function loadAgent(dir: string) {
    const result: Record<string, Schemas.Agent> = {}

    for await (const item of AGENT_GLOB.scan({
        absolute: true,
        followSymlinks: true,
        dot: true,
        cwd: dir,
    })) {
        const md = await ConfigMarkdown.parse(item)
        if (!md.data) continue

        // Extract relative path from agent folder for nested agents
        let agentName = path.basename(item, ".md")
        const agentFolderPath = item.includes("/.atomcli/agent/")
            ? item.split("/.atomcli/agent/")[1]
            : item.includes("/agent/")
                ? item.split("/agent/")[1]
                : agentName + ".md"

        // If agent is in a subfolder, include folder path in name
        if (agentFolderPath.includes("/")) {
            const relativePath = agentFolderPath.replace(".md", "")
            const pathParts = relativePath.split("/")
            agentName = pathParts.slice(0, -1).join("/") + "/" + pathParts[pathParts.length - 1]
        }

        const config = {
            name: agentName,
            ...md.data,
            prompt: md.content.trim(),
        }
        const parsed = Schemas.Agent.safeParse(config)
        if (parsed.success) {
            result[config.name] = parsed.data
            continue
        }
        throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
}

const MODE_GLOB = new Bun.Glob("{mode,modes}/*.md")

export async function loadMode(dir: string) {
    const result: Record<string, Schemas.Agent> = {}
    for await (const item of MODE_GLOB.scan({
        absolute: true,
        followSymlinks: true,
        dot: true,
        cwd: dir,
    })) {
        const md = await ConfigMarkdown.parse(item)
        if (!md.data) continue

        const config = {
            name: path.basename(item, ".md"),
            ...md.data,
            prompt: md.content.trim(),
        }
        const parsed = Schemas.Agent.safeParse(config)
        if (parsed.success) {
            result[config.name] = {
                ...parsed.data,
                mode: "primary" as const,
            }
            continue
        }
    }
    return result
}
