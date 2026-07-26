import { describe, test, expect } from "bun:test"
import { Skill } from "@/integrations/skill"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Skill Auto-Injection", () => {
  test("Skill.Info parses trigger_words frontmatter", () => {
    const parsed = Skill.Info.safeParse({
      name: "sysadmin",
      description: "Linux administration",
      location: "/path/to/SKILL.md",
      trigger_words: ["sudo", "systemctl", "apt"],
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.trigger_words).toContain("systemctl")
    }
  })

  test("findAutoInjectCandidates filters skills matching trigger words", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const candidates = await Skill.findAutoInjectCandidates("Please install package using apt")
        expect(Array.isArray(candidates)).toBe(true)
      },
    })
  })
})
