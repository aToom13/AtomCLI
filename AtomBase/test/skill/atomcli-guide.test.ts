import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { ConfigMarkdown } from "@/core/config/markdown"
import { Skill } from "@/integrations/skill"
import { Instance } from "@/services/project/instance"

const repositoryRoot = path.resolve(import.meta.dir, "../../..")
const skillDirectory = path.join(repositoryRoot, ".atomcli/skills/atomcli-guide")
const skillPath = path.join(skillDirectory, "SKILL.md")

describe("bundled AtomCLI guide skill", () => {
  test("has valid discovery metadata and reachable routed references", async () => {
    const markdown = await ConfigMarkdown.parse(skillPath)
    const metadata = Skill.Info.omit({ location: true }).safeParse(markdown.data)

    expect(metadata.success).toBe(true)
    expect(metadata.success && metadata.data.name).toBe("atomcli-guide")
    expect(metadata.success && metadata.data.trigger_words).toContain("atomcli")

    const references = [...markdown.content.matchAll(/\]\((references\/[^)]+)\)/g)].map((match) => match[1]!)
    expect(references.length).toBeGreaterThanOrEqual(7)

    for (const reference of references) {
      expect(await Bun.file(path.join(skillDirectory, reference)).exists()).toBe(true)
    }
  })

  test("is suggested for natural AtomCLI help and development questions", async () => {
    await Instance.provide({
      directory: repositoryRoot,
      fn: async () => {
        const usage = await Skill.findAutoInjectCandidates("AtomCLI'da MCP sunucusunu nasıl eklerim?")
        const development = await Skill.findAutoInjectCandidates("AtomCLI geliştirirken server route ekledim")

        expect(usage.map((skill) => skill.name)).toContain("atomcli-guide")
        expect(development.map((skill) => skill.name)).toContain("atomcli-guide")
      },
    })
  })

  test("keeps contributor guardrails in the development reference", async () => {
    const development = await Bun.file(path.join(skillDirectory, "references/development-and-contributing.md")).text()

    expect(development).toContain("AGENTS.md")
    expect(development).toContain("bun run --conditions=browser ./src/index.ts")
    expect(development).toContain("libs/sdk/js/src/v2/gen")
    expect(development).toContain("automatic companion listeners may select different ports")
    expect(development).toContain("Documentation and bundled guide maintenance")
    expect(development).toContain("Do not update release notes or version metadata")
  })
})
