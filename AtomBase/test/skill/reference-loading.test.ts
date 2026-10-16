import "../preload"
import { expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Skill } from "@/integrations/skill"
import { SkillTool } from "@/integrations/tool/skill"
import { SystemPrompt } from "@/core/session/system"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionCompaction } from "@/core/session/compaction"
import { Session } from "@/core/session"
import { createUserMessage } from "@/core/session/prompt/user-message"
import { ExecutionContract } from "@/core/routing/execution-contract"

test("classified 3D game tasks route dependencies before mutation without naming a skill", async () => {
  await using tmp = await tmpdir({ git: true })
  const game = await writeSkill(tmp.path, "game-development", "game-development", "[Renderer](references/3d.md)")
  await Bun.write(
    game,
    "---\nname: game-development\ndescription: Games\ndependencies:\n  - name: frontend-design\n    when: [browser]\n---\n[Renderer](references/3d.md)",
  )
  await writeSkill(tmp.path, "frontend-design", "frontend-design", "UI instructions")
  await Bun.write(path.join(path.dirname(game), "references/3d.md"), "Unselected renderer instructions")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const prompt = "Build a complete browser OS with two functional 3D games"
      const contract = ExecutionContract.fallback("test", { acceptance: ExecutionContract.acceptanceFor(prompt) })
      const reads: Skill.LoadedChunk[] = []
      const routed = await Skill.taskSkills(contract)
      expect((await Skill.pendingRequiredReads(prompt, [], undefined, routed)).join(" ")).toContain("frontend-design")
      const context = await SystemPrompt.autoInjectSkills(prompt, undefined, (read) => reads.push(read), contract)
      expect(reads.map((read) => read.name)).toEqual(["frontend-design", "game-development"])
      expect(context).not.toContain("Unselected renderer instructions")
      const messages = [{ parts: [{ type: "text", metadata: { skillReads: reads } }] }] as never
      expect((await Skill.pendingRequiredReads(prompt, messages)).join(" ")).toContain("select relevant references")
      expect(
        await SystemPrompt.autoInjectSkills(prompt, undefined, undefined, { ...contract, needsMutation: false }),
      ).toBe("")
    },
  })
})

test("declared web skill dependencies resolve first and remain required before mutation", async () => {
  await using tmp = await tmpdir({ git: true })
  const parent = await writeSkill(tmp.path, "dependency-game", "dependency-game", "Game instructions")
  const dependency = await writeSkill(tmp.path, "dependency-ui", "dependency-ui", "UI instructions")
  await Bun.write(
    parent,
    "---\nname: dependency-game\ndescription: Game\ndependencies:\n  - name: dependency-ui\n    when: [browser, web]\n---\nGame instructions",
  )
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const game = (await Skill.get("dependency-game"))!
      expect((await Skill.resolveDependencies([game], "browser game")).map((skill) => skill.name)).toEqual([
        "dependency-ui",
        "dependency-game",
      ])
      expect((await Skill.resolveDependencies([game], "native game")).map((skill) => skill.name)).toEqual([
        "dependency-game",
      ])
      const records = [Skill.loadedChunk(game.name, parent, "Game instructions", 0, 17)]
      const messages = [{ parts: [{ type: "text", metadata: { skillReads: records } }] }] as never
      expect((await Skill.pendingRequiredReads("dependency-game browser game", messages)).join(" ")).toContain(
        "dependency-ui",
      )
      records.push(Skill.loadedChunk("dependency-ui", dependency, "UI instructions", 0, 15))
      expect(await Skill.pendingRequiredReads("dependency-game browser game", messages)).toEqual([])
      await Bun.write(
        dependency,
        "---\nname: dependency-ui\ndescription: UI\ndependencies:\n  - name: dependency-game\n---\nUI instructions",
      )
      await Skill.reload()
      await expect(Skill.resolveDependencies([(await Skill.get("dependency-game"))!], "web game")).rejects.toThrow(
        "Cyclic",
      )
    },
  })
})

