/**
 * Memory Integration Tests
 *
 * Tests for session memory integration
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { SessionMemoryIntegration } from "@/core/memory/integration/session"
import { SemanticLearningService } from "@/core/memory/integration/semantic-learning"
import { getUserProfile } from "@/core/memory/services/user-profile"
import { getPreferencesService } from "@/core/memory/services/preferences"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testDir = path.join(os.tmpdir(), "atomcli-memory-integration-test")

describe("SessionMemoryIntegration", () => {
  beforeEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

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
    const quoteStyle = await prefs.get("code_style", "quote_style")
    const semicolons = await prefs.get("code_style", "semicolons")

    expect(indentStyle?.value).toBe("space")
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
