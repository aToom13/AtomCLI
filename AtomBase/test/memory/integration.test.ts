/**
 * Memory Integration Tests
 *
 * Tests for session memory integration
 */

// MUST be the first import: memory services capture Global.Path.root at first
// construction, which reads ATOMCLI_TEST_HOME. Static imports hoist above
// everything else, so this module body runs before any src/ module evaluates.
import "./setup-home"

import { describe, it, expect, spyOn } from "bun:test"
import { SessionMemoryIntegration } from "@/core/memory/integration/session"
import { SemanticLearningService } from "@/core/memory/integration/semantic-learning"
import { getUserProfile } from "@/core/memory/services/user-profile"
import { getPreferencesService } from "@/core/memory/services/preferences"

describe("SessionMemoryIntegration", () => {
  it("should initialize memory system", async () => {
    await SessionMemoryIntegration.initialize()

    const profile = await getUserProfile().getProfile()
    expect(profile).toBeDefined()
    expect(profile.techLevel).toBeDefined()
    expect(["beginner", "junior", "mid", "senior", "expert"]).toContain(profile.techLevel)
  })

  it("forwards the active session model to semantic memory learning", async () => {
    const model = { providerID: "selected-provider", modelID: "selected-model" }
    const extract = spyOn(SemanticLearningService, "extractUserInformation").mockResolvedValue({
      hasInformation: false,
    })
    const analyze = spyOn(SemanticLearningService, "analyzeAssistantResponse").mockResolvedValue({})
    try {
      await SessionMemoryIntegration.learnFromMessage("I prefer concise answers", model)
      await SessionMemoryIntegration.learnFromResponse("Understood", "I prefer concise answers", model)
      expect(extract).toHaveBeenCalledWith("I prefer concise answers", expect.any(Object), model)
      expect(analyze).toHaveBeenCalledWith("Understood", "I prefer concise answers", model)
    } finally {
      extract.mockRestore()
      analyze.mockRestore()
    }
  })

  it("does not spend a model request on ordinary task instructions", async () => {
    const extract = spyOn(SemanticLearningService, "extractUserInformation").mockResolvedValue({
      hasInformation: false,
    })
    try {
      await SessionMemoryIntegration.learnFromMessage("Provider dosyalarını incele ve testleri çalıştır")
      expect(extract).not.toHaveBeenCalled()
    } finally {
      extract.mockRestore()
    }
  })

  it("detects explicit durable memory requests without matching ordinary commands", () => {
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("I prefer concise answers")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Benim adım Ahmet, bunu unutma")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("From now on, use Bun for this project")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Dosyayı düzelt ve testleri çalıştır")).toBe(false)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Bu dosyayı değiştirme")).toBe(false)
  })

  it("catches durable prohibitions, project conventions and indirect preferences", () => {
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Artık npm kullanma, her yerde bun kullan")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Never commit directly to main")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Bu projede testleri her zaman bun ile çalıştır")).toBe(
      true,
    )
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("In this project never use any")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Bana bundan sonra kısa yanıt ver")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Bana türkçe yanıt ver")).toBe(true)
    // Turkish İ normalizes through the U+0307 strip without breaking matching
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("İstanbul'da yaşıyorum, bunu unutma")).toBe(true)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("npm kullanmadan çalışır mı bu?")).toBe(false)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("stop fonksiyonu nerede")).toBe(false)
    expect(SessionMemoryIntegration.hasExplicitMemorySignal("Bu klasördeki dosyaları silme")).toBe(false)
  })

  it("parses JSON payloads from fenced and prose-wrapped LLM output", () => {
    const parse = SemanticLearningService.parseJsonPayload
    expect(parse('{"hasInformation": true}')).toEqual({ hasInformation: true })
    expect(parse('```json\n{"hasInformation": true}\n```')).toEqual({ hasInformation: true })
    expect(parse('Here you go:\n{"hasInformation": false}\nHope that helps!')).toEqual({ hasInformation: false })
    expect(parse("no structured content at all")).toBeNull()
    expect(parse("{broken json")).toBeNull()
  })

  it.skip("should learn user name from message", async () => {
    // NOTE: This test requires actual LLM API calls
    // Run manually with: bun test --only "should learn user name from message"
    await SessionMemoryIntegration.initialize()

    await SessionMemoryIntegration.learnFromMessage("Benim adım Ahmet")

    const profile = await getUserProfile().getProfile()
    expect(profile.name).toBe("Ahmet")
  })

  it.skip("should learn user name from English message", async () => {
    // NOTE: This test requires actual LLM API calls
    await SessionMemoryIntegration.initialize()

    await SessionMemoryIntegration.learnFromMessage("My name is John")

    // Force reload to get fresh data
    const profile = await getUserProfile().getProfile(true)
    expect(profile.name).toBe("John")
  })

  it.skip("should learn from assistant response", async () => {
    // NOTE: This test requires actual LLM API calls
    await SessionMemoryIntegration.initialize()

    // Simulate AI acknowledging a name
    await SessionMemoryIntegration.learnFromResponse("Tamam, adın Mehmet olarak kayıtlı.")

    const profile = await getUserProfile().getProfile(true)
    expect(profile.name).toBe("Mehmet")
  })

  it.skip("should process conversation turn", async () => {
    // NOTE: This test requires actual LLM API calls
    await SessionMemoryIntegration.initialize()

    await SessionMemoryIntegration.processConversationTurn(
      "Benim adım Ayşe",
      "Merhaba Ayşe! Nasıl yardımcı olabilirim?",
    )

    const profile = await getUserProfile().getProfile(true)
    expect(profile.name).toBe("Ayşe")
    expect(profile.totalInteractions).toBeGreaterThan(0)
  })

  it.skip("should get user context", async () => {
    // NOTE: This test requires actual LLM API calls
    await SessionMemoryIntegration.initialize()
    await SessionMemoryIntegration.learnFromMessage("My name is Alice")

    const context = await SessionMemoryIntegration.getUserContext()

    expect(context).toContain("Alice")
    expect(context).toContain("Tech Level")
    expect(context).toContain("Communication Style")
  })

  it("should learn code style from TypeScript code", async () => {
    await SessionMemoryIntegration.initialize()

    const code = `
function hello() {
  const name = "world";
  console.log("Hello, " + name);
}
`

    await SessionMemoryIntegration.learnCodeStyle(code, "typescript")

    const prefs = getPreferencesService()
    const indentStyle = await prefs.get("code_style", "indent_style")
    const indentSize = await prefs.get("code_style", "indent_size")
    const quoteStyle = await prefs.get("code_style", "quote_style")
    const semicolons = await prefs.get("code_style", "semicolons")

    expect(indentStyle?.value).toBe("space")
    // Regression: the string starts with "\n"; horizontal-only matching must
    // report the real 2-space indentation instead of swallowing that newline.
    expect(indentSize?.value).toBe(2)
    expect(quoteStyle?.value).toBe("double")
    expect(semicolons?.value).toBe(true)
  })

  it("should track project work", async () => {
    await SessionMemoryIntegration.initialize()

    await SessionMemoryIntegration.trackProject("MyProject")

    const profile = await getUserProfile().getProfile()
    expect(profile.recentlyWorkedOn).toContain("MyProject")
  })

  it("should add interests", async () => {
    await SessionMemoryIntegration.initialize()

    await SessionMemoryIntegration.addInterest("React")
    await SessionMemoryIntegration.addInterest("TypeScript")

    const profile = await getUserProfile().getProfile()
    expect(profile.interests).toContain("React")
    expect(profile.interests).toContain("TypeScript")
  })

  it("should get style guide", async () => {
    await SessionMemoryIntegration.initialize()

    const styleGuide = await SessionMemoryIntegration.getStyleGuide()

    expect(styleGuide).toBeDefined()
    expect(styleGuide.indent).toBeDefined()
    expect(styleGuide.quotes).toBeDefined()
  })
})