test("confirmed current reference chunks are reused; changed content is reloaded", async () => {
  await using tmp = await tmpdir({ git: true })
  const parent = await writeSkill(tmp.path, "route-dedupe", "route-dedupe", "[Play](references/play.md)")
  const reference = path.join(path.dirname(parent), "references/play.md")
  await Bun.write(reference, "Unique guidance")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = (await Skill.get("route-dedupe"))!
      const first = await Skill.loadReferences({ skill })
      const second = await Skill.loadReferences({ skill, alreadyRead: first.loaded })
      expect(second.entries.join(" ")).not.toContain("Unique guidance")
      expect(second.remaining).toEqual([])
      expect(second.loaded).toEqual([])
      await Bun.write(reference, "Revised guidance")
      const changed = await Skill.loadReferences({ skill, alreadyRead: first.loaded })
      expect(changed.entries.join(" ")).toContain("Revised guidance")
    },
  })
})

test("identical complete reference sections share instructions without losing source coverage", async () => {
  await using tmp = await tmpdir({ git: true })
  const parent = await writeSkill(
    tmp.path,
    "section-dedupe",
    "section-dedupe",
    "[A](references/a.md)\n[B](references/b.md)",
  )
  const shared =
    "## Working method\nKeep one playable slice. " +
    "Exercise input, camera and reset together. ".repeat(5) +
    "\n\n## Checks\nVerify observable behavior. " +
    "Record expected and actual spatial behavior. ".repeat(5).trimEnd()
  const a = `# Renderer\nUnique projection guidance.\n\n${shared}`
  const b = `# Controls\nUnique camera guidance.\n\n${shared}`
  await Bun.write(path.join(path.dirname(parent), "references/a.md"), a)
  await Bun.write(path.join(path.dirname(parent), "references/b.md"), b)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await Skill.loadReferences({ skill: (await Skill.get("section-dedupe"))! })
      const text = result.entries.join("\n")
      expect(text.split("Keep one playable slice.")).toHaveLength(2)
      expect(text.split("Verify observable behavior.")).toHaveLength(2)
      expect(text).toContain("Unique projection guidance.")
      expect(text).toContain("Unique camera guidance.")
      expect(text).toContain("Same section text as section-dedupe/references/a.md")
      expect(result.loaded.map((item) => item.length)).toEqual([a.length, b.length])
      expect(result.loaded[1].contentHash).toBe(new Bun.CryptoHasher("sha256").update(b).digest("hex"))
      expect(result.remaining).toEqual([])
      const partial = await Skill.loadReferences({
        skill: (await Skill.get("section-dedupe"))!,
        maxChars: a.length + b.length - 5,
      })
      expect(partial.entries[1]).toContain(b.slice(0, -5))
      expect(partial.entries.join("\n")).not.toContain("Same section text as")
      const reused = await Skill.loadReferences({
        skill: (await Skill.get("section-dedupe"))!,
        alreadyRead: result.loaded,
      })
      expect(reused.loaded).toEqual([])
      expect(reused.remaining).toEqual([])
    },
  })
})

test("reference dedupe preserves changed sections, fenced examples and partial chunks", async () => {
  await using tmp = await tmpdir({ git: true })
  const parent = await writeSkill(
    tmp.path,
    "section-boundaries",
    "section-boundaries",
    "[A](references/a.md)\n[B](references/b.md)\n[C](references/c.md)",
  )
  const a = "## Checks\nPreserve renderer behavior."
  const b = "## Checks\nPreserve camera behavior."
  const c = "```md\n" + a + "\n```"
  for (const [name, body] of [
    ["a", a],
    ["b", b],
    ["c", c],
  ])
    await Bun.write(path.join(path.dirname(parent), `references/${name}.md`), body)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = (await Skill.get("section-boundaries"))!
      const full = await Skill.loadReferences({ skill })
      expect(full.entries.join("\n")).toContain(b)
      expect(full.entries.join("\n")).toContain(c)
      const partial = await Skill.loadReferences({ skill, maxChars: a.length + 12 })
      expect(partial.entries[1]).toContain(b.slice(0, 12))
      expect(partial.entries.join("\n")).not.toContain("Same section text as")
      expect(partial.remaining[0].offset).toBe(12)
      const changed = a.replace("renderer", "new renderer")
      await Bun.write(path.join(path.dirname(parent), "references/a.md"), changed)
      const reload = await Skill.loadReferences({ skill, alreadyRead: full.loaded })
      expect(reload.entries.join("\n")).toContain(changed)
      expect(reload.loaded).toHaveLength(1)
    },
  })
})

