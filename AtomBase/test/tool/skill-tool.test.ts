import { describe, test, expect, mock } from "bun:test"
import { SkillTool } from "@/integrations/tool/skill"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

describe("SkillTool", () => {
  const dummyCtx = {
    sessionID: "test-session-id",
    messageID: "test-message-id",
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

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

describe("SkillAddTool", () => {
  const dummyCtx = {
    sessionID: "test-session-id",
    messageID: "test-message-id",
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  test("prevents path traversal attacks when name contains ..", async () => {
    const { SkillAddTool } = await import("@/integrations/tool/skilladd")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await SkillAddTool.init({})

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

