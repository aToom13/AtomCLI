import "../preload"
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

  test("defaults to one optional reviewer", () => {
    expect(ReviewPolicy.snapshotFromConfig({})).toMatchObject({ auto: false, reviewerCount: 1 })
  })

  test("advisory mode recommends without requiring a reviewer", () => {
    expect(ReviewPolicy.requiresIndependentReview("advisory", { editedFiles: ["package.json"] })).toBe(false)
    expect(ReviewPolicy.requiresIndependentReview("enforced", { editedFiles: ["package.json"] })).toBe(true)
  })

  test("automatic review is opt-in in the policy snapshot", () => {
    const snapshot = ReviewPolicy.snapshot({
      enabled: true,
      configuredPolicy: "always",
      reviewerCount: 1,
      attemptLimit: 3,
      highRiskPatterns: [],
    })
    expect(snapshot.auto).toBe(false)
    expect(snapshot.effectivePolicy).toBe("advisory")
    expect(snapshot.policyDigest).toBeString()
  })

  test("never requires independent review without mutations", () => {
    expect(
      ReviewPolicy.requiresIndependentReview("adaptive", {
        editedFiles: [],
        scope: "coordinated",
        risk: "elevated",
      }),
    ).toBe(false)
    expect(ReviewPolicy.requiresIndependentReview("adaptive", { editedFiles: [], risk: "critical" })).toBe(false)
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

  test("applies configured high risk patterns in every policy mode", () => {
    const input = { editedFiles: ["src/pipe-art-renderer.ts"], extraHighRiskPatterns: ["pipe-art"] }
    expect(ReviewPolicy.requiresIndependentReview("adaptive", input)).toBe(true)
    expect(ReviewPolicy.requiresIndependentReview("enforced", input)).toBe(true)
    expect(ReviewPolicy.requiresIndependentReview("fast", input)).toBe(true)
    // A pattern that does not match must not escalate a low-risk path on its own.
    expect(
      ReviewPolicy.requiresIndependentReview("fast", { ...input, extraHighRiskPatterns: ["nothing-matches"] }),
    ).toBe(false)
  })

  test("resolves the same snapshot whether or not the review block is configured", () => {
    // snapshotFromConfig is shared by the review gate and the execution runtime,
    // so an absent block must not produce a different digest than a block that
    // only restates the schema defaults.
    const absent = ReviewPolicy.snapshotFromConfig({})
    const explicit = ReviewPolicy.snapshotFromConfig({
      review: {
        enabled: true,
        policy: "adaptive",
        reviewer_count: 1,
        max_attempts: 3,
        high_risk_patterns: [],
      },
    })
    expect(absent.policyDigest).toBe(explicit.policyDigest)
    expect(absent.effectivePolicy).toBe("advisory")
    expect(absent.auto).toBe(false)
  })

  test("tracks config changes in the policy digest", () => {
    const base = ReviewPolicy.snapshotFromConfig({}).policyDigest
    expect(ReviewPolicy.snapshotFromConfig({ review: { policy: "always" } }).policyDigest).not.toBe(base)
    expect(ReviewPolicy.snapshotFromConfig({ review: { policy: "advisory" } }).policyDigest).not.toBe(base)
    expect(ReviewPolicy.snapshotFromConfig({ review: { reviewer_count: 2 } }).policyDigest).not.toBe(base)
    expect(ReviewPolicy.snapshotFromConfig({ review: { auto: true } }).policyDigest).not.toBe(base)
    expect(ReviewPolicy.snapshotFromConfig({ review: { enabled: false } }).policyDigest).not.toBe(base)
    expect(ReviewPolicy.snapshotFromConfig({ review: { max_attempts: 9 } }).policyDigest).not.toBe(base)
    expect(ReviewPolicy.snapshotFromConfig({ review: { high_risk_patterns: ["secret"] } }).policyDigest).not.toBe(base)
  })
})
