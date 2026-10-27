import "../preload"
import { describe, expect, test } from "bun:test"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"

describe("ExecutionContract", () => {
  test("an excluded renderer does not turn a 2D game into a 3D requirement", () => {
    expect(ExecutionContract.acceptanceFor("Build a 2D browser game without WebGL")).toEqual([])
  })
  test.each([
    ["Build a 3D browser game using WebGL", true],
    ["Build a 3D browser game without WebGL", false],
    ["Repair the 3D browser game; WebGL is not required", false],
    ["Repair the 3D browser game; WebGL is not an extra requirement", false],
  ])("renderer acceptance follows explicit requirements: %s", (prompt, required) => {
    const acceptance = ExecutionContract.acceptanceFor(prompt)
    expect(acceptance.some((item) => item.startsWith("Renderer:"))).toBe(required)
    expect(acceptance.some((item) => item.startsWith("3D:"))).toBe(true)
  })
  test("uses focused conservative scope for normal agents", () => {
    expect(ExecutionContract.conservativeScope("agent")).toBe("focused")
    expect(ExecutionContract.conservativeScope("build")).toBe("focused")
    expect(ExecutionContract.conservativeScope("plan")).toBe("focused")
    expect(ExecutionContract.conservativeScope("explore")).toBe("focused")
    expect(ExecutionContract.conservativeScope("reviewer")).toBe("direct")
  })

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
    expect(policy.budget.maxRetries).toBe(1)
    expect(policy.budget.allowTaskflow).toBe(false)
    expect(policy.budget.allowSubagents).toBe(false)
    expect(policy.allowedTools).toEqual(["read"])
    expect(policy.diagnostics).toEqual([])
  })

  test("reports contradictory mutation capability instead of silently accepting it", () => {
    const contract = ExecutionContract.fallback("test", {
      intent: "change",
      scope: "focused",
      needsMutation: true,
    })
    const diagnostics = ExecutionPolicy.detectContradictions({
      contract,
      budget: ExecutionPolicy.BUDGETS.focused,
      allowedTools: ["read", "grep"],
    })
    expect(diagnostics).toContain("mutation_required_but_tools_exclude_edit_write")
    const design = { ...contract, intent: "design" as const }
    expect(
      ExecutionPolicy.detectContradictions({
        contract: design,
        budget: ExecutionPolicy.BUDGETS.focused,
        allowedTools: ["read", "grep"],
      }),
    ).toContain("mutation_required_but_tools_exclude_edit_write")
  })

  test("design work gets edit tools only when it changes workspace", () => {
    const create = ExecutionContract.fallback("design", { intent: "design", needsMutation: true })
    const review = { ...create, needsMutation: false }
    expect(ExecutionPolicy.resolvePolicy(create).allowedTools).toContain("edit")
    expect(ExecutionPolicy.resolvePolicy(create).allowedTools).toContain("write")
    expect(ExecutionPolicy.resolvePolicy(review).allowedTools).not.toContain("edit")
    expect(ExecutionPolicy.selectAllowedTools("direct", "design", [], false)).not.toContain("write")
  })

  test("focused + critical retains risk without requiring a reviewer", () => {
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

  test("localized public API or schema effects raise risk without growing scope", () => {
    const contract = ExecutionContract.parseSafe({
      intent: "change",
      scope: "focused",
      risk: "elevated",
      confidence: 0.9,
      needsMutation: true,
      expectedSurfaces: ["workspace"],
    })
    for (const evidence of [{ hasPublicApiEffect: true }, { hasSchemaOrMigrationEffect: true }]) {
      const policy = ExecutionPolicy.resolvePolicy(contract, { filesChanged: ["one.ts"], ...evidence })
      expect(policy.scope).toBe("focused")
      expect(policy.risk).toBe("critical")
      expect(policy.budget.allowSubagents).toBe(false)
      const promoted = ExecutionPolicy.resolvePolicy(
        { ...contract, scope: "direct" },
        { filesChanged: ["one.ts"], ...evidence },
      )
      expect(promoted.scope).toBe("focused")
      expect(promoted.risk).toBe("critical")
    }
  })

  test("focused tools retain durable taskflow control", () => {
    expect(ExecutionPolicy.selectAllowedTools("focused", "change")).not.toContain("taskflow")
    expect(ExecutionPolicy.selectAllowedTools("focused", "change")).toContain("bash")
    expect(ExecutionPolicy.selectAllowedTools("focused", "change")).not.toContain("agent")
    expect(ExecutionPolicy.selectAllowedTools("direct", "inspect")).not.toContain("taskflow")
    expect(ExecutionPolicy.selectAllowedTools("direct", "inspect")).not.toContain("agent")
    expect(ExecutionPolicy.selectAllowedTools("direct", "change")).not.toContain("agent")
    expect(ExecutionPolicy.selectAllowedTools("direct", "answer")).toEqual(["read"])
  })

  test("focused browser work keeps browser and skill tools available", () => {
    const tools = ExecutionPolicy.selectAllowedTools("focused", "change", ["browser"])
    expect(tools).toContain("browser")
    expect(tools).toContain("skill")
    expect(tools).not.toContain("taskflow")
  })

  test("normal-model visibility matrix matches the target architecture", () => {
    const direct = ExecutionPolicy.selectAllowedTools("direct", "change")!
    expect(direct).not.toContain("todo")
    expect(direct).not.toContain("agent")
    expect(direct).not.toContain("taskflow")
    expect(direct).not.toContain("orchestrate")

    const focused = ExecutionPolicy.selectAllowedTools("focused", "change")!
    // taskflow/orchestrate stay hidden from the normal surface; `todo` is added
    // separately only when the prompt asks for a checklist.
    expect(focused).not.toContain("taskflow")
    expect(focused).not.toContain("orchestrate")
    expect(focused).not.toContain("agent")

    const coordinated = ExecutionPolicy.selectAllowedTools("coordinated", "change")!
    expect(coordinated).toContain("todo")
    expect(coordinated).toContain("agent")
    expect(coordinated).not.toContain("taskflow")
    expect(coordinated).not.toContain("orchestrate")

    // Real work tools are never stripped by the coordination hiding rules.
    expect(direct).toContain("edit")
    expect(focused).toContain("bash")
    expect(coordinated).toContain("edit")
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
