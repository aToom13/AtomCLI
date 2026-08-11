import { test, expect, describe } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "@/services/project/instance"
import { Agent } from "@/integrations/agent/agent"
import { PermissionNext } from "@/util/permission/next"
import { ToolRegistry } from "@/integrations/tool/registry"
import { Tool } from "@/integrations/tool/tool"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): PermissionNext.Action | undefined {
  if (!agent) return undefined
  return PermissionNext.evaluate(permission, "*", agent.permission).action
}

test("returns default native agents when no config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).toContain("build")
      expect(names).toContain("plan")
      expect(names).toContain("checker")
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).toContain("compaction")
      expect(names).toContain("title")
      expect(names).toContain("summary")
    },
  })
})

test("checker agent has mode 'all' and is native", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const checker = await Agent.get("checker")
      expect(checker).toBeDefined()
      expect(checker?.mode).toBe("all")
      expect(checker?.native).toBe(true)
    },
  })
})

test("checker agent denies edits (read-only auditor)", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const checker = await Agent.get("checker")
      expect(checker).toBeDefined()
      expect(evalPerm(checker, "edit")).toBe("deny")
      // Read and search tools should be allowed
      expect(evalPerm(checker, "read")).toBe("allow")
      expect(evalPerm(checker, "grep")).toBe("allow")
    },
  })
})

test("build agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      expect(build?.mode).toBe("primary")
      expect(build?.native).toBe(true)
      expect(evalPerm(build, "edit")).toBe("allow")
      expect(evalPerm(build, "bash")).toBe("allow")
    },
  })
})

test("plan agent denies edits except .atomcli/plan/*", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await Agent.get("plan")
      expect(plan).toBeDefined()
      // Wildcard is denied
      expect(evalPerm(plan, "edit")).toBe("deny")
      // But specific path is allowed
      expect(PermissionNext.evaluate("edit", ".atomcli/plan/foo.md", plan!.permission).action).toBe("allow")
    },
  })
})

test("explore agent denies edit and write", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeDefined()
      expect(explore?.mode).toBe("subagent")
      expect(evalPerm(explore, "edit")).toBe("deny")
      expect(evalPerm(explore, "write")).toBe("deny")
      expect(evalPerm(explore, "todoread")).toBe("deny")
      expect(evalPerm(explore, "todowrite")).toBe("deny")
    },
  })
})

test("general agent denies todo tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const general = await Agent.get("general")
      expect(general).toBeDefined()
      expect(general?.mode).toBe("subagent")
      expect(general?.hidden).toBeUndefined()
      expect(evalPerm(general, "todoread")).toBe("deny")
      expect(evalPerm(general, "todowrite")).toBe("deny")
    },
  })
})

test("compaction agent denies all permissions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const compaction = await Agent.get("compaction")
      expect(compaction).toBeDefined()
      expect(compaction?.hidden).toBe(true)
      expect(evalPerm(compaction, "bash")).toBe("deny")
      expect(evalPerm(compaction, "edit")).toBe("deny")
      expect(evalPerm(compaction, "read")).toBe("deny")
    },
  })
})

test("custom agent from config creates new agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        my_custom_agent: {
          model: "openai/gpt-4",
          description: "My custom agent",
          temperature: 0.5,
          top_p: 0.9,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const custom = await Agent.get("my_custom_agent")
      expect(custom).toBeDefined()
      expect(custom?.model?.providerID).toBe("openai")
      expect(custom?.model?.modelID).toBe("gpt-4")
      expect(custom?.description).toBe("My custom agent")
      expect(custom?.temperature).toBe(0.5)
      expect(custom?.topP).toBe(0.9)
      expect(custom?.native).toBe(false)
      expect(custom?.mode).toBe("all")
    },
  })
})

test("custom agent config overrides native agent properties", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          model: "anthropic/claude-3",
          description: "Custom build agent",
          temperature: 0.7,
          color: "#FF0000",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      expect(build?.model?.providerID).toBe("anthropic")
      expect(build?.model?.modelID).toBe("claude-3")
      expect(build?.description).toBe("Custom build agent")
      expect(build?.temperature).toBe(0.7)
      expect(build?.color).toBe("#FF0000")
      expect(build?.native).toBe(true)
    },
  })
})

test("agent disable removes agent from list", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore).toBeUndefined()
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("explore")
    },
  })
})

