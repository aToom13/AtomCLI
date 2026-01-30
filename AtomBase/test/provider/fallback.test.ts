import { describe, it, expect } from "bun:test"
import { ModelFallback } from "../../src/provider/fallback"

describe("ModelFallback", () => {
  describe("shouldFallback", () => {
    it("should return true for rate limit errors", () => {
      const error = new Error("Rate limit exceeded")
      expect(ModelFallback.shouldFallback(error)).toBe(true)
    })

    it("should return true for 429 errors", () => {
      const error = new Error("HTTP 429: Too Many Requests")
      expect(ModelFallback.shouldFallback(error)).toBe(true)
    })

    it("should return true for service unavailable errors", () => {
      const error = new Error("Service unavailable")
      expect(ModelFallback.shouldFallback(error)).toBe(true)
    })

    it("should return true for timeout errors", () => {
      const error = new Error("Connection timeout")
      expect(ModelFallback.shouldFallback(error)).toBe(true)
    })

    it("should return true for overloaded errors", () => {
      const error = new Error("Server overloaded")
      expect(ModelFallback.shouldFallback(error)).toBe(true)
    })

    it("should return false for non-fallback errors", () => {
      const error = new Error("Invalid API key")
      expect(ModelFallback.shouldFallback(error)).toBe(false)
    })

    it("should return false for syntax errors", () => {
      const error = new Error("SyntaxError: Unexpected token")
      expect(ModelFallback.shouldFallback(error)).toBe(false)
    })
  })

  describe("getRecommendedFallbacks", () => {
    it("should recommend fallbacks for Claude models", () => {
      const mockModel = {
        id: "claude-3-sonnet",
        providerID: "anthropic",
      } as any

      const fallbacks = ModelFallback.getRecommendedFallbacks(mockModel)
      
      expect(fallbacks.length).toBeGreaterThan(0)
      expect(fallbacks).toContain("openai/gpt-4")
    })

    it("should recommend fallbacks for GPT models", () => {
      const mockModel = {
        id: "gpt-4",
        providerID: "openai",
      } as any

      const fallbacks = ModelFallback.getRecommendedFallbacks(mockModel)
      
      expect(fallbacks.length).toBeGreaterThan(0)
      expect(fallbacks).toContain("anthropic/claude-sonnet")
    })

    it("should recommend fallbacks for Gemini models", () => {
      const mockModel = {
        id: "gemini-pro",
        providerID: "google",
      } as any

      const fallbacks = ModelFallback.getRecommendedFallbacks(mockModel)
      
      expect(fallbacks.length).toBeGreaterThan(0)
    })

    it("should return default fallbacks for unknown models", () => {
      const mockModel = {
        id: "unknown-model",
        providerID: "unknown",
      } as any

      const fallbacks = ModelFallback.getRecommendedFallbacks(mockModel)
      
      expect(fallbacks.length).toBeGreaterThan(0)
    })
  })

  describe("FallbackChain interface", () => {
    it("should define chain structure", () => {
      const mockModel = {
        id: "test-model",
        providerID: "test",
      } as any

      const chain: ModelFallback.FallbackChain = {
        primary: mockModel,
        secondary: { ...mockModel, id: "secondary-model" } as any,
        tertiary: { ...mockModel, id: "tertiary-model" } as any,
      }

      expect(chain.primary).toBeDefined()
      expect(chain.secondary).toBeDefined()
      expect(chain.tertiary).toBeDefined()
    })

    it("should support optional callbacks", () => {
      const mockModel = {
        id: "test-model",
        providerID: "test",
      } as any

      const chain: ModelFallback.FallbackChain = {
        primary: mockModel,
        onError: (error, model, attempt) => {
          console.log(`Error on ${model.id}, attempt ${attempt}`)
        },
        onSwitch: (from, to) => {
          console.log(`Switching from ${from.id} to ${to.id}`)
        },
      }

      expect(chain.onError).toBeDefined()
      expect(chain.onSwitch).toBeDefined()
    })
  })
})
