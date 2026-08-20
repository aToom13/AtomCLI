import { describe, expect, test } from "bun:test"
import { TaskProfile } from "@/core/routing/task-profile"

describe("TaskProfile", () => {
  test("detects browser, vision, planning, and risk requirements", () => {
    const profile = TaskProfile.infer("Kapsamlı auth ekranını browser ile screenshot alarak düzelt", "coding")
    expect(profile).toMatchObject({
      category: "coding",
      needsBrowser: true,
      needsVision: true,
      needsPlanning: true,
      risk: "high",
      needsTools: true,
    })
  })

  test("keeps evidence-only inspection read-only", () => {
    const profile = TaskProfile.infer("Auth kodunu incele ve testleri bul, dosyaları değiştirme")
    expect(profile.readOnly).toBe(true)
    expect(profile.category).toBe("analysis")
    expect(profile.needsTools).toBe(true)
  })

  test.each([
    "Review the repository implementation and tests without changing files",
    "Provider kodunu incele ve dosyaları değiştirme",
  ])("treats repository inspection as tool-using analysis: %s", (prompt) => {
    expect(TaskProfile.infer(prompt)).toMatchObject({
      category: "analysis",
      readOnly: true,
      needsTools: true,
    })
  })

  test("does not confuse an explicit mutation request with read-only inspection", () => {
    expect(TaskProfile.infer("Auth kodunu incele, sonra hatayı düzelt ve test et")).toMatchObject({
      category: "coding",
      readOnly: false,
      needsTools: true,
      risk: "high",
    })
  })
})
