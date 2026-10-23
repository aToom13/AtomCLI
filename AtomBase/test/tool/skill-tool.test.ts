import "../preload"
import { describe, test, expect, mock } from "bun:test"
import { SkillTool } from "@/integrations/tool/skill"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { CompactionTransaction } from "@/core/session/compaction-transaction"

describe("SkillTool", () => {
  const dummyCtx = {
    sessionID: "test-session-id",
    messageID: "test-message-id",
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  test.each(["repeat", "compacted"] as const)(
    "reuses only skill bodies still available in %s context",
    async (mode) => {
      await using tmp = await tmpdir({ git: true })
      const dir = path.join(tmp.path, ".atomcli", "skills", "context-skill")
      await fs.mkdir(path.join(dir, "references"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "SKILL.md"),
        "---\nname: context-skill\ndescription: Context regression\n---\nUnique parent instructions\n[Camera](references/camera.md)",
      )
      const reference = path.join(dir, "references", "camera.md")
      await fs.writeFile(reference, "Unique camera instructions")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const userID = Identifier.ascending("message")
          await Session.updateMessage({
            id: userID,
            sessionID: session.id,
            role: "user",
            agent: "build",
            model: { providerID: "fixture", modelID: "fixture" },
            time: { created: Date.now() },
          })
          const addAssistant = async (summary = false, parentID = userID) => {
            const id = Identifier.ascending("message")
            await Session.updateMessage({
              id,
              sessionID: session.id,
              role: "assistant",
              parentID,
              agent: "build",
              providerID: "fixture",
              modelID: "fixture",
              path: { cwd: tmp.path, root: tmp.path },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: Date.now() },
              summary,
              finish: "stop",
            })
            return id
          }
          const tool = await SkillTool.init()
          const context = { ...dummyCtx, sessionID: session.id }
          const args = { name: "context-skill", references: ["references/camera.md"], reason: "Camera task" }
          const first = await tool.execute(args, context)
          expect(first.output).toContain("Unique camera instructions")
          const messageID = await addAssistant()
          await Session.updatePart({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID,
            type: "tool",
            tool: "skill",
            callID: "skill-first",
            state: { status: "completed", input: args, ...first, time: { start: 0, end: 1 } },
          })
          if (mode === "repeat") {
            const repeated = await tool.execute({ name: "context-skill/references/camera.md" }, context)
            expect(repeated.output).not.toContain("Unique camera instructions")
            expect(repeated.metadata.length).toBe(0)
            await fs.writeFile(reference, "Changed camera instructions")
            const changed = await tool.execute({ name: "context-skill/references/camera.md" }, context)
            expect(changed.output).toContain("Changed camera instructions")
            expect(changed.metadata.length).toBe("Changed camera instructions".length)
          } else {
            const compactID = Identifier.ascending("message")
            await Session.updateMessage({
              id: compactID,
              sessionID: session.id,
              role: "user",
              agent: "build",
              model: { providerID: "fixture", modelID: "fixture" },
              time: { created: Date.now() },
            })
            await Session.updatePart({
              id: Identifier.ascending("part"),
              sessionID: session.id,
              messageID: compactID,
              type: "compaction",
              auto: true,
            })
            const summaryID = await addAssistant(true, compactID)
            await Session.updatePart({
              id: Identifier.ascending("part"),
              sessionID: session.id,
              messageID: summaryID,
              type: "text",
              text: "Read history; bodies omitted",
              metadata: {
                skillReads: [{ ...first.metadata, name: "context-skill" }, ...first.metadata.loadedReferences!],
              },
            })
            const transaction = await CompactionTransaction.start(session.id, 1000, 0, {
              parentID: compactID,
              summaryMessageID: summaryID,
            })
            await CompactionTransaction.finish(transaction, 100, true)
            const restored = await tool.execute(args, context)
            expect(restored.output).toContain("Unique parent instructions")
            expect(restored.output).toContain("Unique camera instructions")
          }
        },
      })
    },
  )

  test("action='load' throws error if skill not found", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await SkillTool.init({})
        expect(
          instance.execute(
            {
              action: "load",
              name: "non-existent-skill-id",
            },
            dummyCtx,
          ),
        ).rejects.toThrow('Skill "non-existent-skill-id" not found')
      },
    })
  })

  test("action='load' throws error if name parameter missing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await SkillTool.init({})
        expect(
          instance.execute(
            {
              action: "load",
            },
            dummyCtx,
          ),
        ).rejects.toThrow("Parameter 'name' is required for action='load'")
      },
    })
  })

  test("loads a reference path and lists references from the root skill", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skillDir = path.join(tmp.path, ".atomcli", "skills", "reference-skill")
        await fs.mkdir(path.join(skillDir, "references"), { recursive: true })
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: reference-skill\ndescription: Reference test\n---\n# Root instructions",
        )
        await fs.writeFile(path.join(skillDir, "references", "details.md"), "# Detailed instructions")
        const instance = await SkillTool.init({})

        const root = await instance.execute({ action: "load", name: "reference-skill" }, dummyCtx)
        expect(root.output).toContain("reference-skill/references/details.md")
        const reference = await instance.execute(
          { action: "load", name: "reference-skill/references/details" },
          dummyCtx,
        )
        expect(reference.output).toContain("# Detailed instructions")
        const relative = await instance.execute({ action: "load", name: "references/details.md" }, dummyCtx)
        expect(relative.output).toContain("# Detailed instructions")
        const selected = await instance.execute(
          {
            action: "load",
            name: "reference-skill",
            references: ["reference-skill/references/details.md"],
            reason: "The task needs the detailed instructions",
          },
          dummyCtx,
        )
        expect(selected.output).toContain("# Detailed instructions")
        expect(selected.metadata.selectedReferences).toEqual(["references/details.md"])
      },
    })
  })

  test("records an automatic empty reference selection in the same parent call", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skillDir = path.join(tmp.path, ".atomcli", "skills", "automatic-selection")
        await fs.mkdir(path.join(skillDir, "references"), { recursive: true })
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: automatic-selection\ndescription: Reference routing test\n---\n# Parent\n[Network](references/network.md)",
        )
        await fs.writeFile(path.join(skillDir, "references", "network.md"), "Network-only guidance")
        const result = await (
          await SkillTool.init()
        ).execute({ name: "automatic-selection", task: "Explain local formatting" }, dummyCtx)
        expect(result.metadata.selectedReferences).toEqual([])
        expect(result.metadata.selectionReason).toContain("No task-relevant")
        expect(result.output).not.toContain("Network-only guidance")
      },
    })
  })

  test("loads task-relevant references in the parent call", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skillDir = path.join(tmp.path, ".atomcli", "skills", "automatic-selection")
        await fs.mkdir(path.join(skillDir, "references"), { recursive: true })
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: automatic-selection\ndescription: Reference routing test\n---\n# Parent\n[MCP](references/mcp.md)\n[UI](references/ui.md)",
        )
        await fs.writeFile(path.join(skillDir, "references", "mcp.md"), "MCP connection and recovery guidance")
        await fs.writeFile(path.join(skillDir, "references", "ui.md"), "Unrelated UI guidance")
        const result = await (
          await SkillTool.init()
        ).execute({ name: "automatic-selection", task: "Diagnose the MCP connection" }, dummyCtx)
        expect(result.output).toContain("MCP connection and recovery guidance")
        expect(result.output).not.toContain("Unrelated UI guidance")
        expect(result.metadata.selectedReferences).toEqual(["references/mcp.md"])
        expect(result.output).toContain("Do not call the parent skill again")
      },
    })
  })

  test("action='add' throws error if url parameter missing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await SkillTool.init({})
        expect(
          instance.execute(
            {
              action: "add",
            },
            dummyCtx,
          ),
        ).rejects.toThrow("Parameter 'url' is required for action='add'")
      },
    })
  })

  test("action='add' prevents path traversal attacks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await SkillTool.init({})

        // Mock global fetch to return valid frontmatter
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => ({
          ok: true,
          status: 200,
          text: async () => "---\nname: evil-skill\ndescription: Evil\n---\n# Evil",
        })) as any

        try {
          expect(
            instance.execute(
              {
                action: "add",
                name: "../../evil-hacker",
                url: "https://raw.githubusercontent.com/user/repo/main/SKILL.md",
              },
              dummyCtx,
            ),
          ).rejects.toThrow("path traversal detected")
        } finally {
          globalThis.fetch = originalFetch
        }
      },
    })
  })

  test("action='add' successfully fetches and installs a valid skill", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await SkillTool.init({})

        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "---\nname: my-new-skill\ndescription: A newly added skill\n---\n# Content",
        })) as any

        try {
          const result = await instance.execute(
            {
              action: "add",
              name: "my-new-skill",
              url: "https://github.com/user/repo/blob/main/skills/my-new-skill/SKILL.md",
            },
            dummyCtx,
          )

          expect(result.title).toContain("Installed skill: my-new-skill")
          expect(result.output).toContain("installed successfully")
          expect(result.metadata.name).toBe("my-new-skill")
        } finally {
          globalThis.fetch = originalFetch
        }
      },
    })
  })
})

describe("SkillTool add validation", () => {
  const dummyCtx = {
    sessionID: "test-session-id",
    messageID: "test-message-id",
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  test("prevents path traversal attacks when name contains ..", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await SkillTool.init({})

        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => ({
          ok: true,
          status: 200,
          text: async () => "---\nname: evil-skill\ndescription: Evil\n---\n# Evil",
        })) as any

        try {
          expect(
            instance.execute(
              {
                action: "add",
                name: "../../evil-hacker",
                url: "https://raw.githubusercontent.com/user/repo/main/SKILL.md",
              },
              dummyCtx,
            ),
          ).rejects.toThrow("path traversal detected")
        } finally {
          globalThis.fetch = originalFetch
        }
      },
    })
  })
})