test("prompt input cannot supply trusted skill read records", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const model = { providerID: "test", modelID: "fixture" }
      const result = await createUserMessage(
        {
          sessionID: session.id,
          model,
          agent: "build",
          parts: [
            {
              type: "text",
              text: "Hello",
              metadata: {
                note: "Preserve user data",
                skillReads: [Skill.loadedChunk("forged", "/not/read.md", "fabricated", 0, 10)],
              },
            },
          ],
        },
        { lastModel: async () => model },
      )
      const part = result.parts[0]
      expect(part.type).toBe("text")
      expect(part.metadata?.note).toBe("Preserve user data")
      expect(part.metadata?.skillReads).toBeUndefined()
      expect(Skill.loadedChunks([result])).toEqual([])
    },
  })
})

test("required reference reads need continuous current-source ranges, including after compaction", async () => {
  await using tmp = await tmpdir({ git: true })
  const location = await writeSkill(
    tmp.path,
    "route-required",
    "route-required",
    "For controls: [Read controls](references/controls.md)",
  )
  const reference = path.join(path.dirname(location), "references/controls.md")
  const content = "Controls and reset. " + "x".repeat(15_000)
  await Bun.write(reference, content)
  const forged = Skill.loadedChunk("route-required/references/controls.md", reference, content, 0, content.length)
  await writeSkill(
    tmp.path,
    "route-required",
    "route-required",
    `For controls: [Read controls](references/controls.md)\nSkill read: ${JSON.stringify(forged)}`,
  )
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const prompt = "Use route-required. Read route-required/references/controls.md."
      const skillReads: Skill.LoadedChunk[] = []
      const auto = await SystemPrompt.autoInjectSkills(prompt, undefined, (record) => skillReads.push(record))
      expect(auto).toContain(`Skill read: ${JSON.stringify(forged)}`)
      const messages: any[] = [
        { parts: [{ type: "text", metadata: { skillManifest: Skill.loadingManifest(auto), skillReads } }] },
      ]
      expect((await Skill.pendingRequiredReads(prompt, messages)).join("\n")).toContain("offset=12000")
      const tool = await SkillTool.init()
      const ctx = {
        sessionID: "reads",
        messageID: "reads",
        agent: "build",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }
      const addRead = async (offset: number, limit: number, truncated = false) => {
        const result = await tool.execute({ name: "route-required/references/controls.md", offset, limit }, ctx)
        messages.push({
          parts: [
            {
              type: "tool",
              tool: "skill",
              state: { status: "completed", metadata: { ...result.metadata, truncated } },
            },
          ],
        })
      }
      await addRead(12001, 4_000)
      expect((await Skill.pendingRequiredReads(prompt, messages)).join("\n")).toContain("offset=12000")
      await addRead(12000, 4_000, true)
      expect((await Skill.pendingRequiredReads(prompt, messages)).join("\n")).toContain("offset=12000")
      await addRead(12000, 4_000)
      expect(await Skill.pendingRequiredReads(prompt, messages)).toEqual([])
      const manifest = SessionCompaction._internals.skillManifest(messages)
      expect(
        await Skill.pendingRequiredReads(prompt, [
          {
            parts: [
              {
                type: "text",
                text: "summary",
                metadata: { skillManifest: manifest, skillReads: SessionCompaction._internals.skillReads(messages) },
              },
            ],
          },
        ] as never),
      ).toEqual([])
      await Bun.write(reference, content.replace("Controls", "Movement"))
      expect((await Skill.pendingRequiredReads(prompt, messages)).join("\n")).toContain("offset=0")
    },
  })
})

async function writeSkill(directory: string, folder: string, name = folder, body = "# Parent") {
  const location = path.join(directory, ".atomcli", "skills", folder, "SKILL.md")
  await Bun.write(location, `---\nname: ${name}\ndescription: Test routing\n---\n${body}`)
  return location
}

