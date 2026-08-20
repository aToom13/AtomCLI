import { describe, expect, test } from "bun:test"
import { PromptManager } from "@/core/session/prompt/manager"

describe("PromptManager budget", () => {
  test("keeps native agent prompts below the fixed-prefix budget", () => {
    for (const agent of ["agent", "build", "plan", "explore", "checker", "reviewer"] as const) {
      const stats = PromptManager.getStats({ modelId: "test", agent })
      expect(stats.totalTokens, `${agent} prompt token estimate`).toBeLessThanOrEqual(6000)
      expect(stats.sections.reduce((sum, section) => sum + section.tokens, 0)).toBeLessThanOrEqual(stats.totalTokens + 5)
    }
  })

  test("does not encode mandatory reviewer chains in the shared prompt", () => {
    const prompt = PromptManager.build({ modelId: "test", agent: "agent" })
    expect(prompt).toContain("Review is adaptive")
    expect(prompt).not.toContain("MUST spawn `reviewer`")
    expect(prompt).not.toContain("self-verification is forbidden")
  })
})
