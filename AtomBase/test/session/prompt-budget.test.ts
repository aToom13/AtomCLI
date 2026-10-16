import "../preload"
import { describe, expect, test } from "bun:test"
import { PromptManager } from "@/core/session/prompt/manager"
import { ExecutionPolicy } from "@/core/routing/execution-policy"

describe("PromptManager budget", () => {
  test("coordinated instructions match the advertised coordination tools", () => {
    const tools = ExecutionPolicy.selectAllowedTools("coordinated", "change", ["workspace"], true)!
    expect(tools).toContain("todo")
    expect(tools).toContain("agent")
    expect(tools).not.toContain("taskflow")
    for (const agent of ["agent", "build"] as const) {
      const prompt = PromptManager.build({ modelId: "test", agent, scope: "coordinated" })
      expect(prompt).not.toContain("For coordinated work, use `taskflow`")
      expect(prompt).not.toContain("Use `taskflow` for persistent coordination")
      expect(prompt).not.toContain("milestones → use `taskflow`")
      expect(prompt).toContain("`todo`")
    }
  })

  test("keeps native agent prompts below the fixed-prefix budget", () => {
    for (const agent of ["agent", "build", "plan", "explore", "checker", "reviewer"] as const) {
      const stats = PromptManager.getStats({ modelId: "test", agent })
      expect(stats.totalTokens, `${agent} prompt token estimate`).toBeLessThanOrEqual(6000)
      expect(stats.sections.reduce((sum, section) => sum + section.tokens, 0)).toBeLessThanOrEqual(
        stats.totalTokens + 5,
      )
    }
  })

  test("does not encode mandatory reviewer chains in the shared prompt", () => {
    const prompt = PromptManager.build({ modelId: "test", agent: "agent" })
    expect(prompt).toContain("Independent review is optional")
    expect(prompt).toContain("Requested review defaults to one reviewer")
    expect(prompt).toContain("Report incomplete optional review separately from the code outcome")
    expect(prompt).not.toContain("MUST spawn `reviewer`")
    expect(prompt).not.toContain("self-verification is forbidden")
  })

  test("build prompt separates single-file artifact from staged implementation", () => {
    const prompt = PromptManager.build({ modelId: "test", agent: "build" })
    expect(prompt).toContain("one final artifact, not one giant write")
    expect(prompt).toContain("one meaningful playable/user journey")
    expect(prompt).toContain("When building a web frontend UI")
    expect(prompt).toContain("Preserve the user's acceptance criteria verbatim in delegated work")
  })
})
