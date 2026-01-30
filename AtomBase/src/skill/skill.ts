import z from "zod"
import path from "path"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@atomcli/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { exists } from "fs/promises"
import { Flag } from "@/flag/flag"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  const ATOMCLI_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const CLAUDE_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match)
      if (!md) {
        return
      }

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return

      // Warn on duplicate skill names
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
      }
    }

    // Scan .atomcli/skills/ and .claude/skills/ directories (project-level)
    // .atomcli is primary, .claude is fallback for backward compatibility
    const skillDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".atomcli", ".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    // Also include global ~/.atomcli/skills/ and ~/.claude/skills/ (fallback)
    const globalAtom = Global.Path.skills  // ~/.atomcli/skills/
    const globalClaude = `${Global.Path.home}/.claude`
    if (await exists(globalAtom)) {
      skillDirs.push(path.dirname(globalAtom))  // Add ~/.atomcli/ to scan for skills subdir
    }
    if (await exists(globalClaude)) {
      skillDirs.push(globalClaude)
    }

    // Add bundled skills from installation directory
    if (Flag.ATOMCLI_INSTALL_DIR) {
      const installAtom = `${Flag.ATOMCLI_INSTALL_DIR}/.atomcli`
      if (await exists(installAtom)) skillDirs.push(installAtom)

      const installClaude = `${Flag.ATOMCLI_INSTALL_DIR}/.claude`
      if (await exists(installClaude)) skillDirs.push(installClaude)
    } else {
      // Fallback for compiled binary: check relative to executable
      try {
        // Binary is likely in bin/atomcli, so look in root of distro (../)
        const binaryDir = path.dirname(process.execPath)
        const distRoot = path.resolve(binaryDir, "..")

        const bundledAtom = path.join(distRoot, ".atomcli")
        if (await exists(bundledAtom)) skillDirs.push(bundledAtom)

        const bundledClaude = path.join(distRoot, ".claude")
        if (await exists(bundledClaude)) skillDirs.push(bundledClaude)
      } catch (e) {
        // ignore
      }
    }

    if (!Flag.ATOMCLI_DISABLE_CLAUDE_CODE_SKILLS) {
      for (const dir of skillDirs) {
        const matches = await Array.fromAsync(
          CLAUDE_SKILL_GLOB.scan({
            cwd: dir,
            absolute: true,
            onlyFiles: true,
            followSymlinks: true,
            dot: true,
          }),
        ).catch((error) => {
          log.error("failed directory scan for skills", { dir, error })
          return []
        })

        for (const match of matches) {
          await addSkill(match)
        }
      }
    }

    // Scan .atomcli/skill/ directories
    for (const dir of (await Config.state()).directories) {
      for await (const match of ATOMCLI_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    return skills
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x))
  }
}