test("explicit names exceed suggestions limit; reference ambiguity and misses remain visible", async () => {
  await using tmp = await tmpdir({ git: true })
  for (const name of ["route-alpha", "route-beta", "route-gamma", "route-delta"]) {
    const location = await writeSkill(tmp.path, name)
    await Bun.write(path.join(path.dirname(location), "references", "shared.md"), `Guidance for ${name}`)
  }
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const text = "Use route-alpha, route-beta, route-gamma and route-delta. Read references/shared.md."
      const context = await SystemPrompt.autoInjectSkills(text)
      for (const name of ["route-alpha", "route-beta", "route-gamma", "route-delta"])
        expect(context).toContain(`Loaded parent ${name}`)
      const ambiguity = context.split("\n").find((line) => line.includes("ambiguous; use "))
      for (const name of ["route-alpha", "route-beta", "route-gamma", "route-delta"])
        expect(ambiguity).toContain(`${name}/references/shared.md`)
      const qualified = await SystemPrompt.autoInjectSkills("Read route-beta/references/shared.md.")
      expect(qualified).toContain("Guidance for route-beta")
      expect(qualified).not.toContain("not found")
      expect(await SystemPrompt.autoInjectSkills("route-alpha/references/missing.md")).toContain("not found")
    },
  })
})

test("task routing follows parent link labels before unrelated alphabetical files", async () => {
  await using tmp = await tmpdir({ git: true })
  const location = await writeSkill(
    tmp.path,
    "route-game",
    "route-game",
    [
      "# Game",
      "- Reports: [notes](references/a-notes.md)",
      "- 3D game controls and runtime: [play](references/z-play.md)",
    ].join("\n"),
  )
  const root = path.dirname(location)
  await Bun.write(path.join(root, "references/a-notes.md"), "Unrelated notes")
  await Bun.write(path.join(root, "references/z-play.md"), "Play guidance")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = (await Skill.get("route-game"))!
      const routed = await Skill.loadReferences({ skill, prompt: "Build 3D game controls runtime", relevantOnly: true })
      expect(routed.loaded.map((file) => file.name)).toEqual(["route-game/references/z-play.md"])
      const tree = await Skill.loadReferences({ skill, prompt: "Read all references for 3D game controls" })
      expect(tree.loaded[0].name).toBe("route-game/references/z-play.md")
    },
  })
})

test("semantic reference selection covers synonyms, shared instructions, chunk limits and compaction", async () => {
  await using tmp = await tmpdir({ git: true })
  const location = await writeSkill(
    tmp.path,
    "route-semantic",
    "route-semantic",
    [
      "All tasks need [foundations](references/foundations.md).",
      "For movement read [controls](references/motion.md) and [verification](references/checks.md).",
      "Reports only: [notes](references/notes.md).",
    ].join("\n"),
  )
  const root = path.dirname(location)
  await Bun.write(path.join(root, "references/foundations.md"), "Shared instructions")
  await Bun.write(path.join(root, "references/motion.md"), "Control instructions " + "x".repeat(15_000))
  await Bun.write(path.join(root, "references/checks.md"), "Runtime checks")
  await Bun.write(path.join(root, "references/notes.md"), "Unrelated notes " + "y".repeat(20_000))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const prompt = "Use route-semantic. Oyuncu ok tuşlarıyla ilerlesin ve başa dönebilsin."
      const records: Skill.LoadedChunk[] = []
      await SystemPrompt.autoInjectSkills(prompt, undefined, (record) => records.push(record))
      const messages: any[] = [{ parts: [{ type: "text", metadata: { skillReads: records } }] }]
      expect((await Skill.pendingRequiredReads(prompt, messages)).join("\n")).toContain("select relevant references")
      const tool = await SkillTool.init()
      const ctx = {
        sessionID: "selection",
        messageID: "selection",
        agent: "build",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }
      const parentOnly = await tool.execute(
        { name: "route-semantic", task: "Build player movement; read only necessary references" },
        ctx,
      )
      expect(parentOnly.metadata.loadedReferences).toEqual([])
      expect(parentOnly.output).not.toContain("Control instructions")
      expect(parentOnly.output).not.toContain("Unrelated notes")
      await expect(tool.execute({ name: "route-semantic", references: [] }, ctx)).rejects.toThrow("requires a reason")
      await expect(
        tool.execute({ name: "route-semantic", references: ["../escape.md"], reason: "Test" }, ctx),
      ).rejects.toThrow("Unknown skill reference")
      const selection = await tool.execute(
        {
          name: "route-semantic",
          references: ["references/foundations.md", "references/motion.md", "references/checks.md"],
          reason:
            "The request needs shared foundations, reversible movement and runtime verification; reports are outside scope.",
        },
        ctx,
      )
      const add = (result: typeof selection) =>
        messages.push({
          parts: [{ type: "tool", tool: "skill", state: { status: "completed", metadata: result.metadata } }],
        })
      add(selection)
      const pending = (await Skill.pendingRequiredReads(prompt, messages)).join("\n")
      expect(pending).toContain("references/motion.md")
      expect(pending).not.toContain("references/notes.md")
      for (const reference of selection.metadata.remainingReferences ?? []) {
        const chunk = await tool.execute({ name: reference.name, offset: reference.offset, references: [] }, ctx)
        expect(chunk.metadata.selectedReferences).toBeUndefined()
        add(chunk)
      }
      expect(await Skill.pendingRequiredReads(prompt, messages)).toEqual([])
      expect(
        await Skill.pendingRequiredReads(prompt, [
          { parts: [{ type: "text", metadata: { skillReads: SessionCompaction._internals.skillReads(messages) } }] },
        ] as never),
      ).toEqual([])
    },
  })
})

