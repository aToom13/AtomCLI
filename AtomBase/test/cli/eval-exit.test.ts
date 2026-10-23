import "../preload"
import { expect, test } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"

test("failed benchmark execution exits nonzero while stored reporting stays read-only", async () => {
  await using tmp = await tmpdir()
  const init = Bun.spawn(["git", "init", "--quiet"], { cwd: tmp.path })
  expect(await init.exited).toBe(0)
  const suite = path.join(tmp.path, "suite.json")
  await fs.mkdir(path.join(tmp.path, "cases"))
  await Bun.write(
    suite,
    JSON.stringify({
      name: "exit-code-regression",
      version: "1",
      cases: [
        {
          id: "setup-failure",
          category: "coding",
          prompt: "Never reaches a model",
          setupCommand: "touch failed-setup-marker; exit 7",
        },
      ],
    }),
  )
  for (const execute of [false, true]) {
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        "--conditions=browser",
        "--preload",
        import.meta.resolve("@opentui/solid/preload"),
        path.join(import.meta.dir, "../../src/index.ts"),
        "eval",
        "benchmark",
        suite,
        ...(execute ? ["--execute", "--model", "fake/model"] : []),
      ],
      {
        cwd: tmp.path,
        env: {
          ...process.env,
          MODELS_DEV_API_JSON: path.join(import.meta.dir, "../tool/fixtures/models-api.json"),
          ATOMCLI_CONFIG_CONTENT: JSON.stringify({ plugin: [], mcp: {} }),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(stdout, stderr).not.toBe("")
    const report = JSON.parse(stdout)
    expect(report.mode).toBe(execute ? "execute" : "report")
    expect(report.passed).toBe(0)
    expect(exit).toBe(execute ? 1 : 0)
    if (execute) {
      expect(report.executions).toMatchObject([{ id: "setup-failure", ok: false }])
      expect(report.executions[0].sessionID).toMatch(/^ses_/)
      expect(stderr).toContain("setup failed")
      expect(await Bun.file(path.join(tmp.path, "failed-setup-marker")).exists()).toBe(false)
    }
  }
}, 20_000)

test("headless benchmark permission requests are rejected promptly instead of awaiting an absent UI", async () => {
  await using tmp = await tmpdir()
  const init = Bun.spawn(["git", "init", "--quiet"], { cwd: tmp.path })
  expect(await init.exited).toBe(0)
  await fs.mkdir(path.join(tmp.path, "cases"))
  const suite = path.join(tmp.path, "suite.json")
  await Bun.write(
    suite,
    JSON.stringify({
      name: "headless-permission-regression",
      version: "1",
      cases: [{ id: "permission", category: "analysis", prompt: "Fixture permission request", timeoutMs: 30_000 }],
    }),
  )
  const preload = path.join(tmp.path, "permission-fixture.ts")
  await Bun.write(
    preload,
    `
    import { spyOn } from "bun:test"
    import { SessionPrompt } from ${JSON.stringify(path.join(import.meta.dir, "../../src/core/session/prompt.ts"))}
    import { PermissionNext } from ${JSON.stringify(path.join(import.meta.dir, "../../src/util/permission/next.ts"))}
    spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      await PermissionNext.ask({
        sessionID: input.sessionID, permission: "external_directory",
        patterns: ["/fake-permission-fixture/*"], always: [], metadata: {},
        ruleset: [{ permission: "external_directory", action: "ask", pattern: "*" }],
      })
      throw new Error("permission unexpectedly allowed")
    })
  `,
  )
  const proc = Bun.spawn(
    [
      process.execPath,
      "run",
      "--conditions=browser",
      "--preload",
      import.meta.resolve("@opentui/solid/preload"),
      "--preload",
      preload,
      path.join(import.meta.dir, "../../src/index.ts"),
      "eval",
      "benchmark",
      suite,
      "--execute",
      "--model",
      "fake/model",
    ],
    {
      cwd: tmp.path,
      env: {
        ...process.env,
        MODELS_DEV_API_JSON: path.join(import.meta.dir, "../tool/fixtures/models-api.json"),
        ATOMCLI_CONFIG_CONTENT: JSON.stringify({ plugin: [], mcp: {} }),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const watchdog = setTimeout(() => proc.kill("SIGKILL"), 15_000)
  try {
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(stdout, stderr).not.toBe("")
    expect(exit).toBe(1)
    expect(JSON.parse(stdout).executions).toMatchObject([
      { id: "permission", ok: false, error: expect.stringContaining("Headless benchmark cannot answer") },
    ])
  } finally {
    clearTimeout(watchdog)
    proc.kill()
  }
}, 20_000)

for (const correct of [true, false]) {
  test(`outcome grading exits ${correct ? 0 : 1} for ${correct ? "verified recovery" : "incorrect output without tool errors"}`, async () => {
    await using tmp = await tmpdir()
    const init = Bun.spawn(["git", "init", "--quiet"], { cwd: tmp.path })
    expect(await init.exited).toBe(0)
    await fs.mkdir(path.join(tmp.path, "cases"))
    const suite = path.join(tmp.path, "suite.json")
    await Bun.write(
      suite,
      JSON.stringify({
        name: "outcome-exit",
        version: "1",
        grading: "outcome-v2",
        cases: [
          {
            id: "deliverable",
            category: "coding",
            prompt: "Write the correct answer",
            expectsTests: true,
            verifyCommand: 'test "$(cat answer.txt)" = correct',
            timeoutMs: 10000,
          },
        ],
      }),
    )
    const preload = path.join(tmp.path, "outcome-fixture.ts")
    await Bun.write(
      preload,
      `
      import { spyOn } from "bun:test"
      import { SessionPrompt } from ${JSON.stringify(path.join(import.meta.dir, "../../src/core/session/prompt.ts"))}
      import { AgentEval } from ${JSON.stringify(path.join(import.meta.dir, "../../src/core/eval/harness.ts"))}
      spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
        await Bun.write("answer.txt", ${JSON.stringify(correct ? "correct" : "wrong")})
        return { info: { role: "assistant" } }
      })
      spyOn(AgentEval, "recordSession").mockImplementation(async (sessionID) => {
        const context = AgentEval.benchmarkContext(sessionID)
        return [await AgentEval.record({
          id: context.caseID, suite: context.suite, promptVersion: context.runID,
          category: "coding", providerID: "fake", modelID: "model", completed: true,
          testsPassed: true, toolCalls: 4, toolErrors: ${correct ? 2 : 0},
        }, { updateModelQuality: false })]
      })
    `,
    )
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        "--conditions=browser",
        "--preload",
        import.meta.resolve("@opentui/solid/preload"),
        "--preload",
        preload,
        path.join(import.meta.dir, "../../src/index.ts"),
        "eval",
        "benchmark",
        suite,
        "--execute",
        "--model",
        "fake/model",
      ],
      {
        cwd: tmp.path,
        env: {
          ...process.env,
          MODELS_DEV_API_JSON: path.join(import.meta.dir, "../tool/fixtures/models-api.json"),
          ATOMCLI_CONFIG_CONTENT: JSON.stringify({ plugin: [], mcp: {} }),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), 15000)
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(stdout, stderr).not.toBe("")
      const report = JSON.parse(stdout)
      expect(exit, stderr).toBe(correct ? 0 : 1)
      expect(report).toMatchObject({ accepted: correct, ready: true, score: correct ? 96 : 0 })
      expect(report.cases[0]).toMatchObject({ passed: correct, observation: { toolErrors: correct ? 2 : 0 } })
      expect(report.executions[0].verifierPassed).toBe(correct)
      expect(await Bun.file(path.join(tmp.path, "answer.txt")).exists()).toBe(false)
    } finally {
      clearTimeout(watchdog)
      proc.kill()
    }
  }, 20000)
}
