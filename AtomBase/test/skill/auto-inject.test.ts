import "../preload"
import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Skill } from "@/integrations/skill"
import { createUserMessage } from "@/core/session/prompt/user-message"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SystemPrompt } from "@/core/session/system"

describe("Skill Auto-Injection", () => {
  test("explicit child-reference requests preload reference material", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, ".atomcli", "skills", "reference-skill", "references"), { recursive: true })
    await Bun.write(
      path.join(tmp.path, ".atomcli", "skills", "reference-skill", "SKILL.md"),
      "---\nname: reference-skill\ndescription: Reference test\ntrigger_words: [reference task]\n---\n# Root",
    )
    await Bun.write(
      path.join(tmp.path, ".atomcli", "skills", "reference-skill", "references", "details.md"),
      "# Child guidance\nUse the bounded workflow.",
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const context = await SystemPrompt.autoInjectSkills("reference task: alt başlıklarını oku")
        expect(context).toContain("reference-skill/references/details.md")
        expect(context).toContain("Use the bounded workflow.")
      },
    })
  })

  test("an explicit @skill mention reaches the model without replacing user text", async () => {
    await using tmp = await tmpdir({ git: true })
    const source = path.join(import.meta.dir, "../../../.atomcli/skills/frontend-design/SKILL.md")
    await Bun.write(
      path.join(tmp.path, ".atomcli", "skills", "frontend-design", "SKILL.md"),
      await Bun.file(source).text(),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await createUserMessage(
          {
            sessionID: session.id,
            agent: "build",
            model: { providerID: "test", modelID: "fixture" },
            parts: [{ type: "text", text: "@frontend-design Sayfa tasarla" }],
          },
          { lastModel: async () => ({ providerID: "test", modelID: "fixture" }) },
        )
        expect(message.parts[0]).toMatchObject({ type: "text", text: "@frontend-design Sayfa tasarla" })
        expect(message.parts[1]).toMatchObject({ type: "text", synthetic: true })
        expect((message.parts[1] as MessageV2.TextPart).text).toContain("# Frontend design")
        expect(JSON.stringify(await MessageV2.toModelMessage([message], "test"))).toContain("# Frontend design")
      },
    })
  })

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

  test("web testing suggestion stays out of ordinary unit test work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, ".atomcli", "skills", "webapp-testing", "SKILL.md"),
      "---\nname: Webapp Testing\ndescription: Browser tests.\ntrigger_words: [playwright, browser test, web app testing]\n---\n",
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          (await Skill.findAutoInjectCandidates("Fix failing unit test in AtomCLI")).map((skill) => skill.name),
        ).not.toContain("Webapp Testing")
        expect(
          (await Skill.findAutoInjectCandidates("Add browser test with Playwright")).map((skill) => skill.name),
        ).toContain("Webapp Testing")
      },
    })
  })

  test("bundled game guidance matches game requests without matching CAD work", async () => {
    await using tmp = await tmpdir({ git: true })
    const source = path.join(import.meta.dir, "../../../.atomcli/skills/game-development/SKILL.md")
    await Bun.write(
      path.join(tmp.path, ".atomcli", "skills", "game-development", "SKILL.md"),
      await Bun.file(source).text(),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          (await Skill.findAutoInjectCandidates("Create a 3D skateboarding game")).map((skill) => skill.name),
        ).toContain("game-development")
        expect((await Skill.findAutoInjectCandidates("Make a 3D CAD model")).map((skill) => skill.name)).not.toContain(
          "game-development",
        )
        expect(
          (await Skill.findAutoInjectCandidates("game design skill alt başlıklarını oku")).map((skill) => skill.name),
        ).toContain("game-development")
      },
    })
  })

  test("bundled document guidance avoids ordinary README work", async () => {
    await using tmp = await tmpdir({ git: true })
    const source = path.join(import.meta.dir, "../../../.atomcli/skills/document-suite/SKILL.md")
    await Bun.write(
      path.join(tmp.path, ".atomcli", "skills", "document-suite", "SKILL.md"),
      await Bun.file(source).text(),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Skill.findAutoInjectCandidates("Read project README")).map((skill) => skill.name)).not.toContain(
          "Document Suite",
        )
        expect((await Skill.findAutoInjectCandidates("Extract tables from PDF")).map((skill) => skill.name)).toContain(
          "Document Suite",
        )
      },
    })
  })

  test("specific trigger phrases rank ahead of generic matches", async () => {
    await using tmp = await tmpdir({ git: true })
    for (const [name, trigger] of [
      ["generic-linux", "linux"],
      ["server-hardening", "linux server hardening"],
      ["generic-server", "server"],
      ["generic-security", "security"],
    ]) {
      await Bun.write(
        path.join(tmp.path, ".atomcli", "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name}.\ntrigger_words: [${trigger}]\n---\n`,
      )
    }
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const names = (await Skill.findAutoInjectCandidates("linux server hardening security")).map(
          (skill) => skill.name,
        )
        expect(names.indexOf("server-hardening")).toBeLessThan(names.indexOf("generic-linux"))
        expect(names.indexOf("server-hardening")).toBeLessThan(names.indexOf("generic-server"))
      },
    })
  })
})
