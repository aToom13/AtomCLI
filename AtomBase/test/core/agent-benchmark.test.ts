import "../preload"
import { describe, expect, test, spyOn } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { AgentBenchmark } from "@/core/eval/benchmark"
import { AgentEval } from "@/core/eval/harness"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Global } from "@/core/global"

describe("AgentBenchmark", () => {
  test("rejects verifier history after deletion, reflog-only history, alternates and unreachable Git objects", async () => {
    await using tmp = await tmpdir({ git: true })
    const git = async (...args: string[]) => {
      const proc = Bun.spawn(["git", ...args], { cwd: tmp.path, stdout: "pipe", stderr: "pipe" })
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(code, err).toBe(0)
      return out.trim()
    }
    await AgentBenchmark.assertPrivateWorkspace(tmp.path)
    const clean = await git("rev-parse", "HEAD")
    const verifier = "cases/example/verify/run.sh"
    await Bun.write(path.join(tmp.path, verifier), "echo private-test-marker")
    await git("add", verifier)
    await git("commit", "-qm", "private fixture")
    await git("rm", verifier)
    await git("commit", "-qm", "removed fixture")
    await expect(AgentBenchmark.assertPrivateWorkspace(tmp.path)).rejects.toThrow(
      "verifier sources remain in Git history",
    )
    await git("reset", "--hard", clean)
    await expect(AgentBenchmark.assertPrivateWorkspace(tmp.path)).rejects.toThrow(
      "verifier sources remain in Git history",
    )
    await git("reflog", "expire", "--expire=now", "--all")
    await expect(AgentBenchmark.assertPrivateWorkspace(tmp.path)).rejects.toThrow("unreachable objects")
    await git("gc", "--prune=now")
    await AgentBenchmark.assertPrivateWorkspace(tmp.path)
    const alternates = path.join(tmp.path, ".git/objects/info/alternates")
    await Bun.write(alternates, "/fake-objects\n")
    await expect(AgentBenchmark.assertPrivateWorkspace(tmp.path)).rejects.toThrow("without alternates")
    await fs.rm(alternates)
    await AgentBenchmark.assertPrivateWorkspace(tmp.path)
  })

  test("recovers legacy data-directory stashes before using the untrusted home sibling", async () => {
    await using tmp = await tmpdir()
    const cases = path.join(tmp.path, "cases")
    const source = path.join(cases, "example/verify/run.sh")
    await Bun.write(source, "echo legacy-marker")
    const digest = new Bun.CryptoHasher("sha1").update(cases).digest("hex").slice(0, 12)
    const legacy = path.join(Global.Path.data, "eval-verifier-stash", digest)
    await AgentBenchmark.relocateVerifierSources(cases, legacy)
    const current = await AgentBenchmark.relocateVerifierSources(cases)
    try {
      expect(current.stashRoot).toBe(path.join(Global.Path.home, ".atomcli-eval-verifier-stash", digest))
      expect((await fs.stat(current.stashRoot!)).mode & 0o777).toBe(0o700)
      expect(await Bun.file(path.join(legacy, "manifest.json")).exists()).toBe(false)
    } finally {
      await current.restore()
    }
    expect(await Bun.file(source).text()).toBe("echo legacy-marker")
  })

  test("rejects duplicate case IDs that would alias observations", () => {
    expect(() =>
      AgentBenchmark.Suite.parse({
        name: "duplicate-cases",
        version: "1",
        cases: [
          { id: "same", category: "analysis", prompt: "first" },
          { id: "same", category: "coding", prompt: "second" },
        ],
      }),
    ).toThrow("duplicate benchmark case id")
  })

  test("checks observable task requirements", () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "smoke",
      version: "1",
      cases: [{ id: "fix", category: "coding", prompt: "fix", requiresTools: true, expectsTests: true }],
    })
    const result = AgentEval.score(
      AgentEval.Observation.parse({
        id: "fix",
        category: "coding",
        providerID: "p",
        modelID: "m",
        completed: true,
        toolCalls: 2,
        testsPassed: true,
        reviewerVerdict: "passed",
      }),
    )
    expect(AgentBenchmark.evaluate(suite, [result])).toMatchObject({ ready: true, passed: 1, passRate: 1 })
  })

  test("executes every case before collecting observations", async () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "smoke",
      version: "1",
      cases: [
        { id: "one", category: "analysis", prompt: "inspect one" },
        { id: "two", category: "analysis", prompt: "inspect two" },
      ],
    })
    const executed: string[] = []
    const progress: AgentBenchmark.Progress[] = []
    const results = suite.cases.map((item) =>
      AgentEval.score(
        AgentEval.Observation.parse({
          id: item.id,
          suite: "benchmark",
          category: item.category,
          providerID: "p",
          modelID: "m",
          completed: true,
        }),
      ),
    )
    const report = await AgentBenchmark.run(
      suite,
      async (item) => {
        executed.push(item.id)
        return { sessionID: `session-${item.id}` }
      },
      async () => results,
      (event) => progress.push(event),
    )
    expect(executed).toEqual(["one", "two"])
    expect(report).toMatchObject({ observed: 2, passed: 2 })
    expect(report.executions[0].sessionID).toBe("session-one")
    expect(progress.map((event) => `${event.type}:${event.id}`)).toEqual([
      "case_started:one",
      "case_finished:one",
      "case_started:two",
      "case_finished:two",
    ])
  })

  test("isolates suites and versions in stable storage buckets", () => {
    const first = AgentBenchmark.Suite.parse({
      name: "suite/a",
      version: "1",
      cases: [{ id: "x", category: "analysis", prompt: "x" }],
    })
    const second = AgentBenchmark.Suite.parse({
      name: "suite-a",
      version: "2",
      cases: [{ id: "x", category: "analysis", prompt: "x" }],
    })
    expect(AgentBenchmark.bucket(first)).toBe(AgentBenchmark.bucket(first))
    expect(AgentBenchmark.bucket(first)).not.toBe(AgentBenchmark.bucket(second))
  })

  test("stops after a provider-wide rate limit instead of retrying every case", async () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "limited",
      version: "1",
      cases: [
        { id: "one", category: "analysis", prompt: "inspect one" },
        { id: "two", category: "analysis", prompt: "inspect two" },
      ],
    })
    const executed: string[] = []
    const report = await AgentBenchmark.run(
      suite,
      async (item) => {
        executed.push(item.id)
        throw new Error("429 Rate limit exceeded")
      },
      async () => [],
    )
    expect(executed).toEqual(["one"])
    expect(report.executions).toEqual([{ id: "one", ok: false, error: "429 Rate limit exceeded" }])
  })

  test("recognizes provider quota exhaustion variants", () => {
    expect(AgentBenchmark.isRateLimitError("RESOURCE_EXHAUSTED")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("quota exceeded for this project")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("ordinary validation error")).toBe(false)
  })

  test("progress renderer failures never change benchmark executions", async () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "renderer-failure",
      version: "1",
      cases: [{ id: "one", category: "analysis", prompt: "inspect" }],
    })
    const report = await AgentBenchmark.run(
      suite,
      async () => ({ sessionID: "session-one" }),
      async () => [],
      () => {
        throw new Error("renderer failed")
      },
    )
    expect(report.executions).toEqual([{ id: "one", ok: true, sessionID: "session-one" }])
  })

  test("benchmark sessions disable transparent model fallback", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-benchmark-fallback"
        expect(AgentEval.allowsModelFallback(sessionID)).toBe(true)
        AgentEval.registerBenchmark(sessionID, { suite: "suite", caseID: "case", runID: "run" })
        expect(AgentEval.allowsModelFallback(sessionID)).toBe(false)
        expect(AgentEval.executionPolicy(sessionID)).toEqual({
          allowModelFallback: false,
          allowAuxiliarySummaries: false,
          allowMemoryLearning: false,
          maxRetries: 0,
        })
        AgentEval.unregisterBenchmark(sessionID)
        expect(AgentEval.allowsModelFallback(sessionID)).toBe(true)
      },
    })
  })

  test("evaluates failure constraints for tool errors, retries, duration, and missing observations", () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "constraints-suite",
      version: "1",
      cases: [
        {
          id: "case-errors",
          category: "coding",
          prompt: "test errors",
          maxToolErrors: 1,
        },
        {
          id: "case-retries",
          category: "coding",
          prompt: "test retries",
          maxRetries: 1,
        },
        {
          id: "case-duration",
          category: "coding",
          prompt: "test duration",
          maxDurationMs: 500,
        },
        {
          id: "case-missing",
          category: "analysis",
          prompt: "test missing",
        },
      ],
    })

    const results = [
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-errors",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          toolErrors: 2,
          timestamp: 1000,
        }),
      ),
      // For case-retries, provide two observations; evaluate should choose the latest timestamp (2000)
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-retries",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          retries: 0,
          timestamp: 1000,
        }),
      ),
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-retries",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          retries: 2,
          timestamp: 2000,
        }),
      ),
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-duration",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          durationMs: 750,
          timestamp: 1000,
        }),
      ),
    ]

    const evaluation = AgentBenchmark.evaluate(suite, results)
    expect(evaluation.ready).toBe(false)
    expect(evaluation.observed).toBe(3)
    expect(evaluation.total).toBe(4)
    expect(evaluation.passed).toBe(0)

    const errorsCase = evaluation.cases.find((c) => c.id === "case-errors")!
    expect(errorsCase.passed).toBe(false)
    expect(errorsCase.failures).toContain("tool errors 2 > 1")

    const retriesCase = evaluation.cases.find((c) => c.id === "case-retries")!
    expect(retriesCase.passed).toBe(false)
    expect(retriesCase.failures).toContain("retries 2 > 1")
    expect(retriesCase.observation?.timestamp).toBe(2000)

    const durationCase = evaluation.cases.find((c) => c.id === "case-duration")!
    expect(durationCase.passed).toBe(false)
    expect(durationCase.failures).toContain("duration 750ms > 500ms")

    const missingCase = evaluation.cases.find((c) => c.id === "case-missing")!
    expect(missingCase.passed).toBe(false)
    expect(missingCase.failures).toContain("missing observation")
  })

  describe("outcome-v2 grading", () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "outcomes",
      version: "1",
      grading: "outcome-v2",
      cases: [
        {
          id: "task",
          category: "coding",
          prompt: "fix",
          requiresTools: true,
          expectsTests: true,
          verifyCommand: "check-output",
          maxRetries: 0,
          maxDurationMs: 1000,
        },
      ],
    })
    const observation = (overrides: Partial<AgentEval.Observation> = {}) =>
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "task",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          toolCalls: 4,
          testsPassed: true,
          durationMs: 1000,
          ...overrides,
        }),
      )
    const verified = new Map([["task", { passed: true }]])

    test("verified recovery passes with small deductions and bounded total penalties", () => {
      for (const [metrics, score, points] of [
        [{}, 100, []],
        [{ toolErrors: 2 }, 96, [4]],
        [{ toolErrors: 2, retries: 2, durationMs: 1500 }, 91, [4, 2, 3]],
        [{ toolErrors: 100, retries: 100, durationMs: 100000 }, 80, [10, 5, 5]],
      ] as const) {
        const report = AgentBenchmark.evaluate(suite, [observation(metrics)], verified)
        expect(report).toMatchObject({ accepted: true, passed: 1, score })
        expect(report.cases[0].failures).toEqual([])
        expect(report.cases[0].penalties.map((item) => item.points)).toEqual([...points])
      }
    })

    test("allowances stay penalty-free; grading changes cannot mix observation buckets", () => {
      const allowed = AgentBenchmark.Suite.parse({
        ...suite,
        cases: [{ ...suite.cases[0], maxToolErrors: 2, maxRetries: 2 }],
      })
      expect(AgentBenchmark.evaluate(allowed, [observation({ toolErrors: 2, retries: 2 })], verified).score).toBe(100)
      const legacy = AgentBenchmark.Suite.parse({ ...suite, grading: undefined })
      expect(legacy.grading).toBe("strict-v1")
      const digest = new Bun.CryptoHasher("sha1").update("outcomes\n1").digest("hex").slice(0, 12)
      expect(AgentBenchmark.bucket(legacy)).toBe(`benchmark-outcomes-1-${digest}`)
      expect(AgentBenchmark.bucket(suite)).not.toBe(AgentBenchmark.bucket(legacy))
      expect(AgentBenchmark.evaluate(legacy, [observation({ toolErrors: 2 })], verified)).toMatchObject({
        accepted: false,
        score: 0,
      })
    })

    test("correctness, completion and independent evidence remain hard requirements", () => {
      for (const metrics of [
        { completed: false },
        { responseEmpty: true },
        { testsPassed: false },
        { reviewerVerdict: "failed" as const },
        { toolCalls: 0 },
      ]) {
        expect(AgentBenchmark.evaluate(suite, [observation(metrics)], verified)).toMatchObject({
          accepted: false,
          score: 0,
        })
      }
      for (const verdict of [undefined, new Map([["task", { passed: false }]]), new Map([["task", {}]])]) {
        expect(AgentBenchmark.evaluate(suite, [observation()], verdict)).toMatchObject({ accepted: false, score: 0 })
      }
      const unverified = AgentBenchmark.Suite.parse({
        ...suite,
        cases: [{ ...suite.cases[0], verifyCommand: undefined }],
      })
      expect(AgentBenchmark.evaluate(unverified, [observation()], verified).cases[0].failures).toContain(
        "independent verifier is required",
      )
    })

    test("execution errors and watchdog failures cannot reuse a successful observation", async () => {
      for (const error of ["executor failed", "case timed out after 1000ms"]) {
        const report = await AgentBenchmark.run(
          suite,
          async () => {
            throw new Error(error)
          },
          async () => [observation()],
        )
        expect(report).toMatchObject({ ready: true, accepted: false, score: 0 })
        expect(report.cases[0].failures).toContain(`execution failed: ${error}`)
      }
    })

    test("aggregate score includes failed and unobserved cases; coverage does not mean acceptance", () => {
      const multiple = AgentBenchmark.Suite.parse({
        ...suite,
        cases: [suite.cases[0], { ...suite.cases[0], id: "wrong" }, { ...suite.cases[0], id: "missing" }],
      })
      const report = AgentBenchmark.evaluate(
        multiple,
        [observation({ toolErrors: 2 }), observation({ id: "wrong" })],
        new Map([
          ["task", { passed: true }],
          ["wrong", { passed: false }],
        ]),
      )
      expect(report).toMatchObject({ ready: false, accepted: false, observed: 2, total: 3, passed: 1, score: 32 })
      expect(report.cases.map((item) => item.score)).toEqual([96, 0, 0])
      expect(report.cases[2].failures).toContain("missing observation")
    })
  })

  test("recognizes all standard quota and rate limit exception patterns", () => {
    expect(AgentBenchmark.isRateLimitError(new Error("FreeUsageLimitError: free tier limit exceeded"))).toBe(true)
    expect(AgentBenchmark.isRateLimitError("Error: 429 Too Many Requests")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("HTTP status 429")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("insufficient quota for model usage")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("usage limit reached for token bucket")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("Unhandled TypeError: null is not an object")).toBe(false)
  })

  test("cases with a hidden verifier can only pass when it ran and exited zero", async () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "verified",
      version: "1",
      cases: [
        { id: "passed", category: "coding", prompt: "p1", verifyCommand: "true" },
        { id: "failed", category: "coding", prompt: "p2", verifyCommand: "false" },
        { id: "skipped", category: "coding", prompt: "p3", verifyCommand: "true" },
        { id: "unverified", category: "coding", prompt: "p4" },
      ],
    })
    const observation = (id: string) =>
      AgentEval.score(
        AgentEval.Observation.parse({
          id,
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          timestamp: 1000,
        }),
      )
    const results = [observation("passed"), observation("failed"), observation("skipped")]
    const report = await AgentBenchmark.run(
      suite,
      async (item) => {
        if (item.id === "passed") return { sessionID: "s1", verifierPassed: true }
        if (item.id === "failed") return { sessionID: "s2", verifierPassed: false, verifierDetail: "exit code 1" }
        return { sessionID: `s-${item.id}` }
      },
      async () => results,
    )
    const byId = Object.fromEntries(report.cases.map((c) => [c.id, c]))
    expect(byId.passed.passed).toBe(true)
    expect(byId.failed.passed).toBe(false)
    expect(byId.failed.failures[0]).toContain("hidden verifier failed")
    expect(byId.skipped.passed).toBe(false)
    expect(byId.skipped.failures).toContain("hidden verifier was not run")
    expect(byId.unverified.passed).toBe(false)
    expect(report.executions.find((e) => e.id === "failed")?.verifierDetail).toBe("exit code 1")
  })

  test("shell runs commands with a hard timeout and captures combined output", async () => {
    const ok = await AgentBenchmark.shell("echo out; echo err >&2", { cwd: import.meta.dir })
    expect(ok.exitCode).toBe(0)
    expect(ok.output).toContain("out")
    expect(ok.output).toContain("err")

    const failing = await AgentBenchmark.shell("exit 3")
    expect(failing.exitCode).toBe(3)

    const slow = await AgentBenchmark.shell("sleep 5", { timeoutMs: 50 })
    expect(slow.exitCode).not.toBe(0)
    expect(slow.timedOut).toBe(true)
  })

  test("relocates verifier sources out of the worktree for the whole run", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    for (const id of ["case-a", "case-b"]) {
      await Bun.write(path.join(casesRoot, id, "verify", "run.sh"), `echo ${id}\n`)
      await Bun.write(path.join(casesRoot, id, "setup.sh"), "true\n")
    }
    await Bun.write(path.join(casesRoot, "case-plain", "setup.sh"), "true\n")

    const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    try {
      // Verify directories vanish from the worktree while stashed...
      expect(await Bun.file(path.join(casesRoot, "case-a", "verify", "run.sh")).exists()).toBe(false)
      expect(await Bun.file(path.join(stashRoot, "case-a", "verify", "run.sh")).exists()).toBe(true)
      expect(await Bun.file(path.join(stashRoot, "case-b", "verify", "run.sh")).exists()).toBe(true)
      // ...non-verifier files stay put.
      expect(await Bun.file(path.join(casesRoot, "case-a", "setup.sh")).exists()).toBe(true)
      expect(await Bun.file(path.join(casesRoot, "case-plain", "setup.sh")).exists()).toBe(true)
    } finally {
      await relocation.restore()
    }
    // Restore puts every verifier back exactly where it was.
    expect(await Bun.file(path.join(casesRoot, "case-a", "verify", "run.sh")).exists()).toBe(true)
    expect(await Bun.file(path.join(casesRoot, "case-b", "verify", "run.sh")).exists()).toBe(true)
  })

  test("hides nested verifier copies and restores them through the recovery manifest", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const verifiers = ["case-a/verify/run.sh", "case-a/case-a/verify/run.sh", "case-b/copy/deep/verify/run.sh"]
    for (const verifier of verifiers) await Bun.write(path.join(casesRoot, verifier), `private fixture: ${verifier}\n`)
    await Bun.write(path.join(casesRoot, "case-a", "setup.sh"), "true\n")
    const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    try {
      for (const verifier of verifiers) {
        expect(await Bun.file(path.join(casesRoot, verifier)).exists()).toBe(false)
        expect(await Bun.file(path.join(stashRoot, verifier)).text()).toBe(`private fixture: ${verifier}\n`)
      }
      expect(await Bun.file(path.join(casesRoot, "case-a", "setup.sh")).text()).toBe("true\n")
      expect(await AgentBenchmark.restoreStashedVerifiers(casesRoot, stashRoot)).toBe(true)
      for (const verifier of verifiers)
        expect(await Bun.file(path.join(casesRoot, verifier)).text()).toBe(`private fixture: ${verifier}\n`)
    } finally {
      await relocation.restore()
    }
  })

  test("hides all shipped verifier copies and restores every suite file unchanged", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    await fs.cp(path.join(import.meta.dir, "../../evals/cases"), casesRoot, { recursive: true })
    const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: casesRoot, onlyFiles: true }))
    const before = new Map(
      await Promise.all(files.map(async (file) => [file, await Bun.file(path.join(casesRoot, file)).text()] as const)),
    )
    const hidden = files.filter((file) => file.split(path.sep).includes("verify"))
    expect(hidden.length).toBeGreaterThanOrEqual(20)
    const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    try {
      expect(Array.from(new Bun.Glob("**/verify/**/*").scanSync({ cwd: casesRoot, onlyFiles: true }))).toEqual([])
      for (const file of hidden) expect(await Bun.file(path.join(stashRoot, file)).text()).toBe(before.get(file)!)
      for (const file of files.filter((file) => !hidden.includes(file)))
        expect(await Bun.file(path.join(casesRoot, file)).text()).toBe(before.get(file)!)
      await AgentBenchmark.restoreStashedVerifiers(casesRoot, stashRoot)
      for (const file of files) expect(await Bun.file(path.join(casesRoot, file)).text()).toBe(before.get(file)!)
    } finally {
      await relocation.restore()
    }
  })

  test("restore is idempotent and tolerates a missing stash entry", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    await Bun.write(path.join(casesRoot, "solo", "verify", "run.sh"), "true\n")
    const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    await relocation.restore()
    // Second restore must be a harmless no-op even though the stash is gone.
    await relocation.restore()
    expect(await Bun.file(path.join(casesRoot, "solo", "verify", "run.sh")).exists()).toBe(true)
  })

  test.each(["source", "stash"])("rejects nested %s ancestor symlinks during recovery", async (target) => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const relative = path.join("solo", "copy", "deep", "verify", "run.sh")
    await Bun.write(path.join(casesRoot, relative), "expected\n")
    const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    const ancestor = path.join(target === "source" ? casesRoot : stashRoot, "solo", "copy")
    const saved = `${ancestor}.saved`
    const outside = path.join(tmp.path, "outside")
    await Bun.write(path.join(outside, "deep", "verify", "run.sh"), "outside\n")
    await fs.rename(ancestor, saved)
    await fs.symlink(outside, ancestor)
    try {
      await expect(relocation.restore()).rejects.toThrow("Verifier case path must be a directory")
      expect(await Bun.file(path.join(stashRoot, "manifest.json")).exists()).toBe(true)
      expect(await Bun.file(path.join(outside, "deep", "verify", "run.sh")).text()).toBe("outside\n")
      expect(
        await Bun.file(
          path.join(target === "stash" ? saved : stashRoot, target === "stash" ? "deep/verify/run.sh" : relative),
        ).text(),
      ).toBe("expected\n")
    } finally {
      await fs.unlink(ancestor)
      await fs.rename(saved, ancestor)
      await relocation.restore()
    }
    expect(await Bun.file(path.join(casesRoot, relative)).text()).toBe("expected\n")
  })

  test("a new run self-heals a stash left behind by an interrupted run", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    for (const id of ["case-a", "case-b"]) {
      await Bun.write(path.join(casesRoot, id, "verify", "run.sh"), `echo ${id}\n`)
      await Bun.write(path.join(casesRoot, id, "setup.sh"), "true\n")
    }

    // First run gets interrupted: sources are stashed but never restored.
    const interrupted = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    expect(await Bun.file(path.join(casesRoot, "case-a", "verify", "run.sh")).exists()).toBe(false)

    // The next run must heal before relocating, and end up in a healthy state.
    const second = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    try {
      expect(await Bun.file(path.join(stashRoot, "case-a", "verify", "run.sh")).exists()).toBe(true)
      expect(await Bun.file(path.join(casesRoot, "case-a", "verify", "run.sh")).exists()).toBe(false)
    } finally {
      await second.restore()
      await interrupted.restore()
    }
    expect(await Bun.file(path.join(casesRoot, "case-a", "verify", "run.sh")).exists()).toBe(true)
    expect(await Bun.file(path.join(casesRoot, "case-b", "verify", "run.sh")).exists()).toBe(true)
  })

  test("restoreStashedVerifiers recovers from the persisted manifest", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    await Bun.write(path.join(casesRoot, "solo", "verify", "run.sh"), "true\n")

    const first = await AgentBenchmark.relocateVerifierSources(casesRoot)
    expect(first.stashRoot).toBeTruthy()
    expect(first.stashRoot).toContain("eval-verifier-stash")
    expect(await Bun.file(path.join(casesRoot, "solo", "verify", "run.sh")).exists()).toBe(false)

    // Simulates the next CLI invocation after a hard kill.
    expect(await AgentBenchmark.restoreStashedVerifiers(casesRoot)).toBe(true)
    expect(await Bun.file(path.join(casesRoot, "solo", "verify", "run.sh")).exists()).toBe(true)

    const again = await AgentBenchmark.relocateVerifierSources(casesRoot)
    await again.restore()
    expect(await AgentBenchmark.restoreStashedVerifiers(casesRoot)).toBe(false)
  })

  test("rejects a corrupt recovery manifest without discarding the stash", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    await Bun.write(path.join(casesRoot, "solo", "verify", "run.sh"), "true\n")
    await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    await Bun.write(path.join(stashRoot, "manifest.json"), "{broken")

    await expect(AgentBenchmark.restoreStashedVerifiers(casesRoot, stashRoot)).rejects.toThrow()
    expect(await Bun.file(path.join(stashRoot, "solo", "verify", "run.sh")).exists()).toBe(true)
  })

  test("keeps recovery manifest when verifier is missing from both locations", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const original = path.join(casesRoot, "solo", "verify")
    const stash = path.join(stashRoot, "solo", "verify")
    await Bun.write(
      path.join(stashRoot, "manifest.json"),
      JSON.stringify({ casesRoot, movedAt: Date.now(), entries: [{ original, stash }] }),
    )

    await expect(AgentBenchmark.restoreStashedVerifiers(casesRoot, stashRoot)).rejects.toThrow(
      "missing from both source and stash",
    )
    expect(await Bun.file(path.join(stashRoot, "manifest.json")).exists()).toBe(true)
  })

  test("rejects recovery paths outside the expected case and stash roots", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const outside = path.join(tmp.path, "outside")
    await Bun.write(path.join(stashRoot, "solo", "verify", "run.sh"), "true\n")
    await Bun.write(
      path.join(stashRoot, "manifest.json"),
      JSON.stringify({
        casesRoot,
        movedAt: Date.now(),
        entries: [{ original: path.join(outside, "verify"), stash: path.join(stashRoot, "solo", "verify") }],
      }),
    )

    await expect(AgentBenchmark.restoreStashedVerifiers(casesRoot, stashRoot)).rejects.toThrow("Invalid verifier")
    expect(await Bun.file(path.join(outside, "verify", "run.sh")).exists()).toBe(false)
  })

  test("does not treat missing cases or unreadable verifier paths as an empty suite", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    await expect(AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)).rejects.toThrow()
    await Bun.write(path.join(casesRoot, "solo", "verify", "run.sh"), "true\n")
    const verify = path.join(casesRoot, "solo", "verify")
    const original = fs.lstat
    const lstat = spyOn(fs, "lstat").mockImplementation((async (
      location: string,
      options?: Parameters<typeof fs.lstat>[1],
    ) => {
      if (location === verify) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
      return original(location, options as never)
    }) as typeof fs.lstat)
    try {
      await expect(AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)).rejects.toThrow("permission denied")
    } finally {
      lstat.mockRestore()
    }
    expect(await Bun.file(path.join(verify, "run.sh")).exists()).toBe(true)
  })

  test("rejects symbolic links in verifier paths", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const actual = path.join(tmp.path, "actual")
    await Bun.write(path.join(actual, "run.sh"), "true\n")
    await fs.mkdir(path.join(casesRoot, "solo"), { recursive: true })
    await fs.symlink(actual, path.join(casesRoot, "solo", "verify"))
    await expect(AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)).rejects.toThrow(
      "Verifier path must be a directory",
    )
    expect(await Bun.file(path.join(actual, "run.sh")).exists()).toBe(true)
  })

  test("restore failure preserves verifier stash for a later retry", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    await Bun.write(path.join(casesRoot, "solo", "verify", "run.sh"), "true\n")
    const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    const copy = spyOn(fs, "cp").mockRejectedValue(new Error("disk full"))
    try {
      await expect(relocation.restore()).rejects.toThrow("disk full")
      expect(await Bun.file(path.join(stashRoot, "manifest.json")).exists()).toBe(true)
      expect(await Bun.file(path.join(stashRoot, "solo", "verify", "run.sh")).exists()).toBe(true)
    } finally {
      copy.mockRestore()
    }
    await relocation.restore()
    expect(await Bun.file(path.join(casesRoot, "solo", "verify", "run.sh")).exists()).toBe(true)
  })

  test("restoring replaces a verifier directory recreated by the agent", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const verify = path.join(casesRoot, "solo", "verify")
    await Bun.write(path.join(verify, "run.sh"), "expected\n")
    const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
    await Bun.write(path.join(verify, "agent-created.sh"), "unexpected\n")

    await relocation.restore()
    expect(await Bun.file(path.join(verify, "run.sh")).text()).toBe("expected\n")
    expect(await Bun.file(path.join(verify, "agent-created.sh")).exists()).toBe(false)
  })

  test("writes recovery manifest before moving verifier files", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    await Bun.write(path.join(casesRoot, "solo", "verify", "run.sh"), "true\n")
    const renameOriginal = fs.rename
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (source === path.join(casesRoot, "solo", "verify")) {
        const manifest = await Bun.file(path.join(stashRoot, "manifest.json")).json()
        expect(manifest.entries).toContainEqual({ original: source, stash: destination })
      }
      return renameOriginal(source, destination)
    })
    try {
      const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
      await relocation.restore()
    } finally {
      rename.mockRestore()
    }
  })

  test("does not hide a rename failure by falling back to copy", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const original = path.join(casesRoot, "solo", "verify")
    await Bun.write(path.join(original, "run.sh"), "true\n")
    const renameOriginal = fs.rename
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (source === original) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
      return renameOriginal(source, destination)
    })
    try {
      await expect(AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)).rejects.toThrow("permission denied")
      expect(await Bun.file(path.join(original, "run.sh")).exists()).toBe(true)
      expect(await Bun.file(path.join(stashRoot, "solo", "verify", "run.sh")).exists()).toBe(false)
    } finally {
      rename.mockRestore()
    }
  })

  test("cross-device copy failure leaves source intact and no partial stash", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const original = path.join(casesRoot, "solo", "verify")
    await Bun.write(path.join(original, "run.sh"), "true\n")
    const renameOriginal = fs.rename
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (source === original) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" })
      return renameOriginal(source, destination)
    })
    const copy = spyOn(fs, "cp").mockRejectedValue(new Error("copy interrupted"))
    try {
      await expect(AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)).rejects.toThrow("copy interrupted")
      expect(await Bun.file(path.join(original, "run.sh")).exists()).toBe(true)
      expect(await Bun.file(path.join(stashRoot, "solo", "verify", "run.sh")).exists()).toBe(false)
    } finally {
      copy.mockRestore()
      rename.mockRestore()
    }
    expect(await AgentBenchmark.restoreStashedVerifiers(casesRoot, stashRoot)).toBe(true)
  })

  test("cross-device fallback stages complete verifier before removing source", async () => {
    await using tmp = await tmpdir({ git: false })
    const casesRoot = path.join(tmp.path, "cases")
    const stashRoot = path.join(tmp.path, "stash")
    const original = path.join(casesRoot, "solo", "verify")
    await Bun.write(path.join(original, "run.sh"), "true\n")
    const renameOriginal = fs.rename
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (source === original) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" })
      return renameOriginal(source, destination)
    })
    try {
      const relocation = await AgentBenchmark.relocateVerifierSources(casesRoot, stashRoot)
      expect(await Bun.file(path.join(original, "run.sh")).exists()).toBe(false)
      expect(await Bun.file(path.join(stashRoot, "solo", "verify", "run.sh")).exists()).toBe(true)
      await relocation.restore()
      expect(await Bun.file(path.join(original, "run.sh")).exists()).toBe(true)
    } finally {
      rename.mockRestore()
    }
  })

  test("the shipped atomcli-core suite is fully materialized on disk", async () => {
    const evalsDir = path.join(import.meta.dir, "../../evals")
    const suite = AgentBenchmark.Suite.parse(await Bun.file(path.join(evalsDir, "atomcli.json")).json())
    expect(suite.name).toBe("atomcli-core")
    expect(suite.version).toBe("5")
    expect(suite.grading).toBe("outcome-v2")
    expect(suite.cases.length).toBeGreaterThanOrEqual(10)
    for (const testCase of suite.cases) {
      expect(testCase.setupCommand, `${testCase.id} setupCommand`).toBeTruthy()
      expect(testCase.verifyCommand, `${testCase.id} verifyCommand`).toBeTruthy()
      expect(testCase.timeoutMs ?? 0).toBeGreaterThan(0)
      await Bun.file(path.join(evalsDir, "cases", testCase.id, "setup.sh")).exists()
      const setup = await Bun.file(path.join(evalsDir, "cases", testCase.id, "setup.sh")).exists()
      const verifier = await Bun.file(path.join(evalsDir, "cases", testCase.id, "verify", "run.sh")).exists()
      expect(setup, `${testCase.id} setup.sh`).toBe(true)
      expect(verifier, `${testCase.id} verify/run.sh`).toBe(true)
    }
  })
})
