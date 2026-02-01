/**
 * Memory Integration Tests
 * 
 * Tests for session memory integration
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { SessionMemoryIntegration } from "../../src/memory/integration/session"
import { getUserProfile } from "../../src/memory/services/user-profile"
import { getPreferencesService } from "../../src/memory/services/preferences"
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
      "Merhaba Ayşe! Nasıl yardımcı olabilirim?"
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