test("reading-list reference advice honors selected reads instead of requiring the whole library", async () => {
  await using tmp = await tmpdir({ git: true })
  const location = await writeSkill(
    tmp.path,
    "route-reading",
    "route-reading",
    "[Needed](references/needed.md)\n[Other](references/other.md)",
  )
  await Bun.write(path.join(path.dirname(location), "references/needed.md"), "Reading-list interaction guidance")
  await Bun.write(path.join(path.dirname(location), "references/other.md"), "Unrelated game genre")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const prompt = "Build a reading list. Use route-reading and select only needed references before editing."
      const records: Skill.LoadedChunk[] = []
      const context = await SystemPrompt.autoInjectSkills(prompt, undefined, (record) => records.push(record))
      expect(context).not.toContain("Unrelated game genre")
      const messages: any[] = [{ parts: [{ type: "text", metadata: { skillReads: records } }] }]
      expect((await Skill.pendingRequiredReads(prompt, messages)).join("\n")).toContain("select relevant references")
      const tool = await SkillTool.init()
      const selection = await tool.execute(
        {
          name: "route-reading",
          references: ["references/needed.md"],
          reason: "Only the reading-list journey applies",
          task: prompt,
        },
        {
          sessionID: "selection",
          messageID: "selection",
          agent: "build",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
        },
      )
      messages.push({
        parts: [{ type: "tool", tool: "skill", state: { status: "completed", metadata: selection.metadata } }],
      })
      expect(await Skill.pendingRequiredReads(prompt, messages)).toEqual([])
      const explicitReads: Skill.LoadedChunk[] = []
      const explicit = "Read route-reading/references/needed.md."
      const explicitContext = await SystemPrompt.autoInjectSkills(explicit, undefined, (record) =>
        explicitReads.push(record),
      )
      expect(explicitContext).toContain("Reading-list interaction guidance")
      expect(explicitContext).not.toContain("Unrelated game genre")
      expect(
        await Skill.pendingRequiredReads(explicit, [
          { parts: [{ type: "text", metadata: { skillReads: explicitReads } }] },
        ] as never),
      ).toEqual([])
      const wholeTree = await SystemPrompt.autoInjectSkills("Read all references for route-reading.")
      expect(wholeTree).toContain("Unrelated game genre")
      expect(Skill.requestsReferences("Do not load all references for route-reading.")).toBe(false)
      expect(Skill.requestsReferences("route-reading alt başlıklarını oku")).toBe(true)
      expect(Skill.requestsReferences("route-reading skill ağacını oku")).toBe(true)
      expect(Skill.requestsReferences("Tüm referansları yükle")).toBe(true)
    },
  })
})

