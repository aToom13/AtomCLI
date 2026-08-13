import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { PerformanceProfiler } from "@/interfaces/cli/cmd/perf"

describe("performance profiler", () => {
  test("does not mistake a function declaration for recursion", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "simple.ts"),
          [
            "export function add(a: number, b: number) {",
            "  return a + b",
            "}",
            "",
            "// keep this fixture non-minified",
          ].join("\n"),
        )
      },
    })

    const result = await PerformanceProfiler.analyzeFile(path.join(tmp.path, "simple.ts"))
    expect(result.complexity[0]).toMatchObject({
      function: "add",
      bigO: "O(1)",
      nestedLoops: 0,
      recursion: false,
    })
  })

  test("reports actual recursion and nested loops", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "complex.ts"),
          [
            "export function recurse(value: number): number {",
            "  if (value <= 0) return 0",
            "  return recurse(value - 1)",
            "}",
            "export function pairs(values: number[]) {",
            "  for (const left of values) {",
            "    for (const right of values) {",
            "      console.log(left, right)",
            "    }",
            "  }",
            "}",
          ].join("\n"),
        )
      },
    })

    const result = await PerformanceProfiler.analyzeFile(path.join(tmp.path, "complex.ts"))
    expect(result.complexity.find((item) => item.function === "recurse")).toMatchObject({
      recursion: true,
      bigO: "input-dependent (recursive)",
    })
    expect(result.complexity.find((item) => item.function === "pairs")).toMatchObject({
      recursion: false,
      nestedLoops: 2,
      bigO: "O(n²)",
    })
  })

  test("honors the requested files and complexity threshold", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "selected.ts"),
          "export function selected(x: number) {\n if (x) return 1\n return 0\n}\n",
        )
        await Bun.write(path.join(dir, "ignored.ts"), "export function ignored() {\n return 1\n}\n\n")
      },
    })

    const result = await PerformanceProfiler.analyze({
      files: [path.join(tmp.path, "selected.ts")],
      threshold: 1,
    })
    expect(result.summary.filesAnalyzed).toBe(1)
    expect(result.complexity.map((item) => item.function)).toEqual(["selected"])
    expect(result.issues.some((item) => item.message.includes("High cyclomatic complexity"))).toBe(true)
  })
})
