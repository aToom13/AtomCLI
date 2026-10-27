import "../preload"
import { describe, expect, test, beforeEach, spyOn } from "bun:test"
import { ExecutionClassifier } from "@/core/routing/execution-classifier"
import { TaskProfile } from "@/core/routing/task-profile"
import { ExecutionContract } from "@/core/routing/execution-contract"
import * as AICompat from "@/util/util/ai-compat"

describe("ExecutionClassifier", () => {
  test.each(["Uygulamayı değiştirme, sadece incele", "don't change anything, just review"])(
    "keeps genuinely read-only requests non-mutating: %s",
    async (prompt) => {
      const { ExecutionPolicy } = await import("@/core/routing/execution-policy")
      const { contract } = await ExecutionClassifier.classify({ prompt })
      expect(contract.needsMutation).toBe(false)
      const policy = ExecutionPolicy.resolvePolicy(contract)
      expect(policy.allowedTools).not.toContain("edit")
      expect(policy.allowedTools).not.toContain("write")
    },
  )

  test.each([
    "eval-fixtures/test-authoring/slugify.ts için henüz test yok. README içinde belgelenen her davranışı kapsayan regresyon testlerini eval-fixtures/test-authoring/slugify.test.ts dosyasına yaz. Uygulamayı değiştirme. Testleri çalıştır; başarısızlık varsa düzeltip yeniden çalıştır. Yalnız Bun ve bun:test kullan; testi bun test ile çalıştır. npm/npx/yarn/pnpm kullanma, bağımlılık kurma.",
    "Don't modify the app, write tests in app.test.ts",
  ])("keeps write/edit available when only implementation changes are forbidden: %s", async (prompt) => {
    const { ExecutionPolicy } = await import("@/core/routing/execution-policy")
    const { contract } = await ExecutionClassifier.classify({ prompt })
    expect(contract).toMatchObject({ intent: "change", needsMutation: true })
    const policy = ExecutionPolicy.resolvePolicy(contract)
    expect(policy.allowedTools).toContain("edit")
    expect(policy.allowedTools).toContain("write")
  })

  test("classifies locally without invoking the provider or spending a model call", async () => {
    const generate = spyOn(AICompat, "getGenerateObject").mockImplementation(() => {
      throw new Error("unexpected model call")
    })
    try {
      const result = await ExecutionClassifier.classify({ prompt: "Implement an auth migration across the monorepo" })
      expect(result).toMatchObject({
        fallback: false,
        contract: { scope: "coordinated", risk: "critical", needsMutation: true },
      })
      expect(generate).not.toHaveBeenCalled()
    } finally {
      generate.mockRestore()
    }
  })

  test("localized high-risk work remains focused and shares the routing risk", async () => {
    const prompt = "Implement a database migration in one file"
    const result = await ExecutionClassifier.classify({ prompt })
    expect(result.contract.scope).toBe("focused")
    expect(result.contract.risk).toBe(TaskProfile.infer(prompt).risk)
    expect(result.contract.risk).toBe("critical")
  })

  test.each(["browser flow", "browser navigation", "input_sequence"])(
    "%s requests retain native browser capability",
    (operation) => {
      const contract = ExecutionClassifier.enforceComplexity(
        `Build a tiny browser counter. One bounded ${operation} should launch, click, assert score, reset, assert zero.`,
        ExecutionContract.fallback("test", { expectedSurfaces: ["workspace"] }),
      )
      expect(contract.expectedSurfaces).toContain("browser")
      expect(contract.needsExternalAction).toBe(true)
    },
  )
  test("read-only browser flows remain available without redundant action keywords", () => {
    const contract = ExecutionClassifier.enforceComplexity(
      "Perform current static_check, then a few native browser flows navigating localhost. Use actual keys, quarter-turn, rendered player, and reset. This turn is read-only.",
      ExecutionContract.parseSafe({
        intent: "inspect",
        scope: "focused",
        confidence: 0.9,
        needsMutation: false,
        expectedSurfaces: ["workspace"],
      }),
    )
    expect(contract.expectedSurfaces).toContain("browser")
    expect(contract.needsExternalAction).toBe(true)
    expect(contract.needsMutation).toBe(false)
  })
  test("explicit shell execution retains Bash capability", () => {
    const contract = ExecutionClassifier.enforceComplexity(
      'Run bash command "false; echo misleading-success" unchanged once as an intentional failing verifier.',
      ExecutionContract.parseSafe({ intent: "operate", scope: "direct", confidence: 0.9, needsMutation: false }),
    )
    expect(contract.scope).toBe("focused")
    expect(contract.expectedSurfaces).toContain("system")
    expect(contract.needsMutation).toBe(false)
  })
  test("3D gameplay acceptance exists before the first mutation", async () => {
    const { contract } = await ExecutionClassifier.classify({
      prompt: "Build a functional 3D browser game with camera movement and collision using WebGL",
    })
    expect(contract.acceptance?.join(" ")).toMatch(/projection/)
    expect(contract.acceptance?.join(" ")).toMatch(/camera/i)
    expect(contract.acceptance?.join(" ")).toMatch(/collision/i)
    expect(contract.acceptance?.join(" ")).toMatch(/progression/)
    expect(contract.acceptance?.join(" ")).toMatch(/WebGL/)
    expect(contract.acceptance?.join(" ")).toMatch(/real browser pointer\/keyboard input/)
    expect(contract.acceptance?.join(" ")).toMatch(/DOM \.click\(\).*not input proof/)
  })
  beforeEach(() => {
    ExecutionClassifier.clearCache()
  })

  test("explicit browser runtime QA retains browser tools while remaining read-only", async () => {
    const result = await ExecutionClassifier.classify({
      prompt:
        "Inspect index.html using the browser tool. Navigate its file URL, click Increment, collect console_logs. No source edits.",
    })
    expect(result.contract.expectedSurfaces).toContain("browser")
    expect(result.contract.needsExternalAction).toBe(true)
    expect(result.contract.needsMutation).toBe(false)
    expect(result.contract.scope).toBe("focused")
  })

  test("uses deterministic classification when no model is needed", async () => {
    const result = await ExecutionClassifier.classify({
      prompt: "Explain what is recursion",
    })
    expect(result.fallback).toBe(false)
    expect(result.contract.scope).toBe("direct")
    expect(result.contract.risk).toBe("low")
  })

  test("uses direct fast path for greetings and simple explanations", async () => {
    const greeting = await ExecutionClassifier.classify({ prompt: "Hello" })
    expect(greeting.contract.scope).toBe("direct")
    expect(greeting.contract.intent).toBe("answer")
    expect(greeting.fallback).toBe(false)

    const explanation = await ExecutionClassifier.classify({ prompt: "Explain recursion" })
    expect(explanation.contract.scope).toBe("direct")
    expect(explanation.contract.intent).toBe("answer")
    expect(explanation.fallback).toBe(false)
  })

  test("classifies workspace questions as read-only", async () => {
    const result = await ExecutionClassifier.classify({ prompt: "Explain the project architecture" })
    expect(result.fallback).toBe(false)
    expect(result.contract.scope).toBe("focused")
    expect(result.contract.intent).toBe("inspect")
    expect(result.contract.needsMutation).toBe(false)
    expect(result.contract.needsDiscovery).toBe(true)
  })

  test("keeps broad game questions read-only", async () => {
    const conceptual = await ExecutionClassifier.classify({ prompt: "Analyze a complete 3D game design" })
    expect(conceptual).toMatchObject({ fallback: false, contract: { intent: "answer", scope: "direct" } })
    expect(conceptual.contract.needsMutation).toBe(false)

    const repository = await ExecutionClassifier.classify({ prompt: "Review the complete browser game in this repo" })
    expect(repository).toMatchObject({ fallback: false, contract: { intent: "inspect", scope: "focused" } })
    expect(repository.contract.needsMutation).toBe(false)

    const mixed = await ExecutionClassifier.classify({ prompt: "Inspect the game and then fix its collision bug" })
    expect(mixed.contract.needsMutation).toBe(true)
    const comma = await ExecutionClassifier.classify({ prompt: "Review this code, fix the collision bug" })
    expect(comma.contract.needsMutation).toBe(true)
  })

  test("caches results by invocationID or prompt", async () => {
    const prompt = "Explain recursion"
    const first = await ExecutionClassifier.classify({ prompt })
    expect(first.cached).toBe(false)

    const second = await ExecutionClassifier.classify({ prompt })
    expect(second.cached).toBe(true)
    expect(second.contract).toEqual(first.contract)
  })

  test("cache can be cleared", async () => {
    const prompt = "Fix bug in auth"
    await ExecutionClassifier.classify({ prompt })
    ExecutionClassifier.clearCache()

    const third = await ExecutionClassifier.classify({ prompt })
    expect(third.cached).toBe(false)
  })

  test("does not reuse a classification across scope-floor changes", async () => {
    const first = await ExecutionClassifier.classify({ prompt: "Explain recursion", scopeFloor: "direct" })
    const second = await ExecutionClassifier.classify({ prompt: "Explain recursion", scopeFloor: "focused" })
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(false)
    expect(second.contract.scope).toBe("focused")
  })

  test("promotes complete interactive browser games to coordinated scope", () => {
    const result = ExecutionClassifier.enforceComplexity(
      "Using HTML, CSS and JS, create a complete browser OS with five apps and two functional 3D games",
      {
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
        rationale: "classifier result",
      },
    )
    expect(result.scope).toBe("coordinated")
    expect(result.expectedSurfaces).toContain("browser")
    expect(result.needsDiscovery).toBe(true)
  })

  test("preserves browser verification when model already selected coordinated scope", () => {
    const result = ExecutionClassifier.enforceComplexity(
      "Create a complete browser OS with five apps and two 3D games",
      {
        intent: "change",
        scope: "coordinated",
        risk: "low",
        confidence: 0.9,
        deliverables: [],
        expectedSurfaces: ["workspace"],
        assumptions: [],
        uncertainty: "low",
        needsDiscovery: false,
        needsMutation: true,
        needsExternalAction: false,
        likelyCrossBoundary: false,
        rationale: "classifier result",
      },
    )
    expect(result.scope).toBe("coordinated")
    expect(result.risk).toBe("elevated")
    expect(result.expectedSurfaces).toContain("browser")
  })
})
