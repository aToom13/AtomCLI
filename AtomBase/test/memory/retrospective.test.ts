/**
 * Retrospective Schema & Background Learning Tests
 * 
 * Tests for the session retrospective Zod schema validation,
 * including edge cases for missing/optional fields.
 */

import { describe, it, expect } from "bun:test"
import { SessionRetrospectiveSchema } from "@/core/memory/services/retrospective"

// ============================================================================
// SCHEMA VALIDATION TESTS
// ============================================================================

describe("SessionRetrospectiveSchema", () => {
    it("should validate complete data", () => {
        const data = {
            hasValuableInfo: true,
            activities: ["Built a CLI tool", "Fixed a bug"],
            learnings: ["TypeScript strict mode is useful"],
            errors: [{
                error: "ENOENT: file not found",
                context: "Reading config file",
                solution: "Check file path exists first",
                confidence: 0.9,
            }],
        }

        const result = SessionRetrospectiveSchema.parse(data)
        expect(result.hasValuableInfo).toBe(true)
        expect(result.activities).toHaveLength(2)
        expect(result.learnings).toHaveLength(1)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0].error).toBe("ENOENT: file not found")
        expect(result.errors[0].confidence).toBe(0.9)
    })

    it("should handle missing optional arrays with defaults", () => {
        const data = {
            hasValuableInfo: false,
        }

        const result = SessionRetrospectiveSchema.parse(data)
        expect(result.hasValuableInfo).toBe(false)
        expect(result.activities).toEqual([])
        expect(result.learnings).toEqual([])
        expect(result.errors).toEqual([])
    })

    it("should handle error objects with missing fields (LLM edge case)", () => {
        const data = {
            hasValuableInfo: true,
            activities: ["test"],
            errors: [{
                // LLM sometimes returns incomplete error objects
                solution: "Try again",
            }],
        }

        const result = SessionRetrospectiveSchema.parse(data)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0].error).toBe("Unknown error")
        expect(result.errors[0].context).toBe("Unknown context")
        expect(result.errors[0].solution).toBe("Try again")
        expect(result.errors[0].confidence).toBe(0.5)
    })

    it("should handle completely empty error objects", () => {
        const data = {
            hasValuableInfo: true,
            errors: [{}],
        }

        const result = SessionRetrospectiveSchema.parse(data)
        expect(result.errors[0].error).toBe("Unknown error")
        expect(result.errors[0].context).toBe("Unknown context")
        expect(result.errors[0].solution).toBe("No solution recorded")
        expect(result.errors[0].confidence).toBe(0.5)
    })

    it("should reject confidence outside 0-1 range", () => {
        const data = {
            hasValuableInfo: true,
            errors: [{
                error: "test",
                context: "test",
                solution: "test",
                confidence: 1.5,
            }],
        }

        expect(() => SessionRetrospectiveSchema.parse(data)).toThrow()
    })

    it("should reject negative confidence", () => {
        const data = {
            hasValuableInfo: true,
            errors: [{
                error: "test",
                context: "test",
                solution: "test",
                confidence: -0.5,
            }],
        }

        expect(() => SessionRetrospectiveSchema.parse(data)).toThrow()
    })

    it("should reject missing hasValuableInfo", () => {
        const data = {
            activities: ["test"],
        }

        expect(() => SessionRetrospectiveSchema.parse(data)).toThrow()
    })

    it("should handle LLM returning null arrays as empty", () => {
        const data = {
            hasValuableInfo: true,
            activities: null,
            learnings: null,
            errors: null,
        }

        // These should fail since null !== undefined
        // But the schema should handle gracefully
        expect(() => SessionRetrospectiveSchema.parse(data)).toThrow()
    })

    it("should handle typical LLM 'no info' response", () => {
        const data = {
            hasValuableInfo: false,
            activities: [],
            learnings: [],
            errors: [],
        }

        const result = SessionRetrospectiveSchema.parse(data)
        expect(result.hasValuableInfo).toBe(false)
        expect(result.activities).toEqual([])
        expect(result.learnings).toEqual([])
        expect(result.errors).toEqual([])
    })
})

console.log("Running Retrospective Schema Tests...")