test("agent permission config merges with defaults", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          permission: {
            bash: {
              "rm -rf *": "deny",
            },
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      // Specific pattern is denied
      expect(PermissionNext.evaluate("bash", "rm -rf *", build!.permission).action).toBe("deny")
      // Edit still allowed
      expect(evalPerm(build, "edit")).toBe("allow")
    },
  })
})

test("global permission config applies to all agents", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeDefined()
      expect(evalPerm(build, "bash")).toBe("deny")
    },
  })
})

test("agent steps/maxSteps config sets steps property", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { steps: 50 },
        plan: { maxSteps: 100 },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      const plan = await Agent.get("plan")
      expect(build?.steps).toBe(50)
      expect(plan?.steps).toBe(100)
    },
  })
})

test("agent mode can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { mode: "primary" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await Agent.get("explore")
      expect(explore?.mode).toBe("primary")
    },
  })
})

test("agent name can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { name: "Builder" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.name).toBe("Builder")
    },
  })
})

test("agent prompt can be set from config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { prompt: "Custom system prompt" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.prompt).toBe("Custom system prompt")
    },
  })
})

test("unknown agent properties are placed into options", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          random_property: "hello",
          another_random: 123,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.options.random_property).toBe("hello")
      expect(build?.options.another_random).toBe(123)
    },
  })
})

test("agent options merge correctly", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          options: {
            custom_option: true,
            another_option: "value",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build?.options.custom_option).toBe(true)
      expect(build?.options.another_option).toBe("value")
    },
  })
})

test("multiple custom agents can be defined", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        agent_a: {
          description: "Agent A",
          mode: "subagent",
        },
        agent_b: {
          description: "Agent B",
          mode: "primary",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agentA = await Agent.get("agent_a")
      const agentB = await Agent.get("agent_b")
      expect(agentA?.description).toBe("Agent A")
      expect(agentA?.mode).toBe("subagent")
      expect(agentB?.description).toBe("Agent B")
      expect(agentB?.mode).toBe("primary")
    },
  })
})

test("Agent.get returns undefined for non-existent agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const nonExistent = await Agent.get("does_not_exist")
      expect(nonExistent).toBeUndefined()
    },
  })
})

test("default permission includes doom_loop and external_directory as ask", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(evalPerm(build, "doom_loop")).toBe("ask")
      expect(evalPerm(build, "external_directory")).toBe("ask")
    },
  })
})

test("webfetch is allowed by default", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(evalPerm(build, "webfetch")).toBe("allow")
    },
  })
})

test("legacy tools config converts to permissions", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          tools: {
            bash: false,
            read: false,
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(evalPerm(build, "bash")).toBe("deny")
      expect(evalPerm(build, "read")).toBe("deny")
    },
  })
})

test("legacy tools config maps write/edit/patch/multiedit to edit permission", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          tools: {
            write: false,
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(evalPerm(build, "edit")).toBe("deny")
    },
  })
})

