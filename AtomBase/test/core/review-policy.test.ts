import { describe, expect, test } from "bun:test"
import { ReviewPolicy } from "@/core/verification/review-policy"

describe("ReviewPolicy", () => {
  test("keeps normal edits local and escalates critical paths", () => {
    expect(ReviewPolicy.assess({ editedFiles: ["src/ui/theme.ts"] })).toBe("medium")
    expect(ReviewPolicy.requiresIndependentReview("adaptive", { editedFiles: ["src/ui/theme.ts"] })).toBe(false)
    expect(ReviewPolicy.requiresIndependentReview("adaptive", { editedFiles: ["src/server/routes/auth.ts"] })).toBe(
      true,
    )
  })

  test("supports explicit always and off policies", () => {
    expect(ReviewPolicy.requiresIndependentReview("always", { editedFiles: ["README.md"] })).toBe(true)
    expect(ReviewPolicy.requiresIndependentReview("off", { editedFiles: ["src/auth.ts"] })).toBe(false)
  })

  test("fast feedback skips prototype manifests but retains critical review", () => {
    expect(
      ReviewPolicy.requiresIndependentReview("fast", {
        editedFiles: ["Games/flappy-pixel/package.json", "Games/flappy-pixel/game.js"],
        prompt: "Create a small Flappy Bird prototype",
        impact: { level: "high", score: 6, reasons: ["dependency metadata changed"], suggestedTests: [] },
      }),
    ).toBe(false)
    expect(
      ReviewPolicy.requiresIndependentReview("fast", {
        editedFiles: ["src/auth/token.ts"],
        prompt: "Update authentication",
      }),
    ).toBe(true)
  })

  test("ignores an invalid custom pattern without breaking the review gate", () => {
    expect(ReviewPolicy.assess({ editedFiles: ["src/ui.ts"], extraHighRiskPatterns: ["["] })).toBe("medium")
  })
})