test("partial first reference lists all remaining files and tool offsets reconstruct exact content", async () => {
  await using tmp = await tmpdir({ git: true })
  const location = await writeSkill(tmp.path, "route-long")
  const body = Array.from({ length: 1_100 }, (_, index) => `line-${index}`).join("\n") + "\n" + "x".repeat(15_000)
  await Bun.write(path.join(path.dirname(location), "references/a-long.md"), body)
  await Bun.write(path.join(path.dirname(location), "references/z-last.md"), "Last guidance")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = (await Skill.get("route-long"))!
      const routed = await Skill.loadReferences({ skill })
      expect(routed.loaded[0].length).toBeLessThan(body.length)
      expect(routed.remaining.map((file) => file.name)).toEqual([
        "route-long/references/a-long.md",
        "route-long/references/z-last.md",
      ])
      const instance = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "test",
        agent: "build",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }
      let offset = 0
      let reconstructed = ""
      while (offset < body.length) {
        const result = await instance.execute({ name: "route-long/references/a-long.md", offset, limit: 4_000 }, ctx)
        expect(result.metadata.offset).toBe(offset)
        expect(result.metadata.length).toBeGreaterThan(0)
        const chunk = Skill.chunk(body, offset, 4_000)
        expect(result.output).toContain(chunk)
        reconstructed += chunk
        offset += result.metadata.length!
      }
      expect(reconstructed).toBe(body)
      expect(() => Skill.chunk(body, body.length + 1)).toThrow("outside content")
    },
  })
})

test("aliases retain canonical permissions; reference symlink and traversal cannot escape", async () => {
  await using tmp = await tmpdir({ git: true })
  const location = await writeSkill(tmp.path, "route-alias", "Canonical Routing")
  const root = path.dirname(location)
  await Bun.write(path.join(root, "references/local.md"), "Private reference instructions")
  await Bun.write(path.join(tmp.path, "outside.md"), "Outside secret")
  await fs.symlink(path.join(tmp.path, "outside.md"), path.join(root, "references/escape.md"))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = (await Skill.get("route-alias"))!
      expect(skill.name).toBe("Canonical Routing")
      await expect(Skill.referenceLocation(skill, "references/escape.md")).rejects.toThrow("escapes")
      await expect(Skill.referenceLocation(skill, "../../../outside.md")).rejects.toThrow("escapes")
      const denied = await SystemPrompt.autoInjectSkills("@route-alias read references/local.md", [
        { permission: "skill", pattern: "*", action: "allow" },
        { permission: "skill", pattern: "Canonical Routing", action: "deny" },
      ])
      expect(denied).toContain("permission required")
      expect(denied).not.toContain("Private reference instructions")
      const childDenied = await SystemPrompt.autoInjectSkills("route-alias read references/local.md", [
        { permission: "skill", pattern: "*", action: "allow" },
        { permission: "skill", pattern: "Canonical Routing/references/*", action: "deny" },
      ])
      expect(childDenied).not.toContain("Private reference instructions")
      const requests: string[][] = []
      const instance = await SkillTool.init()
      await instance.execute(
        { name: "route-alias/references/local.md" },
        {
          sessionID: "test",
          messageID: "test",
          agent: "build",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async (request) => {
            requests.push(request.patterns)
          },
        },
      )
      expect(requests).toEqual([["Canonical Routing", "Canonical Routing/references/local.md"]])
    },
  })
})

test("true name collisions disclose selected source and shadowed definitions", async () => {
  await using tmp = await tmpdir({ git: true })
  const primary = await writeSkill(tmp.path, "route-collision", "route-collision", "Selected source")
  const secondary = path.join(tmp.path, ".atomcli", "skill", "route-collision", "SKILL.md")
  await Bun.write(secondary, "---\nname: route-collision\ndescription: Second source\n---\nShadowed content")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = (await Skill.get("route-collision"))!
      const context = await SystemPrompt.autoInjectSkills("route-collision")
      expect(context).toContain(`source: ${skill.location}`)
      expect(skill.alternatives).toEqual([skill.location === primary ? secondary : primary])
      expect(context).toContain("shadowed definitions:")
      expect(context).toContain(skill.location === primary ? "Selected source" : "Shadowed content")
    },
  })
})
