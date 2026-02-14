import { describe, test, expect } from "bun:test"
import { _internals as orchestrateInternals } from "../../src/tool/orchestrate"
import { _internals as routerInternals } from "../../src/tool/model-router"
import { inferCategory } from "../../src/tool/model-router"
import type { TaskCategory } from "../../src/tool/model-router"

const { topologicalSort, getReadyTasks, hasFailedDependency, WORKFLOWS } = orchestrateInternals
const { scoreModel } = routerInternals

// ─── DAG Tests ───────────────────────────────────────────────

describe("orchestrate - topologicalSort", () => {
    test("sorts linear chain correctly", () => {
        const tasks = [
            { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
            { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
            { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["b"] },
        ]

        const sorted = topologicalSort(tasks)
        expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"))
        expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"))
    })

    test("sorts diamond DAG correctly", () => {
        const tasks = [
            { id: "root", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
            { id: "left", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
            { id: "right", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
            { id: "merge", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["left", "right"] },
        ]

        const sorted = topologicalSort(tasks)
        expect(sorted.indexOf("root")).toBeLessThan(sorted.indexOf("left"))
        expect(sorted.indexOf("root")).toBeLessThan(sorted.indexOf("right"))
        expect(sorted.indexOf("left")).toBeLessThan(sorted.indexOf("merge"))
        expect(sorted.indexOf("right")).toBeLessThan(sorted.indexOf("merge"))
    })

    test("independent tasks can appear in any order", () => {
        const tasks = [
            { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
            { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
            { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
        ]

        const sorted = topologicalSort(tasks)
        expect(sorted).toHaveLength(3)
        expect(sorted).toContain("a")
        expect(sorted).toContain("b")
        expect(sorted).toContain("c")
    })

    test("detects circular dependency", () => {
        const tasks = [
            { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["b"] },
            { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
        ]

        expect(() => topologicalSort(tasks)).toThrow("Circular dependency")
    })

    test("detects self-referencing dependency", () => {
        const tasks = [
            { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
        ]

        expect(() => topologicalSort(tasks)).toThrow("Circular dependency")
    })

    test("detects unknown dependency", () => {
        const tasks = [
            { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["nonexistent"] },
        ]

        expect(() => topologicalSort(tasks)).toThrow("unknown task")
    })
})

describe("orchestrate - getReadyTasks", () => {
    test("returns tasks with no dependencies", () => {
        const workflow = {
            id: "test",
            tasks: [
                { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
                { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
            ],
            results: {
                a: { status: "pending" as const },
                b: { status: "pending" as const },
            },
            status: "running" as const,
            createdAt: Date.now(),
        }

        const ready = getReadyTasks(workflow)
        expect(ready).toHaveLength(1)
        expect(ready[0].id).toBe("a")
    })

    test("returns dependent tasks when deps are completed", () => {
        const workflow = {
            id: "test",
            tasks: [
                { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
                { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] },
            ],
            results: {
                a: { status: "completed" as const },
                b: { status: "pending" as const },
            },
            status: "running" as const,
            createdAt: Date.now(),
        }

        const ready = getReadyTasks(workflow)
        expect(ready).toHaveLength(1)
        expect(ready[0].id).toBe("b")
    })

    test("returns multiple parallel-ready tasks", () => {
        const workflow = {
            id: "test",
            tasks: [
                { id: "root", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
                { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
                { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["root"] },
            ],
            results: {
                root: { status: "completed" as const },
                b: { status: "pending" as const },
                c: { status: "pending" as const },
            },
            status: "running" as const,
            createdAt: Date.now(),
        }

        const ready = getReadyTasks(workflow)
        expect(ready).toHaveLength(2)
        expect(ready.map(t => t.id).sort()).toEqual(["b", "c"])
    })

    test("does not return running tasks", () => {
        const workflow = {
            id: "test",
            tasks: [
                { id: "a", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: [] },
            ],
            results: {
                a: { status: "running" as const },
            },
            status: "running" as const,
            createdAt: Date.now(),
        }

        const ready = getReadyTasks(workflow)
        expect(ready).toHaveLength(0)
    })
})

describe("orchestrate - hasFailedDependency", () => {
    test("returns true when dependency failed", () => {
        const task = { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] }
        const workflow = {
            id: "test",
            tasks: [task],
            results: { a: { status: "failed" as const } },
            status: "running" as const,
            createdAt: Date.now(),
        }

        expect(hasFailedDependency(task, workflow)).toBe(true)
    })

    test("returns true when dependency was skipped", () => {
        const task = { id: "c", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["b"] }
        const workflow = {
            id: "test",
            tasks: [task],
            results: { b: { status: "skipped" as const } },
            status: "running" as const,
            createdAt: Date.now(),
        }

        expect(hasFailedDependency(task, workflow)).toBe(true)
    })

    test("returns false when dependencies completed", () => {
        const task = { id: "b", prompt: "", agent: "coder", category: "general" as TaskCategory, dependsOn: ["a"] }
        const workflow = {
            id: "test",
            tasks: [task],
            results: { a: { status: "completed" as const } },
            status: "running" as const,
            createdAt: Date.now(),
        }

        expect(hasFailedDependency(task, workflow)).toBe(false)
    })
})

// ─── Model Router Tests ──────────────────────────────────────

describe("model-router - scoreModel", () => {
    const baseModel = {
        id: "test-model",
        providerID: "test",
        api: { id: "test", url: "http://test", npm: "test" },
        name: "Test Model",
        capabilities: {
            temperature: true,
            reasoning: false,
            attachment: false,
            toolcall: true,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
        },
        cost: { input: 1, output: 3, cache: { read: 0.5, write: 1 } },
        limit: { context: 128000, output: 8192 },
        status: "active" as const,
        options: {},
        headers: {},
        release_date: "2025-01-01",
    }

    test("coding: scores higher with reasoning", () => {
        const withReasoning = { ...baseModel, capabilities: { ...baseModel.capabilities, reasoning: true } }
        const withoutReasoning = { ...baseModel }

        expect(scoreModel(withReasoning, "coding")).toBeGreaterThan(scoreModel(withoutReasoning, "coding"))
    })

    test("coding: requires toolcall", () => {
        const noToolcall = { ...baseModel, capabilities: { ...baseModel.capabilities, toolcall: false } }
        expect(scoreModel(noToolcall, "coding")).toBe(0)
    })

    test("documentation: higher context = higher score", () => {
        const longContext = { ...baseModel, limit: { ...baseModel.limit, context: 1000000 } }
        const shortContext = { ...baseModel, limit: { ...baseModel.limit, context: 32000 } }

        expect(scoreModel(longContext, "documentation")).toBeGreaterThan(scoreModel(shortContext, "documentation"))
    })

    test("analysis: reasoning is heavily weighted", () => {
        const withReasoning = { ...baseModel, capabilities: { ...baseModel.capabilities, reasoning: true } }
        const withoutReasoning = { ...baseModel }

        const diff = scoreModel(withReasoning, "analysis") - scoreModel(withoutReasoning, "analysis")
        expect(diff).toBeGreaterThanOrEqual(60)
    })

    test("general: balanced scoring", () => {
        const score = scoreModel(baseModel, "general")
        expect(score).toBeGreaterThan(0)
    })
})

describe("model-router - inferCategory", () => {
    test("detects coding prompts", () => {
        expect(inferCategory("Implement a new REST API endpoint")).toBe("coding")
        expect(inferCategory("Fix the bug in user service")).toBe("coding")
        expect(inferCategory("Write a function to parse JSON")).toBe("coding")
    })

    test("detects documentation prompts", () => {
        expect(inferCategory("Write a README guide for this project")).toBe("documentation")
        expect(inferCategory("Create a tutorial explaining setup")).toBe("documentation")
    })

    test("detects analysis prompts", () => {
        expect(inferCategory("Analyze the performance of this system")).toBe("analysis")
        expect(inferCategory("Review and evaluate the architecture")).toBe("analysis")
    })

    test("falls back to general", () => {
        expect(inferCategory("hello world")).toBe("general")
        expect(inferCategory("do something")).toBe("general")
    })

    test("detects Turkish coding keywords", () => {
        expect(inferCategory("Yeni bir fonksiyon yaz")).toBe("coding")
        expect(inferCategory("Bu hatayı düzelt")).toBe("coding")
    })

    test("detects Turkish doc keywords", () => {
        expect(inferCategory("Proje dokümanı hazırla")).toBe("documentation")
    })
})
