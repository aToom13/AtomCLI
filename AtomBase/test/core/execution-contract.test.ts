import "../preload"
import { describe, expect, test } from "bun:test"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"

describe("ExecutionContract", () => {
  test("parses valid contract", () => {
    const raw = {
      intent: "change",
      scope: "focused",
      risk: "elevated",
      confidence: 0.95,
      deliverables: ["fix bug in auth token parsing"],
      expectedSurfaces: ["workspace"],
      assumptions: ["unit test exists"],
      uncertainty: "low",
      needsDiscovery: false,
      needsMutation: true,
      needsExternalAction: false,
      likelyCrossBoundary: false,
      rationale: "Single file fix",
    }
    const contract = ExecutionContract.parseSafe(raw)
    expect(contract.scope).toBe("focused")
    expect(contract.risk).toBe("elevated")
    expect(contract.confidence).toBe(0.95)
    expect(contract.needsMutation).toBe(true)
  })

  test("falls back safely on invalid input", () => {
    const fallback = ExecutionContract.parseSafe({ invalid: true, scope: "unknown" })
    expect(fallback.scope).toBe("focused")
    expect(fallback.risk).toBe("elevated")
    expect(fallback.confidence).toBe(0)
    expect(fallback.rationale).toContain("invalid_classifier_output")
  })

  test("falls back safely on null or non-object", () => {
    const fallback = ExecutionContract.parseSafe(null)
    expect(fallback.scope).toBe("focused")
    expect(fallback.risk).toBe("elevated")
    expect(fallback.confidence).toBe(0)
  })
})

describe("ExecutionPolicy", () => {
  test("direct pipeline sets tight bounds and tool restrictions", () => {
    const contract: ExecutionContract.Info = {
      intent: "answer",
      scope: "direct",
      risk: "low",
      confidence: 1,
      deliverables: ["answer query"],
      expectedSurfaces: ["conversation"],
      assumptions: [],
      uncertainty: "low",
      needsDiscovery: false,
      needsMutation: false,
      needsExternalAction: false,
      likelyCrossBoundary: false,
      rationale: "Simple question",
    }
    const policy = ExecutionPolicy.resolvePolicy(contract)
    expect(policy.budget.maxSteps).toBe(2)
    expect(policy.budget.maxToolCalls).toBe(3)
    expect(policy.budget.allowTaskflow).toBe(false)
    expect(policy.budget.allowSubagents).toBe(false)
    expect(policy.allowedTools).toEqual([])
  })

  test("focused + critical retains critical risk and reviewer requirements", () => {
    const contract: ExecutionContract.Info = {
      intent: "change",
      scope: "focused",
      risk: "critical",
      confidence: 0.9,
      deliverables: ["fix auth permission check"],
      expectedSurfaces: ["workspace"],
      assumptions: [],
      uncertainty: "low",
      needsDiscovery: false,
      needsMutation: true,
      needsExternalAction: false,
      likelyCrossBoundary: false,
      rationale: "Auth permission fix",
    }
    const policy = ExecutionPolicy.resolvePolicy(contract)
    expect(policy.scope).toBe("focused")
    expect(policy.risk).toBe("critical")
    expect(policy.budget.maxSteps).toBe(6)
    expect(policy.requiresReview).toBe(true)
  })

  test("runtime evidence promotes direct to focused on multiple reads", () => {
    const contract: ExecutionContract.Info = {
      intent: "inspect",
      scope: "direct",
      risk: "low",
      confidence: 1,
      deliverables: [],
      expectedSurfaces: ["workspace"],
      assumptions: [],
      uncertainty: "low",
      needsDiscovery: false,
      needsMutation: false,
      needsExternalAction: false,
      likelyCrossBoundary: false,
      rationale: "inspect",
    }
    const policy = ExecutionPolicy.resolvePolicy(contract, {
      filesRead: ["a.ts", "b.ts"],
    })
    expect(policy.scope).toBe("focused")
    expect(policy.promotionReasons).toContain("Multiple files read required")
  })

  test("runtime evidence promotes focused to coordinated on cross-package change", () => {
    const contract: ExecutionContract.Info = {
      intent: "change",
      scope: "focused",
      risk: "elevated",
      confidence: 0.9,
      deliverables: [],
      expectedSurfaces: ["workspace"],
      assumptions: [],
      uncertainty: "low",
      needsDiscovery: false,
      needsMutation: true,
      needsExternalAction: false,
      likelyCrossBoundary: false,
      rationale: "change",
    }
    const policy = ExecutionPolicy.resolvePolicy(contract, {
      packagesTouched: ["core", "server"],
      hasPublicApiEffect: true,
    })
    expect(policy.scope).toBe("coordinated")
    expect(policy.risk).toBe("critical")
    expect(policy.budget.allowTaskflow).toBe(true)
    expect(policy.promotionReasons).toContain("Cross-package boundary touched")
    expect(policy.promotionReasons).toContain("Public API surface modified")
  })

  test("focused tools retain durable taskflow control", () => {
    expect(ExecutionPolicy.selectAllowedTools("focused", "change")).toContain("taskflow")
    expect(ExecutionPolicy.selectAllowedTools("focused", "change")).toContain("bash")
    expect(ExecutionPolicy.selectAllowedTools("focused", "change")).not.toContain("agent")
    expect(ExecutionPolicy.selectAllowedTools("direct", "inspect")).not.toContain("taskflow")
    expect(ExecutionPolicy.selectAllowedTools("direct", "inspect")).not.toContain("agent")
    expect(ExecutionPolicy.selectAllowedTools("direct", "change")).not.toContain("agent")
    expect(ExecutionPolicy.selectAllowedTools("direct", "answer")).toEqual([])
  })

  test("prohibits scope and risk downgrades", () => {
    expect(ExecutionPolicy.canPromoteScope("coordinated", "focused")).toBe(false)
    expect(ExecutionPolicy.canPromoteScope("focused", "direct")).toBe(false)
    expect(ExecutionPolicy.canPromoteScope("direct", "focused")).toBe(true)
    expect(ExecutionPolicy.canPromoteScope("focused", "coordinated")).toBe(true)

    expect(ExecutionPolicy.canPromoteRisk("critical", "elevated")).toBe(false)
    expect(ExecutionPolicy.canPromoteRisk("elevated", "low")).toBe(false)
    expect(ExecutionPolicy.canPromoteRisk("low", "elevated")).toBe(true)
    expect(ExecutionPolicy.canPromoteRisk("elevated", "critical")).toBe(true)
  })
})
