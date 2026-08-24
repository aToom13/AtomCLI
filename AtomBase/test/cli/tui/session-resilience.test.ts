import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { FileSearch } from "@tui/component/file-search"
import { SessionRecovery } from "@tui/context/session-recovery"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function tool(tool: string, input: Record<string, unknown>, output = "", metadata: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    sessionID: "session-parent",
    messageID: "message-1",
    type: "tool",
    callID: crypto.randomUUID(),
    tool,
    state: {
      status: "completed",
      input,
      output,
      title: tool,
      metadata,
      time: { start: 1, end: 2 },
    },
  } as any
}

function runningTool(toolName: string, input: Record<string, unknown>) {
  const part = tool(toolName, input)
  part.state = { status: "running", input, time: { start: 1 } }
  return part
}

describe("TUI session recovery", () => {
  test("replays persisted taskflow calls after reopening a session", () => {
    const chain = SessionRecovery.chain([
      tool("taskflow", {
        action: "start",
        plan: [
          { id: "inspect", name: "Inspect", todos: [{ id: "files", content: "Read files" }] },
          { id: "fix", name: "Fix" },
        ],
      }),
      tool("taskflow", { action: "update", step_id: "0", todo_id: "0", todo_status: "completed" }),
      tool("taskflow", { action: "complete", step_id: "0", output: "inspected" }),
      tool("taskflow", { action: "update", step_id: "1", status: "running" }),
    ])

    expect(chain?.steps.map((step) => step.status)).toEqual(["complete", "running"])
    expect(chain?.steps[0].todos?.[0].status).toBe("complete")
    expect(chain?.currentStep).toBe(1)
  })

  test("keeps orchestrate task results from persisted output", () => {
    const chain = SessionRecovery.chain([
      tool("orchestrate", {
        action: "plan",
        tasks: [
          { id: "ui", prompt: "Fix UI", agent: "coder" },
          { id: "audit", prompt: "Audit UI", agent: "checker", dependsOn: ["ui"] },
        ],
      }),
      tool(
        "orchestrate",
        { action: "execute", workflowId: "wf-1" },
        "### ✅ ui (@coder) [coding]\n\n---\n### ❌ audit (@checker) [analysis]",
      ),
    ])

    expect(chain?.steps.map((step) => step.status)).toEqual(["complete", "failed"])
    expect(chain?.status).toBe("failed")
  })

  test("derives the agent list from persisted child sessions", () => {
    const agents = SessionRecovery.agents(
      "session-parent",
      [
        { id: "session-parent", title: "Main", time: { created: 10, updated: 20 } },
        {
          id: "child-1",
          parentID: "session-parent",
          title: "Inspect files (@explore subagent)",
          time: { created: 100, updated: 200 },
        },
        {
          id: "child-2",
          parentID: "other",
          title: "Ignore me (@coder subagent)",
          time: { created: 300, updated: 400 },
        },
      ] as any,
      (sessionID) => (sessionID === "child-1" ? "working" : "idle"),
    )

    expect(agents).toEqual([
      {
        sessionId: "child-1",
        parentSessionId: "session-parent",
        agentType: "explore",
        description: "Inspect files",
        status: "running",
        startedAt: 100,
        updatedAt: 200,
        runtime: "atom-inprocess",
      },
    ])
  })

  test("restores a running single-agent task while its tool call is still active", () => {
    const chain = SessionRecovery.chain([
      runningTool("agent", {
        action: "spawn",
        subagent_type: "explore",
        description: "Inspect responsive layout",
        prompt: "Find fixed-width TUI components",
      }),
    ])

    expect(chain?.status).toBe("executing")
    expect(chain?.steps[0]).toMatchObject({
      id: "inspect_responsive_layout",
      name: "Inspect responsive layout",
      agentType: "explore",
      status: "running",
    })
  })

  test("does not erase a taskflow when a clear attempt was blocked", () => {
    const chain = SessionRecovery.chain([
      tool("taskflow", { action: "start", plan: [{ id: "audit", name: "Audit" }] }),
      tool("taskflow", { action: "clear" }, "Review failed", { status: "blocked" }),
    ])

    expect(chain?.steps).toHaveLength(1)
    expect(chain?.steps[0].name).toBe("Audit")
  })

  test("does not replace a parent taskflow with a later agent spawn", () => {
    const chain = SessionRecovery.chain([
      tool("taskflow", {
        action: "start",
        plan: [
          { id: "inspect", name: "Inspect" },
          { id: "fix", name: "Fix" },
        ],
      }),
      tool(
        "agent",
        {
          action: "spawn",
          subagent_type: "explore",
          description: "Inspect orchestration",
          prompt: "Inspect the agent tool",
        },
        "### ✅ inspect_orchestration (@explore) [analysis]",
        { status: "completed" },
      ),
    ])

    expect(chain?.steps.map((step) => step.name)).toEqual(["Inspect", "Fix"])
    expect(chain?.steps).toHaveLength(2)
  })
})

describe("Files search", () => {
  test("searches asynchronously by relative path and skips dependency trees", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "atomcli-file-search-"))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, "src", "features"), { recursive: true })
    await mkdir(path.join(root, "node_modules", "hidden-package"), { recursive: true })
    await writeFile(path.join(root, "src", "features", "responsive-layout.ts"), "export {}")
    await writeFile(path.join(root, "node_modules", "hidden-package", "responsive-layout.ts"), "export {}")

    const results = await FileSearch.find(root, "features/responsive")

    expect(results.map((entry) => path.relative(root, entry.path))).toEqual(["src/features/responsive-layout.ts"])
  })

  test("caps results to keep interactive search responsive", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "atomcli-file-search-limit-"))
    temporaryDirectories.push(root)
    await Promise.all(Array.from({ length: 12 }, (_, index) => writeFile(path.join(root, `match-${index}.ts`), "")))

    const results = await FileSearch.find(root, "match", { maxResults: 5 })

    expect(results).toHaveLength(5)
  })
})
