import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { ConfigMarkdown } from "@/core/config/markdown"
import { PermissionNext } from "@/util/permission/next"
import { SkillInstaller } from "../skill/installer"

const parameters = z.object({
  action: z
    .enum(["load", "add"])
    .default("load")
    .describe("Action to perform: 'load' an available skill, or 'add' a new skill from a GitHub URL"),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The skill identifier from available_skills to load (for action='load') OR custom skill name (for action='add')",
    ),
  url: z
    .string()
    .max(8192)
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
          always: [params.url],
          metadata: { url: params.url },
        })

        const installed = await SkillInstaller.install({ url: params.url, name: params.name, signal: ctx.abort })

        await Skill.reload()

        return {
          title: `Installed skill: ${installed.name}`,
          output: [
            `✓ Skill "${installed.name}" installed successfully!`,
            ``,
            `Location: ${installed.target}`,
            `Description: ${installed.description || "No description"}`,
            ``,
            `The skill is now available. Use \`skill\` tool with action="load", name="${installed.name}" to activate it.`,
          ].join("\n"),
          metadata: {
            name: installed.name,
            dir: installed.directory,
            url: params.url,
            description: installed.description,
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
