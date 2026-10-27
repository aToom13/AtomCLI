import "../preload"
import { describe, expect, test } from "bun:test"
import { TaskProfile } from "@/core/routing/task-profile"

describe("TaskProfile", () => {
  test.each([
    "Uygulamayı değiştirme. Test dosyasına yaz.",
    "Test dosyasına yaz. Uygulamayı değiştirme.",
    "Kodunu incele ve uygulamayı değiştirme; regresyon testlerini dosyaya yaz.",
    "Don't modify the app, write tests",
    "Do not change the app. In tests/app.test.ts write regression tests.",
    "Don’t edit the app; write tests instead.",
    "Review the app without changing it, then write tests.",
    "Review the app. Add tests without changing the implementation.",
    "Uygulamayı değiştirme.",
    "Do not modify the app.",
  ])("retains mutation tools for mixed or ambiguous requests: %s", (prompt) => {
    expect(TaskProfile.isReadOnly(prompt)).toBe(false)
  })

  test.each([
    "Uygulamayı değiştirme, sadece incele",
    "don't change anything, just review",
    "Uygulamayı incele; dosyaları değiştirme, test yazma.",
    "Review the app, don't modify it. Don't write tests.",
    "Inspect the implementation without changing files.",
    "README dosyasını oku; uygulamayı değiştirme.",
  ])("recognizes explicit inspection with negated mutation: %s", (prompt) => {
    expect(TaskProfile.isReadOnly(prompt)).toBe(true)
  })

  test("detects browser, vision, planning, and risk requirements", () => {
    const profile = TaskProfile.infer("Kapsamlı auth ekranını browser ile screenshot alarak düzelt", "coding")
    expect(profile).toMatchObject({
      category: "coding",
      needsBrowser: true,
      needsVision: true,
      needsPlanning: true,
      risk: "critical",
      needsTools: true,
    })
  })

  test("keeps evidence-only inspection read-only", () => {
    const profile = TaskProfile.infer("Auth kodunu incele ve testleri bul, dosyaları değiştirme")
    expect(profile.readOnly).toBe(true)
    expect(profile.category).toBe("analysis")
    expect(profile.needsTools).toBe(true)
  })

  test("keeps casual conversation tool-free", () => {
    expect(TaskProfile.infer("Selam, naber?").needsTools).toBe(false)
  })

  test("recognizes current-information requests as browser tasks", () => {
    expect(TaskProfile.infer("Bugünkü hava durumu nasıl?")).toMatchObject({
      needsBrowser: true,
      needsTools: true,
    })
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
      risk: "critical",
    })
  })
})
