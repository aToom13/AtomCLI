import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { ConfigMarkdown } from "@/core/config/markdown"
import { PermissionNext } from "@/util/permission/next"
import { Global } from "@/core/global"

const parameters = z.object({
  action: z
    .enum(["load", "add"])
    .default("load")
    .describe("Action to perform: 'load' an available skill, or 'add' a new skill from a GitHub URL"),
  name: z
    .string()
    .optional()
    .describe(
      "The skill identifier from available_skills to load (for action='load') OR custom skill name (for action='add')",
    ),
  url: z
    .string()
    .optional()
    .describe("GitHub URL to the skill file or directory (required for action='add')"),
})

export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all()

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  const description =
    accessibleSkills.length === 0
      ? "Load or add a skill. Use action='load' to load a skill, or action='add' to install from GitHub."
      : [
          "Load or add specialized skills for specific tasks.",
          "Use action='load' with name to get detailed instructions.",
          "Use action='add' with url to install a new skill from a GitHub repository.",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join(" ")

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.action === "add") {
        if (!params.url) {
          throw new Error("Parameter 'url' is required for action='add'")
        }

        await ctx.ask({
          permission: "skilladd",
          patterns: [params.url],
          always: ["*"],
          metadata: { url: params.url },
        })

        let rawUrl = params.url

        if (rawUrl.includes("github.com") && rawUrl.includes("/blob/")) {
          rawUrl = rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
        }

        if (rawUrl.includes("github.com") && rawUrl.includes("/tree/")) {
          rawUrl = rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/tree/", "/")
        }

        if (!rawUrl.startsWith("http")) {
          rawUrl = `https://raw.githubusercontent.com/${rawUrl}`
        }

        if (!rawUrl.endsWith(".md")) {
          rawUrl = rawUrl.endsWith("/") ? rawUrl + "SKILL.md" : rawUrl + "/SKILL.md"
        }

        const response = await fetch(rawUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch skill: ${response.status} ${response.statusText}. URL: ${rawUrl}`)
        }

        const content = await response.text()
        const parsed = await ConfigMarkdown.parseString(content)
        if (!parsed || !parsed.data.name) {
          throw new Error("Invalid skill file: missing 'name' in frontmatter")
        }

        const rawSkillName = params.name || parsed.data.name
        const sanitizedName = path.basename(rawSkillName)
        const baseSkillsDir = path.join(Global.Path.home, ".atomcli", "skills")
        const skillDir = path.resolve(baseSkillsDir, sanitizedName)

        if (!skillDir.startsWith(baseSkillsDir) || sanitizedName.includes("..") || rawSkillName.includes("..")) {
          throw new Error(`Invalid skill name "${rawSkillName}": path traversal detected`)
        }

        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(path.join(skillDir, "SKILL.md"), content)

        await Skill.reload()

        return {
          title: `Installed skill: ${sanitizedName}`,
          output: [
            `✓ Skill "${sanitizedName}" installed successfully!`,
            ``,
            `Location: ~/.atomcli/skills/${sanitizedName}/SKILL.md`,
            `Description: ${parsed.data.description || "No description"}`,
            ``,
            `The skill is now available. Use \`skill\` tool with action="load", name="${sanitizedName}" to activate it.`,
          ].join("\n"),
          metadata: {
            name: sanitizedName,
            dir: skillDir,
            url: params.url,
            description: parsed.data.description ?? "",
          },
        }
      }

      // action === "load"
      if (!params.name) {
        throw new Error("Parameter 'name' is required for action='load'")
      }

      const skill = await Skill.get(params.name)

      if (!skill) {
        const available = await Skill.all().then((x) => x.map((s) => s.name).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })
      const parsed = await ConfigMarkdown.parse(skill.location)
      const dir = path.dirname(skill.location)

      const output = [`## Skill: ${skill.name}`, "", `**Base directory**: ${dir}`, "", parsed.content.trim()].join("\n")

      return {
        title: `Loaded skill: ${skill.name}`,
        output,
        metadata: {
          name: skill.name,
          dir,
          url: "",
          description: "",
        },
      }
    },
  }
})
