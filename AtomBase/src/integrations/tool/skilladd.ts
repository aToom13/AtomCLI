import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import { Global } from "@/core/global"
import { ConfigMarkdown } from "@/core/config/markdown"

const parameters = z.object({
    url: z
        .string()
        .describe(
            "GitHub URL to the skill file. Can be a blob URL (github.com/.../blob/...) or raw URL. If pointing to a directory, SKILL.md will be appended automatically.",
        ),
    name: z.string().optional().describe("Custom name for the skill. If not provided, uses the name from SKILL.md frontmatter."),
})

export const SkillAddTool = Tool.define("skilladd", {
    description: [
        "Install a new skill from a GitHub URL.",
        "Use this when the user wants to add a skill from a GitHub repository.",
        "The skill will be downloaded and saved to ~/.atomcli/skills/",
        "Example URLs:",
        "  - https://github.com/user/repo/blob/main/skills/my-skill/SKILL.md",
        "  - https://github.com/user/repo/tree/main/skills/my-skill (SKILL.md appended)",
        "  - https://raw.githubusercontent.com/user/repo/main/skills/my-skill/SKILL.md",
    ].join("\n"),
    parameters,
    async execute(params, ctx) {
        await ctx.ask({
            permission: "skilladd",
            patterns: [params.url],
            always: ["*"],
            metadata: { url: params.url },
        })

        let rawUrl = params.url

        // Convert GitHub blob URL to raw URL
        if (rawUrl.includes("github.com") && rawUrl.includes("/blob/")) {
            rawUrl = rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
        }

        // Convert GitHub tree URL to raw URL (for directory links)
        if (rawUrl.includes("github.com") && rawUrl.includes("/tree/")) {
            rawUrl = rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/tree/", "/")
        }

        // If it's a short form like user/repo/path, construct full URL
        if (!rawUrl.startsWith("http")) {
            rawUrl = `https://raw.githubusercontent.com/${rawUrl}`
        }

        // If no file extension, assume SKILL.md
        if (!rawUrl.endsWith(".md")) {
            rawUrl = rawUrl.endsWith("/") ? rawUrl + "SKILL.md" : rawUrl + "/SKILL.md"
        }

        // Fetch the skill content
        const response = await fetch(rawUrl)
        if (!response.ok) {
            throw new Error(`Failed to fetch skill: ${response.status} ${response.statusText}. URL: ${rawUrl}`)
        }

        const content = await response.text()

        // Parse to extract name
        const parsed = await ConfigMarkdown.parseString(content)
        if (!parsed || !parsed.data.name) {
            throw new Error("Invalid skill file: missing 'name' in frontmatter")
        }

        const skillName = params.name || parsed.data.name
        const skillDir = path.join(Global.Path.home, ".atomcli", "skills", skillName)

        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(path.join(skillDir, "SKILL.md"), content)

        return {
            title: `Installed skill: ${skillName}`,
            output: [
                `✓ Skill "${skillName}" installed successfully!`,
                ``,
                `Location: ~/.atomcli/skills/${skillName}/SKILL.md`,
                `Description: ${parsed.data.description || "No description"}`,
                ``,
                `The skill is now available. Use \`skill\` tool with name="${skillName}" to activate it.`,
            ].join("\n"),
            metadata: {
                name: skillName,
                url: params.url,
                description: parsed.data.description,
            },
        }
    },
})
