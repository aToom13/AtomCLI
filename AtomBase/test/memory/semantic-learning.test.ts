/**
 * Semantic Learning Tests
 * 
 * Tests for LLM-based information extraction
 */

import { describe, it, expect } from "bun:test"
import { SemanticLearningService } from "@/core/memory/integration/semantic-learning"

describe("SemanticLearningService", () => {
  it("should detect questions", () => {
    expect(SemanticLearningService.isQuestion("What is my name?")).toBe(true)
    expect(SemanticLearningService.isQuestion("Benim adım ne?")).toBe(true)
    expect(SemanticLearningService.isQuestion("How are you?")).toBe(true)
    expect(SemanticLearningService.isQuestion("Nasılsın?")).toBe(true)
    expect(SemanticLearningService.isQuestion("Biliyor musun?")).toBe(true)
  })

  it("should not detect statements as questions", () => {
    expect(SemanticLearningService.isQuestion("My name is John")).toBe(false)
    expect(SemanticLearningService.isQuestion("Benim adım Akif")).toBe(false)
    expect(SemanticLearningService.isQuestion("I prefer TypeScript")).toBe(false)
  })

  // Note: Full LLM extraction tests would require mocking or actual API calls
  // These are integration tests that would run in a real environment
  
  it("should have extractUserInformation method", () => {
    expect(typeof SemanticLearningService.extractUserInformation).toBe("function")
  })

  it("should have analyzeAssistantResponse method", () => {
    expect(typeof SemanticLearningService.analyzeAssistantResponse).toBe("function")
  })
})
