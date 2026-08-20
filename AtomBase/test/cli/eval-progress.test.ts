import { describe, expect, test } from "bun:test"
import { EvalProgress } from "@/interfaces/cli/cmd/eval-progress"

describe("EvalProgress", () => {
  test("formats elapsed counters", () => {
    expect(EvalProgress.duration(0)).toBe("00:00")
    expect(EvalProgress.duration(65_000)).toBe("01:05")
    expect(EvalProgress.duration(3_661_000)).toBe("01:01:01")
  })

  test("prints durable progress when stderr is not a TTY", () => {
    let output = ""
    let now = 1_000
    const reporter = EvalProgress.create({
      stream: { isTTY: false, write: (value) => (output += value) },
      suite: "smoke",
      version: "1",
      model: "provider/model",
      total: 1,
      now: () => now,
    })
    reporter.update({
      type: "case_started",
      index: 1,
      total: 1,
      id: "small-bug-fix",
      category: "coding",
      startedAt: now,
    })
    now += 5_000
    reporter.update({
      type: "case_finished",
      index: 1,
      total: 1,
      id: "small-bug-fix",
      ok: true,
      rateLimited: false,
      durationMs: 5_000,
    })
    reporter.finish()
    expect(output).toContain("Benchmark smoke v1")
    expect(output).toContain("[1/1] START small-bug-fix (coding)")
    expect(output).toContain("[1/1] DONE small-bug-fix | 00:05")
    expect(output).toContain("1/1 attempted | total 00:05")
  })

  test("ignores broken stderr writers", () => {
    const reporter = EvalProgress.create({
      stream: {
        isTTY: false,
        write() {
          throw new Error("closed stream")
        },
      },
      suite: "smoke",
      version: "1",
      model: "provider/model",
      total: 1,
    })
    expect(() =>
      reporter.update({
        type: "case_started",
        index: 1,
        total: 1,
        id: "case",
        category: "analysis",
        startedAt: Date.now(),
      }),
    ).not.toThrow()
    expect(() => reporter.finish(true)).not.toThrow()
  })

  test("renders rate-limit termination as the authoritative final state", () => {
    let output = ""
    let now = 10_000
    const reporter = EvalProgress.create({
      stream: { isTTY: true, columns: 72, write: (value) => (output += value) },
      suite: "limited",
      version: "1",
      model: "provider/model",
      total: 3,
      now: () => now,
    })
    reporter.update({
      type: "case_started",
      index: 1,
      total: 3,
      id: "a-very-long-case-name-that-must-be-compacted",
      category: "analysis",
      startedAt: now,
    })
    now += 2_000
    reporter.update({
      type: "case_finished",
      index: 1,
      total: 3,
      id: "a-very-long-case-name-that-must-be-compacted",
      ok: false,
      rateLimited: true,
      durationMs: 2_000,
      error: "429\nRate limit exceeded",
    })
    reporter.finish(true)
    expect(output).toContain("RATE_LIMIT")
    expect(output).toContain("429 Rate limit exceeded")
    expect(output).toContain("Stopped by provider rate limit: 1/3 attempted")
    expect(output).not.toContain("Benchmark execution failed")
  })
})
