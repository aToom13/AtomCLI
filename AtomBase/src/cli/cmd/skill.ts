import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Skill } from "../../skill"
import { ConfigMarkdown } from "../../config/markdown"
import { Instance } from "../../project/instance"
import { Global } from "../../global"
import path from "path"
import fs from "fs/promises"

export const SkillCommand = cmd({
    command: "skill",
    describe: "manage skills",
    builder: (yargs) =>
        yargs
            .command(SkillListCommand)
            .command(SkillShowCommand)
            .command(SkillAddCommand)
            .command(SkillRemoveCommand)
            .demandCommand(),
    async handler() { },
})

export const SkillListCommand = cmd({
    command: "list",
    aliases: ["ls"],
    describe: "list available skills",
    async handler() {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("Available Skills")

                const skills = await Skill.all()

                if (skills.length === 0) {
                    prompts.log.warn("No skills found")
                    prompts.outro("Add skills to .atomcli/skills/ or ~/.atomcli/skills/")
                    return
                }

                for (const skill of skills) {
                    const location = skill.location.replace(Global.Path.home, "~")
                    prompts.log.info(`${skill.name}`)
                    console.log(`   ${skill.description}`)
                    console.log(`   📁 ${location}`)
                    console.log()
                }

                prompts.outro(`Found ${skills.length} skill(s)`)
            },
        })
    },
})

export const SkillShowCommand = cmd({
    command: "show <name>",
    describe: "show skill content",
    builder: (yargs) =>
        yargs.positional("name", {
            type: "string",
            describe: "skill name",
            demandOption: true,
        }),
    async handler(args) {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()

                const skill = await Skill.get(args.name)

                if (!skill) {
                    prompts.intro(`Skill: ${args.name}`)
                    prompts.log.error(`Skill "${args.name}" not found`)
                    const available = await Skill.all()
                    if (available.length > 0) {
                        prompts.log.info(`Available skills: ${available.map((s) => s.name).join(", ")}`)
                    }
                    prompts.outro("")
                    return
                }

                prompts.intro(`Skill: ${skill.name}`)
                prompts.log.info(`Description: ${skill.description}`)
                prompts.log.info(`Location: ${skill.location.replace(Global.Path.home, "~")}`)
                console.log()

                const parsed = await ConfigMarkdown.parse(skill.location)
                console.log(parsed.content)

                prompts.outro("")
            },
        })
    },
})

export const SkillAddCommand = cmd({
    command: "add <url>",
    describe: "add a skill from a GitHub URL",
    builder: (yargs) =>
        yargs
            .positional("url", {
                type: "string",
                describe: "GitHub raw URL or repository path (e.g., user/repo/path/to/SKILL.md)",
                demandOption: true,
            })
            .option("name", {
                type: "string",
                describe: "skill name (defaults to directory name from URL)",
            }),
    async handler(args) {
        UI.empty()
        prompts.intro("Add Skill")

        let rawUrl = args.url

        // Convert GitHub blob URL to raw URL
        if (rawUrl.includes("github.com") && rawUrl.includes("/blob/")) {
            rawUrl = rawUrl
                .replace("github.com", "raw.githubusercontent.com")
                .replace("/blob/", "/")
        }

        // If it's a short form like user/repo/path, construct full URL
        if (!rawUrl.startsWith("http")) {
            rawUrl = `https://raw.githubusercontent.com/${rawUrl}`
        }

        // If no file extension, assume SKILL.md
        if (!rawUrl.endsWith(".md")) {
            rawUrl = rawUrl.endsWith("/") ? rawUrl + "SKILL.md" : rawUrl + "/SKILL.md"
        }

        const spinner = prompts.spinner()
        spinner.start(`Fetching ${rawUrl}`)

        try {
            const response = await fetch(rawUrl)
            if (!response.ok) {
                spinner.stop(`Failed to fetch: ${response.status} ${response.statusText}`)
                prompts.outro("")
                return
            }

            const content = await response.text()

            // Parse to extract name
            const parsed = await ConfigMarkdown.parseString(content)
            if (!parsed || !parsed.data.name) {
                spinner.stop("Invalid SKILL.md: missing name in frontmatter")
                prompts.outro("")
                return
            }

            const skillName = args.name || parsed.data.name
            const skillDir = path.join(Global.Path.home, ".atomcli", "skills", skillName)

            await fs.mkdir(skillDir, { recursive: true })
            await fs.writeFile(path.join(skillDir, "SKILL.md"), content)

            spinner.stop(`Skill "${skillName}" installed to ~/.atomcli/skills/${skillName}/`)
            prompts.outro("Run `atomcli skill list` to see all skills")
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            spinner.stop(`Error: ${message}`)
            prompts.outro("")
        }
    },
})

export const SkillRemoveCommand = cmd({
    command: "remove <name>",
    aliases: ["rm"],
    describe: "remove a skill",
    builder: (yargs) =>
        yargs.positional("name", {
            type: "string",
            describe: "skill name to remove",
            demandOption: true,
        }),
    async handler(args) {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("Remove Skill")

                const skill = await Skill.get(args.name)

                if (!skill) {
                    prompts.log.error(`Skill "${args.name}" not found`)
                    const available = await Skill.all()
                    if (available.length > 0) {
                        prompts.log.info(`Available skills: ${available.map((s) => s.name).join(", ")}`)
                    }
                    prompts.outro("")
                    return
                }

                const skillDir = path.dirname(skill.location)

                try {
                    await fs.rm(skillDir, { recursive: true, force: true })
                    prompts.log.success(`Removed skill "${args.name}" from ${skillDir.replace(Global.Path.home, "~")}`)
                    prompts.outro("Done")
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    prompts.log.error(`Failed to remove skill: ${message}`)
                    prompts.outro("")
                }
            },
        })
    },
})