test("Truncate.DIR is allowed even when user denies external_directory globally", async () => {
  const { Truncate } = await import("@/integrations/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("Truncate.DIR is allowed even when user denies external_directory per-agent", async () => {
  const { Truncate } = await import("@/integrations/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          permission: {
            external_directory: "deny",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("explicit Truncate.DIR deny is respected", async () => {
  const { Truncate } = await import("@/integrations/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.DIR]: "deny",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
    },
  })
})

// ── Explore Agent Tool Filtering Integration Tests ──

const EXPLORE_ALLOWED_TOOLS = [
  "read",
  "find",
  "grep",
  "bash",
  "webfetch",
  "websearch",
  "codesearch",
  "skill",
  "memory",
  "taskflow",
]
const EXPLORE_DENIED_TOOLS = [
  "edit",
  "write",
  "todowrite",
  "todoread",
  "batch",
  "task",
  "browser",
  "self_maintenance",
  "system_health",
]

describe("explore agent tool filtering", () => {
  test("ToolRegistry.tools() returns only allowlisted tools for explore agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const explore = await Agent.get("explore")
        expect(explore).toBeDefined()

        const tools = await ToolRegistry.tools("atomcli", explore!)
        const toolIds = tools.map((t) => t.id)

        // All returned tools must be from the allowlist
        for (const id of toolIds) {
          expect(EXPLORE_ALLOWED_TOOLS).toContain(id)
        }

        // Every allowlisted tool (except skill/memory which may be unavailable) must be present
        for (const allowed of EXPLORE_ALLOWED_TOOLS) {
          if (allowed === "skill" || allowed === "memory") continue // optional tools
          expect(toolIds).toContain(allowed)
        }
      },
    })
  })

  test("ToolRegistry.tools() excludes destructive/write tools for explore agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const explore = await Agent.get("explore")
        expect(explore).toBeDefined()

        const tools = await ToolRegistry.tools("atomcli", explore!)
        const toolIds = tools.map((t) => t.id)

        // None of the denied tools should be present
        for (const denied of EXPLORE_DENIED_TOOLS) {
          expect(toolIds).not.toContain(denied)
        }
      },
    })
  })

  test("PermissionNext.disabled() identifies write/edit tools as disabled for explore agent", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const explore = await Agent.get("explore")
        expect(explore).toBeDefined()

        const allToolIds = [...EXPLORE_ALLOWED_TOOLS, ...EXPLORE_DENIED_TOOLS]
        const disabled = PermissionNext.disabled(allToolIds, explore!.permission)

        // edit and write must be disabled
        expect(disabled.has("edit")).toBe(true)
        expect(disabled.has("write")).toBe(true)
        expect(disabled.has("todowrite")).toBe(true)
        expect(disabled.has("todoread")).toBe(true)

        // read/search tools must NOT be disabled
        expect(disabled.has("read")).toBe(false)
        expect(disabled.has("grep")).toBe(false)
        expect(disabled.has("bash")).toBe(false)
        expect(disabled.has("webfetch")).toBe(false)
        expect(disabled.has("websearch")).toBe(false)
        expect(disabled.has("codesearch")).toBe(false)
      },
    })
  })

  test("explore agent permissions allow read/search but deny destructive actions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const explore = await Agent.get("explore")
        expect(explore).toBeDefined()

        // Verify each allowed tool evaluates to "allow"
        for (const tool of ["read", "grep", "bash", "webfetch", "websearch", "codesearch"]) {
          expect(evalPerm(explore, tool)).toBe("allow")
        }

        // Verify each denied tool evaluates to "deny"
        for (const tool of ["edit", "write", "todowrite", "todoread"]) {
          expect(evalPerm(explore, tool)).toBe("deny")
        }
      },
    })
  })

  test("coder agent (subagent) has full tool access (no tool allowlist)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // coder should have no allowlist restriction
        const toolsNoAgent = await ToolRegistry.tools("atomcli")
        const toolsWithCoder = await ToolRegistry.tools("atomcli", await Agent.get("coder"))

        // Without explicit allowlist, coder gets all tools
        const coderTools = toolsWithCoder.map((t) => t.id)
        expect(coderTools.length).toBeGreaterThan(EXPLORE_ALLOWED_TOOLS.length)
        expect(coderTools).toContain("edit")
        expect(coderTools).toContain("write")
      },
    })
  })

  test("decideTools returns correct allowlist for explore vs primary agents", async () => {
    const { SessionPolicy } = await import("@/core/session/policy")

    const exploreTools = SessionPolicy.decideTools("explore")
    expect(exploreTools).toEqual(EXPLORE_ALLOWED_TOOLS)

    // Primary agents return undefined (no filtering)
    expect(SessionPolicy.decideTools("agent")).toBeUndefined()
    expect(SessionPolicy.decideTools("coder")).toBeUndefined()
    expect(SessionPolicy.decideTools("build")).toBeUndefined()
  })
})

test("reviewer agent bash overlay denies substitution/exfil primitives", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const reviewer = await Agent.get("reviewer")
      expect(reviewer).toBeDefined()
      const bashDenies = (reviewer!.permission ?? [])
        .filter((r) => r.permission === "bash" && r.action === "deny")
        .map((r) => r.pattern)

      // Each of these must exist as a deny pattern so the overlay cannot be
      // bypassed via command substitution, unlisted git/ssh primitives, or
      // inline runtime executors.
      for (const pattern of [
        "*$(curl*",
        "*eval *",
        "*xargs *",
        "*git push*",
        "*git fetch*",
        "*git clone*",
        "*ssh *",
        "*npx *",
        "*deno eval*",
        "*bun -e*",
        "*cat * | python3*",
        "*busybox wget*",
        // package runners / installers (arbitrary package download + exec)
        "*bunx *",
        "*bun i *",
        "*bun install *",
        "*npm *",
        "*npx -y*",
        "*pnpm dlx*",
        "*yarn dlx*",
        "*pip install *",
        "*pip3 install *",
        "*pip2 install *",
      ]) {
        expect(bashDenies).toContain(pattern)
      }
    },
  })
})
