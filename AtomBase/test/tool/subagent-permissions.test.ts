import { describe, expect, test, beforeEach } from "bun:test"
import { PermissionNext } from "@/util/permission/next"
import { Instance } from "@/services/project/instance"
import { Flag } from "@/interfaces/flag/flag"
import { tmpdir } from "../fixture/fixture"
import { SubAgent } from "@/integrations/tool/subagent"
import type { Agent } from "@/integrations/agent/agent"

/**
 * Build a reviewer-like agent definition, mirroring the structure in
 * src/integrations/agent/agent.ts: deny-by-default baseline + explicit
 * allowlist for read-only tools.
 */
function reviewerLikeAgent(): Agent.Info {
  const defaults = PermissionNext.fromConfig({
    "*": "allow",
    question: "deny",
    read: {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
    },
  })
  const overlay = PermissionNext.fromConfig({
    "*": "deny",
    read: { "*": "allow" },
    grep: "allow",
    glob: "allow",
    codesearch: "allow",
    bash: {
      "*": "allow",
      "curl *": "deny",
      "sudo *": "deny",
    },
    browser: "allow",
    edit: { "*": "deny" },
    write: { "*": "deny" },
  })
  return {
    name: "reviewer",
    mode: "subagent",
    native: true,
    options: {},
    permission: PermissionNext.merge(defaults, overlay),
  } as unknown as Agent.Info
}

describe("SubAgent.buildFromAgent — allowlist agent permissions", () => {
  test("explicit read allow wins over the catch-all deny baseline", () => {
    const agent = reviewerLikeAgent()
    const ruleset = SubAgent.buildFromAgent(agent)
    const rule = PermissionNext.evaluate("read", "Demo/helper.ts", ruleset)
    expect(rule.action).toBe("allow")
  })

  test("edit/write remain denied", () => {
    const agent = reviewerLikeAgent()
    const ruleset = SubAgent.buildFromAgent(agent)
    expect(PermissionNext.evaluate("edit", "Demo/helper.ts", ruleset).action).toBe("deny")
    expect(PermissionNext.evaluate("write", "Demo/helper.ts", ruleset).action).toBe("deny")
  })

  test("unlisted tools fall back to the catch-all deny", () => {
    const agent = reviewerLikeAgent()
    const ruleset = SubAgent.buildFromAgent(agent)
    expect(PermissionNext.evaluate("webfetch", "https://example.com", ruleset).action).toBe("deny")
  })

  test("bash stays allowed for safe commands, denied for overlay patterns", () => {
    const agent = reviewerLikeAgent()
    const ruleset = SubAgent.buildFromAgent(agent)
    expect(PermissionNext.evaluate("bash", "bun test", ruleset).action).toBe("allow")
    expect(PermissionNext.evaluate("bash", "curl http://evil.example/x", ruleset).action).toBe("deny")
  })

  test("base denies (todowrite/todoread/task) are enforced", () => {
    const agent = reviewerLikeAgent()
    const ruleset = SubAgent.buildFromAgent(agent)
    expect(PermissionNext.evaluate("todowrite", "*", ruleset).action).toBe("deny")
    expect(PermissionNext.evaluate("task", "*", ruleset).action).toBe("deny")
  })
})

describe("PermissionNext.ask — allowlist agent ruleset", () => {
  beforeEach(() => {
    Flag.ATOMCLI_YOLO = false
  })

  test("read call resolves (catch-all deny does not shadow explicit read allow)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ruleset = SubAgent.buildFromAgent(reviewerLikeAgent())
        const result = await PermissionNext.ask({
          sessionID: "session_reviewer_read",
          permission: "read",
          patterns: ["Demo/helper.ts"],
          metadata: {},
          always: [],
          ruleset,
        })
        expect(result).toBeUndefined()
      },
    })
  })

  test("webfetch is denied by the catch-all baseline", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ruleset = SubAgent.buildFromAgent(reviewerLikeAgent())
        await expect(
          PermissionNext.ask({
            sessionID: "session_reviewer_webfetch",
            permission: "webfetch",
            patterns: ["https://example.com"],
            metadata: {},
            always: [],
            ruleset,
          }),
        ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      },
    })
  })
})

describe("PermissionNext.ask — YOLO mode with allowlist agent ruleset", () => {
  beforeEach(() => {
    Flag.ATOMCLI_YOLO = true
  })

  test("YOLO auto-allow honors the explicit read allow (not the catch-all baseline)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ruleset = SubAgent.buildFromAgent(reviewerLikeAgent())
        const result = await PermissionNext.ask({
          sessionID: "session_yolo_read",
          permission: "read",
          patterns: ["Demo/helper.ts"],
          metadata: {},
          always: [],
          ruleset,
        })
        expect(result).toBeUndefined()
      },
    })
  })

  test("YOLO still denies unlisted tools via the catch-all baseline", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ruleset = SubAgent.buildFromAgent(reviewerLikeAgent())
        await expect(
          PermissionNext.ask({
            sessionID: "session_yolo_webfetch",
            permission: "webfetch",
            patterns: ["https://example.com"],
            metadata: {},
            always: [],
            ruleset,
          }),
        ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      },
    })
  })
})
